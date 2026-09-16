import { describe, expect, it, vi } from "vitest"
import { MAX_CONCURRENT_TRANSLATION_BATCHES } from "@/utils/constants/subtitles"
import { TranslationCoordinator } from "../translation-coordinator"

describe("translation coordinator loading state", () => {
  it("sets loading for the active untranslated cue", () => {
    const onStateChange = vi.fn<(...args: any[]) => any>()
    const coordinator = new TranslationCoordinator({
      getFragments: () => [{ text: "hello", start: 0, end: 1000 }],
      getVideoElement: () => ({ currentTime: 0.5 }) as HTMLVideoElement,
      getCurrentState: () => "idle",
      segmentationPipeline: null,
      onTranslated: vi.fn<(...args: any[]) => any>(),
      onStateChange,
    })

    ;(coordinator as any).updateLoadingStateAt(500, [{ text: "hello", start: 0, end: 1000 }])

    expect(onStateChange).toHaveBeenCalledWith("loading")
  })

  it("does not keep loading in a cue gap just because the next cue is untranslated", () => {
    const onStateChange = vi.fn<(...args: any[]) => any>()
    const coordinator = new TranslationCoordinator({
      getFragments: () => [
        { text: "hello", start: 0, end: 1000 },
        { text: "world", start: 2000, end: 3000 },
      ],
      getVideoElement: () => ({ currentTime: 1.5 }) as HTMLVideoElement,
      getCurrentState: () => "loading",
      segmentationPipeline: null,
      onTranslated: vi.fn<(...args: any[]) => any>(),
      onStateChange,
    })

    // Pretend we were loading on the previous cue.
    ;(coordinator as any).lastEmittedState = "loading"
    ;(coordinator as any).updateLoadingStateAt(1500, [
      { text: "hello", start: 0, end: 1000 },
      { text: "world", start: 2000, end: 3000 },
    ])

    expect(onStateChange).toHaveBeenCalledWith("idle")
  })

  it("clears adapter loading during a music intro with no active cue", () => {
    const onStateChange = vi.fn<(...args: any[]) => any>()
    const coordinator = new TranslationCoordinator({
      getFragments: () => [{ text: "lyrics start later", start: 30_000, end: 31_000 }],
      getVideoElement: () => ({ currentTime: 5 }) as HTMLVideoElement,
      // Scheduler was set to loading while source subtitles were fetched.
      getCurrentState: () => "loading",
      segmentationPipeline: null,
      onTranslated: vi.fn<(...args: any[]) => any>(),
      onStateChange,
    })

    // Coordinator starts with lastEmittedState = "idle", which previously skipped clear.
    ;(coordinator as any).updateLoadingStateAt(5_000, [
      { text: "lyrics start later", start: 30_000, end: 31_000 },
    ])

    expect(onStateChange).toHaveBeenCalledWith("idle")
  })

  it("does not chain another translation tick after stop", async () => {
    const onTranslated = vi.fn<(...args: any[]) => any>()
    const onStateChange = vi.fn<(...args: any[]) => any>()
    let resolveTranslate!: (value: any) => void
    const translatePromise = new Promise((resolve) => {
      resolveTranslate = resolve
    })

    const translator = await import("@/utils/subtitles/processor/translator")
    const spy = vi
      .spyOn(translator, "translateSubtitles")
      .mockImplementation(() => translatePromise as any)

    const coordinator = new TranslationCoordinator({
      getFragments: () => [
        { text: "a", start: 0, end: 1000 },
        { text: "b", start: 1000, end: 2000 },
        { text: "c", start: 2000, end: 3000 },
        { text: "d", start: 3000, end: 4000 },
        { text: "e", start: 4000, end: 5000 },
        { text: "f", start: 5000, end: 6000 },
      ],
      getVideoElement: () =>
        ({
          currentTime: 0,
          addEventListener: vi.fn<(...args: any[]) => any>(),
          removeEventListener: vi.fn<(...args: any[]) => any>(),
        }) as unknown as HTMLVideoElement,
      getCurrentState: () => "idle",
      segmentationPipeline: null,
      onTranslated,
      onStateChange,
    })

    coordinator.start()
    await Promise.resolve()
    // 6 条字幕、每批 5 条：一次 tick 会把并发填到 2 批（第 3 批已无内容可取）。
    // 这里原本断言 1，编码的是"发一批等一批"的串行行为——那正是字幕追不上
    // 播放的原因，现在改成并发调度。
    expect(spy).toHaveBeenCalledTimes(2)
    const inFlightBefore = spy.mock.calls.length

    coordinator.stop()
    const firstCall = spy.mock.calls[0]!
    const batch = firstCall[0] as Array<{ text: string; start: number; end: number }>
    resolveTranslate(batch.map((f) => ({ ...f, translation: `t:${f.text}` })))
    await Promise.resolve()
    await Promise.resolve()

    // In-flight call may finish, but stop must not chain another nearby batch.
    expect(spy).toHaveBeenCalledTimes(inFlightBefore)
    expect(onTranslated).not.toHaveBeenCalled()

    spy.mockRestore()
  })

  it("invalidates translated bookkeeping when the same start is recut", () => {
    let fragments = [{ text: "hello world", start: 0, end: 2000 }]
    const onStateChange = vi.fn<(...args: any[]) => any>()
    const coordinator = new TranslationCoordinator({
      getFragments: () => fragments,
      getVideoElement: () =>
        ({
          currentTime: 0.2,
          addEventListener: vi.fn<(...args: any[]) => any>(),
          removeEventListener: vi.fn<(...args: any[]) => any>(),
        }) as unknown as HTMLVideoElement,
      getCurrentState: () => "idle",
      segmentationPipeline: null,
      onTranslated: vi.fn<(...args: any[]) => any>(),
      onStateChange,
    })

    // noteFragmentListChanged is a no-op when inactive.
    ;(coordinator as any).active = true
    ;(coordinator as any).translatedStarts.add(0)
    ;(coordinator as any).knownIdentities.set(0, "2000\0hello world")

    // AI re-segmentation keeps start=0 but shortens the cue.
    fragments = [
      { text: "hello", start: 0, end: 1000 },
      { text: "world", start: 1000, end: 2000 },
    ]
    coordinator.noteFragmentListChanged()

    // Old completion must be invalidated so the recut line can be translated again.
    expect((coordinator as any).translatedStarts.has(0)).toBe(false)
    // Old baseline identity must not stick around as if still valid.
    expect((coordinator as any).knownIdentities.get(0)).not.toBe("2000\0hello world")
  })

  it("does not apply in-flight results after stop then start", async () => {
    const onTranslated = vi.fn<(...args: any[]) => any>()
    const resolvers: Array<(value: any) => void> = []
    const translator = await import("@/utils/subtitles/processor/translator")
    const spy = vi.spyOn(translator, "translateSubtitles").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve)
        }) as any,
    )

    const coordinator = new TranslationCoordinator({
      getFragments: () => [{ text: "a", start: 0, end: 1000 }],
      getVideoElement: () =>
        ({
          currentTime: 0.2,
          addEventListener: vi.fn<(...args: any[]) => any>(),
          removeEventListener: vi.fn<(...args: any[]) => any>(),
        }) as unknown as HTMLVideoElement,
      getCurrentState: () => "idle",
      segmentationPipeline: null,
      onTranslated,
      onStateChange: vi.fn<(...args: any[]) => any>(),
    })

    coordinator.start()
    await Promise.resolve()
    expect(spy).toHaveBeenCalledTimes(1)

    coordinator.stop()
    coordinator.start()
    await Promise.resolve()
    // Resume must be able to start a new batch (isTranslating not stuck).
    expect(spy).toHaveBeenCalledTimes(2)

    // Stale first-run result.
    resolvers[0]!([{ text: "a", start: 0, end: 1000, translation: "STALE" }])
    await Promise.resolve()
    await Promise.resolve()
    expect(onTranslated).not.toHaveBeenCalled()

    // Current-run result.
    resolvers[1]!([{ text: "a", start: 0, end: 1000, translation: "FRESH" }])
    await Promise.resolve()
    await Promise.resolve()
    expect(onTranslated).toHaveBeenCalledWith([expect.objectContaining({ translation: "FRESH" })])

    spy.mockRestore()
  })

  it("widens the translation look-ahead window with playback rate", async () => {
    const translator = await import("@/utils/subtitles/processor/translator")

    async function firstBatchStartsAtRate(playbackRate: number): Promise<number[]> {
      const spy = vi
        .spyOn(translator, "translateSubtitles")
        .mockImplementation((batch: any) => Promise.resolve(batch) as any)

      const coordinator = new TranslationCoordinator({
        // near cue (in the 1x window) + far cue (only reachable at higher rates)
        getFragments: () => [
          { text: "near", start: 1000, end: 2000 },
          { text: "far", start: 60_000, end: 61_000 },
        ],
        getVideoElement: () =>
          ({
            currentTime: 0,
            playbackRate,
            addEventListener: vi.fn<(...args: any[]) => any>(),
            removeEventListener: vi.fn<(...args: any[]) => any>(),
          }) as unknown as HTMLVideoElement,
        getCurrentState: () => "idle",
        segmentationPipeline: null,
        onTranslated: vi.fn<(...args: any[]) => any>(),
        onStateChange: vi.fn<(...args: any[]) => any>(),
      })

      coordinator.start()
      await Promise.resolve()
      coordinator.stop()

      const batch = (spy.mock.calls[0]?.[0] ?? []) as Array<{ start: number }>
      spy.mockRestore()
      return batch.map((f) => f.start)
    }

    // 1x: 30s window excludes the 60s cue.
    expect(await firstBatchStartsAtRate(1)).toEqual([1000])
    // 3x: 90s window now reaches the 60s cue.
    expect(await firstBatchStartsAtRate(3)).toEqual([1000, 60_000])
  })

  it("does not publish stale batch cues on translation failure after a recut", async () => {
    let fragments = [
      { text: "hello world", start: 0, end: 2000 },
      { text: "next", start: 2000, end: 3000 },
    ]
    const onTranslated = vi.fn<(...args: any[]) => any>()
    const onStateChange = vi.fn<(...args: any[]) => any>()

    const translator = await import("@/utils/subtitles/processor/translator")
    const spy = vi
      .spyOn(translator, "translateSubtitles")
      .mockRejectedValue(new Error("translate failed"))

    const config = await import("@/utils/config/storage")
    const configSpy = vi.spyOn(config, "getLocalConfig").mockResolvedValue({
      videoSubtitles: { style: { displayMode: "bilingual" } },
    } as any)

    const coordinator = new TranslationCoordinator({
      getFragments: () => fragments,
      getVideoElement: () =>
        ({
          currentTime: 0.2,
          addEventListener: vi.fn<(...args: any[]) => any>(),
          removeEventListener: vi.fn<(...args: any[]) => any>(),
        }) as unknown as HTMLVideoElement,
      getCurrentState: () => "idle",
      segmentationPipeline: null,
      onTranslated,
      onStateChange,
    })

    coordinator.start()
    await Promise.resolve()
    // Recut mid-request: original cue is gone; only identity-valid fallbacks may publish.
    fragments = [
      { text: "hello", start: 0, end: 1000 },
      { text: "world", start: 1000, end: 2000 },
      { text: "next", start: 2000, end: 3000 },
    ]
    await vi.waitFor(() => {
      expect(onStateChange).toHaveBeenCalledWith("error", { message: "translate failed" })
    })

    // Stale full-batch fallback would re-introduce the pre-recut cue as a zombie.
    const published = onTranslated.mock.calls.flatMap((call) => call[0] as any[])
    expect(published.every((f) => f.text !== "hello world")).toBe(true)
    // Empty translation fallbacks for still-valid cues are fine; identity-mismatched are not.
    expect(published.some((f) => f.start === 0 && f.end === 2000)).toBe(false)

    spy.mockRestore()
    configSpy.mockRestore()
  })
})

describe("字幕翻译的并发调度", () => {
  /** 造 n 条连续字幕，每条 1 秒，全部落在 30 秒预取窗口内 */
  function makeFragments(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      text: `line-${i}`,
      start: i * 1000,
      end: i * 1000 + 1000,
    }))
  }

  function makeCoordinator(fragments: ReturnType<typeof makeFragments>) {
    return new TranslationCoordinator({
      getFragments: () => fragments,
      getVideoElement: () =>
        ({
          currentTime: 0,
          playbackRate: 1,
          addEventListener: vi.fn<(...args: any[]) => any>(),
          removeEventListener: vi.fn<(...args: any[]) => any>(),
        }) as unknown as HTMLVideoElement,
      getCurrentState: () => "idle",
      segmentationPipeline: null,
      onTranslated: vi.fn<(...args: any[]) => any>(),
      onStateChange: vi.fn<(...args: any[]) => any>(),
    })
  }

  it("一次 tick 就把并发填满，不再发一批等一批", async () => {
    // 这是"字幕永远追不上播放"的根因：协调器原本用一把布尔锁串行跑，
    // 而底层 RequestQueue 放行 8 请求/秒。刚开播或刚拖完进度条时前面没有缓冲，
    // 串行补就只能盯着"翻译中…"干等。
    const translator = await import("@/utils/subtitles/processor/translator")
    const spy = vi
      .spyOn(translator, "translateSubtitles")
      // 永不 resolve：这样数到的就是"同时在飞"的批次数
      .mockImplementation(() => new Promise(() => {}) as any)

    const coordinator = makeCoordinator(makeFragments(30))
    coordinator.start()
    await Promise.resolve()

    // 这里要锁的性质是"不再串行"，所以拿字面量 1 比，而不是拿
    // MAX_CONCURRENT_TRANSLATION_BATCHES 比——用常量当期望值等于自己跟自己比，
    // 常量被改回 1 时测试照样绿，什么都锁不住。
    expect(spy.mock.calls.length).toBeGreaterThan(1)
    expect(spy).toHaveBeenCalledTimes(MAX_CONCURRENT_TRANSLATION_BATCHES)

    coordinator.stop()
    spy.mockRestore()
  })

  it("并发有上限，不会把字幕一次全发出去", async () => {
    const translator = await import("@/utils/subtitles/processor/translator")
    const spy = vi
      .spyOn(translator, "translateSubtitles")
      .mockImplementation(() => new Promise(() => {}) as any)

    // 100 条字幕远多于并发上限能覆盖的量，但仍只应发出上限那么多批
    const coordinator = makeCoordinator(makeFragments(100))
    coordinator.start()
    await Promise.resolve()
    coordinator.requestTick()
    coordinator.requestTick()
    await Promise.resolve()

    expect(spy).toHaveBeenCalledTimes(MAX_CONCURRENT_TRANSLATION_BATCHES)

    coordinator.stop()
    spy.mockRestore()
  })

  it("并发的各批之间不会挑到同一条字幕", async () => {
    const translator = await import("@/utils/subtitles/processor/translator")
    const spy = vi
      .spyOn(translator, "translateSubtitles")
      .mockImplementation(() => new Promise(() => {}) as any)

    const coordinator = makeCoordinator(makeFragments(30))
    coordinator.start()
    await Promise.resolve()

    // 选批与标记若不在同一个同步块里完成，并发的下一次调用就会挑到同一批，
    // 白白重复请求、多花 token
    const allStarts = spy.mock.calls.flatMap((call) =>
      (call[0] as Array<{ start: number }>).map((f) => f.start),
    )
    expect(new Set(allStarts).size).toBe(allStarts.length)

    coordinator.stop()
    spy.mockRestore()
  })

  it("停掉之后回来的旧批次不会把并发计数减成负数", async () => {
    const translator = await import("@/utils/subtitles/processor/translator")
    const resolvers: Array<(v: any) => void> = []
    const spy = vi
      .spyOn(translator, "translateSubtitles")
      .mockImplementation(() => new Promise((r) => resolvers.push(r)) as any)

    const coordinator = makeCoordinator(makeFragments(30))
    coordinator.start()
    await Promise.resolve()
    coordinator.stop()

    // stop() 已经把计数清零；旧世代的请求回来时若还去减一，计数会变成负数，
    // 并发上限就形同虚设了
    resolvers.forEach((r) => r([]))
    await Promise.resolve()
    await Promise.resolve()

    expect((coordinator as any).inFlight).toBeGreaterThanOrEqual(0)

    spy.mockRestore()
  })
})
