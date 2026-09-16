import type { SegmentationPipeline } from "./segmentation-pipeline"
import type { SubtitlesVideoContext } from "@/utils/subtitles/processor/translator"
import type { SubtitlesFragment, SubtitlesState } from "@/utils/subtitles/types"
import { getLocalConfig } from "@/utils/config/storage"
import {
  MAX_CONCURRENT_TRANSLATION_BATCHES,
  TRANSLATE_LOOK_AHEAD_MS,
  TRANSLATION_BATCH_SIZE,
} from "@/utils/constants/subtitles"
import { effectiveLookAheadMs } from "@/utils/subtitles/lookahead"
import { translateSubtitles } from "@/utils/subtitles/processor/translator"
import { adPlayingAtom, subtitlesStore } from "./atoms"

export interface TranslationCoordinatorOptions {
  getFragments: () => SubtitlesFragment[]
  getVideoElement: () => HTMLVideoElement | null
  getCurrentState: () => SubtitlesState
  segmentationPipeline: SegmentationPipeline | null
  onTranslated: (fragments: SubtitlesFragment[]) => void
  onStateChange: (state: SubtitlesState, data?: Record<string, string>) => void
}

function fragmentIdentity(fragment: Pick<SubtitlesFragment, "end" | "text">): string {
  return `${fragment.end}\0${fragment.text}`
}

export class TranslationCoordinator {
  private translatingStarts = new Set<number>()
  private translatedStarts = new Set<number>()
  private failedStarts = new Set<number>()
  /** Identity of the cue (end+text) associated with a booked start. */
  private knownIdentities = new Map<number, string>()
  /**
   * 正在飞的批次数。
   *
   * 原本这里是一把布尔锁：发一批 → 等它回来 → 才发下一批，同一时刻永远只有
   * 一个请求。底层 RequestQueue 允许 8 请求/秒、突发 20，等于把一条能跑 8 并发
   * 的通道压成了 1。后果就是字幕永远追不上播放——尤其是刚开播或刚拖完进度条时，
   * 前面没有任何缓冲，得一批一批串着补，人只能盯着"翻译中…"干等。
   */
  private inFlight = 0
  /** False after stop(); blocks chained ticks and in-flight result application. */
  private active = false
  /** Bumped on stop() so in-flight batches cannot apply after stop/start. */
  private runId = 0
  private lastEmittedState: SubtitlesState = "idle"
  private videoContext: SubtitlesVideoContext = { videoTitle: "", subtitlesTextContent: "" }
  private listenersAttached = false

  private getFragments: () => SubtitlesFragment[]
  private getVideoElement: () => HTMLVideoElement | null
  private getCurrentState: () => SubtitlesState
  private segmentationPipeline: SegmentationPipeline | null
  private onTranslated: (fragments: SubtitlesFragment[]) => void
  private onStateChange: (state: SubtitlesState, data?: Record<string, string>) => void

  constructor(options: TranslationCoordinatorOptions) {
    this.getFragments = options.getFragments
    this.getVideoElement = options.getVideoElement
    this.getCurrentState = options.getCurrentState
    this.segmentationPipeline = options.segmentationPipeline
    this.onTranslated = options.onTranslated
    this.onStateChange = options.onStateChange
  }

  start(videoContext?: SubtitlesVideoContext) {
    if (videoContext !== undefined) {
      this.videoContext = videoContext
    }

    const video = this.getVideoElement()
    if (!video) return

    this.active = true
    this.attachVideoListeners(video)

    if (this.segmentationPipeline) {
      this.segmentationPipeline.start()
    }

    this.handleTranslationTick()
  }

  stop() {
    this.active = false
    this.runId += 1
    // Allow a subsequent start() to translate immediately; the in-flight batch is
    // invalidated by runId and must not leave locks stuck.
    this.inFlight = 0
    this.translatingStarts.clear()
    this.detachVideoListeners()
    this.segmentationPipeline?.stop()
  }

  /** Kick a nearby pass without waiting for the next timeupdate (e.g. after an ad). */
  requestTick() {
    if (!this.active) return
    this.handleTranslationTick()
  }

  reset() {
    this.active = false
    this.runId += 1
    this.detachVideoListeners()
    this.translatingStarts.clear()
    this.translatedStarts.clear()
    this.failedStarts.clear()
    this.knownIdentities.clear()
    this.inFlight = 0
    this.lastEmittedState = "idle"
    this.videoContext = { videoTitle: "", subtitlesTextContent: "" }
  }

  private attachVideoListeners(video: HTMLVideoElement) {
    if (this.listenersAttached) return
    video.addEventListener("timeupdate", this.handleTranslationTick)
    video.addEventListener("seeked", this.handleTranslationTick)
    if (this.segmentationPipeline) {
      video.addEventListener("seeked", this.handleSeek)
    }
    this.listenersAttached = true
  }

  private detachVideoListeners() {
    if (!this.listenersAttached) return
    const video = this.getVideoElement()
    if (video) {
      video.removeEventListener("timeupdate", this.handleTranslationTick)
      video.removeEventListener("seeked", this.handleTranslationTick)
      video.removeEventListener("seeked", this.handleSeek)
    }
    this.listenersAttached = false
  }

  clearFailed() {
    this.failedStarts.clear()
  }

  /**
   * Drop bookkeeping for starts that no longer exist, or whose cue identity
   * (end+text) changed after AI re-segmentation — same start can be a recut line.
   */
  noteFragmentListChanged() {
    if (!this.active) return

    const byStart = new Map(this.getFragments().map((fragment) => [fragment.start, fragment]))

    this.invalidateStaleStarts(this.translatedStarts, byStart)
    this.invalidateStaleStarts(this.translatingStarts, byStart)
    this.invalidateStaleStarts(this.failedStarts, byStart)

    this.handleTranslationTick()
  }

  private invalidateStaleStarts(starts: Set<number>, byStart: Map<number, SubtitlesFragment>) {
    for (const start of [...starts]) {
      const current = byStart.get(start)
      if (!current) {
        starts.delete(start)
        this.knownIdentities.delete(start)
        continue
      }

      const known = this.knownIdentities.get(start)
      if (known !== undefined && known !== fragmentIdentity(current)) {
        starts.delete(start)
        this.knownIdentities.delete(start)
      }
    }
  }

  private rememberIdentity(fragment: SubtitlesFragment) {
    this.knownIdentities.set(fragment.start, fragmentIdentity(fragment))
  }

  private handleTranslationTick = () => {
    if (!this.active) return
    // Ad timeline can freeze or jump; do not translate against main-video cues mid-ad.
    if (subtitlesStore.get(adPlayingAtom)) return

    const video = this.getVideoElement()
    if (!video) return

    const currentTimeMs = video.currentTime * 1000
    const fragments = this.getFragments()

    if (this.getCurrentState() === "error") return

    this.updateLoadingStateAt(currentTimeMs, fragments)

    if (
      this.segmentationPipeline &&
      !this.segmentationPipeline.isRunning &&
      this.segmentationPipeline.hasUnprocessedChunks()
    ) {
      this.segmentationPipeline.restart()
    }

    // 一次 tick 把并发填满，而不是只发一批就走。冷启动时这是关键：
    // 三批同时出发，缓冲建立速度就是原来的三倍。
    while (this.inFlight < MAX_CONCURRENT_TRANSLATION_BATCHES) {
      if (!this.startNextBatch(currentTimeMs)) break
    }
  }

  /**
   * 挑出下一批并发出去，返回是否真的发了。
   *
   * 选批和"标记为翻译中"必须在同一个同步块里做完，中间不能有 await——
   * 否则并发的下一次调用会挑到同一批字幕，白白重复请求。
   */
  private startNextBatch(currentTimeMs: number): boolean {
    if (!this.active) return false

    const batch = this.pickNextBatch(currentTimeMs)
    if (batch.length === 0) return false

    this.inFlight += 1
    batch.forEach((f) => {
      this.translatingStarts.add(f.start)
      this.rememberIdentity(f)
    })
    void this.runBatch(batch, currentTimeMs, this.runId)
    return true
  }

  private pickNextBatch(currentTimeMs: number): SubtitlesFragment[] {
    const lookAheadMs = effectiveLookAheadMs(
      TRANSLATE_LOOK_AHEAD_MS,
      this.getVideoElement()?.playbackRate,
    )

    return this.getFragments()
      .filter(
        (f) =>
          !this.translatedStarts.has(f.start) &&
          !this.translatingStarts.has(f.start) &&
          !this.failedStarts.has(f.start) &&
          f.start >= currentTimeMs - 5000 &&
          f.start <= currentTimeMs + lookAheadMs,
      )
      .slice(0, TRANSLATION_BATCH_SIZE)
  }

  /** 执行一批翻译。选批与标记已在 startNextBatch 里同步做完。 */
  private async runBatch(batch: SubtitlesFragment[], currentTimeMs: number, runId: number) {
    try {
      const translated = await translateSubtitles(batch, this.videoContext)
      if (!this.active || runId !== this.runId) {
        batch.forEach((f) => this.translatingStarts.delete(f.start))
        return
      }

      // Only accept results whose cue identity still matches the current fragment list.
      const stillValid = this.filterIdentityValid(translated)

      stillValid.forEach((f) => {
        this.translatingStarts.delete(f.start)
        this.translatedStarts.add(f.start)
        this.rememberIdentity(f)
      })
      // Starts that disappeared or were recut mid-request should not stay "translating".
      batch.forEach((f) => {
        this.translatingStarts.delete(f.start)
      })
      this.onTranslated(stillValid)

      const latestTimeMs = this.getCurrentVideoTimeMs(currentTimeMs)
      const latestFragments = this.getFragments()
      this.updateLoadingStateAt(latestTimeMs, latestFragments)
    } catch (error) {
      if (!this.active || runId !== this.runId) {
        batch.forEach((f) => this.translatingStarts.delete(f.start))
        return
      }

      // Starts that disappeared or were recut mid-request should not stay "translating".
      batch.forEach((f) => {
        this.translatingStarts.delete(f.start)
      })

      // Same identity gate as the success path: never bookkeep or publish recut/stale cues.
      const stillValid = this.filterIdentityValid(batch)
      stillValid.forEach((f) => {
        this.failedStarts.add(f.start)
        this.rememberIdentity(f)
      })

      const config = await getLocalConfig()
      if (!this.active || runId !== this.runId) {
        return
      }

      // Re-check after the await: AI recut may have landed while config was loading.
      const validForFallback = this.filterIdentityValid(stillValid)
      const displayMode = config?.videoSubtitles?.style.displayMode
      const fallback =
        displayMode === "translationOnly"
          ? validForFallback.map((f) => ({ ...f, translation: f.text }))
          : validForFallback.map((f) => ({ ...f, translation: "" }))
      if (fallback.length > 0) {
        this.onTranslated(fallback)
      }

      const errorMessage = error instanceof Error ? error.message : String(error)
      this.lastEmittedState = "error"
      this.onStateChange("error", { message: errorMessage })
    } finally {
      // 换了一集/重新分句之后，旧世代的请求回来了也不该再动计数——
      // 那个计数已经在 runId 递增时清零了，再减就会变成负数，
      // 于是并发上限形同虚设。
      if (runId === this.runId) {
        this.inFlight = Math.max(0, this.inFlight - 1)
        if (this.active) {
          this.handleTranslationTick()
        }
      }
    }
  }

  private getCurrentVideoTimeMs(fallbackTimeMs: number): number {
    const video = this.getVideoElement()
    if (!video) {
      return fallbackTimeMs
    }
    return video.currentTime * 1000
  }

  /** Keep only cues whose start+end+text still match the live fragment list. */
  private filterIdentityValid(fragments: SubtitlesFragment[]): SubtitlesFragment[] {
    const byStart = new Map(this.getFragments().map((fragment) => [fragment.start, fragment]))
    return fragments.filter((fragment) => {
      const current = byStart.get(fragment.start)
      return !!current && current.end === fragment.end && current.text === fragment.text
    })
  }

  private findActiveCue(timeMs: number, fragments: SubtitlesFragment[]): SubtitlesFragment | null {
    return fragments.find((f) => f.start <= timeMs && f.end > timeMs) ?? null
  }

  private isCueResolved(startMs: number): boolean {
    return this.translatedStarts.has(startMs) || this.failedStarts.has(startMs)
  }

  private updateLoadingStateAt(timeMs: number, fragments: SubtitlesFragment[]) {
    const activeCue = this.findActiveCue(timeMs, fragments)

    if (activeCue) {
      const nextState: SubtitlesState = this.isCueResolved(activeCue.start) ? "idle" : "loading"
      if (nextState === this.lastEmittedState) return
      this.lastEmittedState = nextState
      this.onStateChange(nextState)
      return
    }

    // Gap / music intro / before first cue: never keep the corner loading badge up.
    // Adapter may have set "loading" before fragments were ready; lastEmittedState can
    // still be "idle" while the scheduler state remains "loading" — always clear it.
    if (this.lastEmittedState === "idle" && this.getCurrentState() !== "loading") {
      return
    }
    this.lastEmittedState = "idle"
    this.onStateChange("idle")
  }

  private handleSeek = () => {
    this.segmentationPipeline?.restart()
  }
}
