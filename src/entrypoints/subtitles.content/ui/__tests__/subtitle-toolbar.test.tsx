import type { WritableAtom } from "jotai"
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { MAX_FONT_SCALE, MIN_FONT_SCALE } from "@/utils/constants/subtitles"
import { SubtitleToolbar, type ToolbarTarget } from "../subtitle-toolbar"

type VideoSubtitlesConfig = typeof DEFAULT_CONFIG.videoSubtitles

// 在声明处就给出真实类型。原来写成 `null as any`，读取时再 `as` 回配置类型——
// 类型感知 lint 对 any 经 store.get 之后推断成什么并不稳定，全仓库检查时
// "多余断言"这条规则时报时不报，会随机拦住 pre-push。类型写在源头就不需要断言了。
const mocked = vi.hoisted(() => ({
  videoSubtitlesAtom: null as unknown as WritableAtom<
    VideoSubtitlesConfig,
    [Partial<VideoSubtitlesConfig>],
    void
  >,
}))

vi.mock("@/utils/atoms/config", async () => {
  const { atom } = await import("jotai")
  const base = atom(DEFAULT_CONFIG.videoSubtitles)
  // 可写包装：真实 setter 只收部分字段并合并，这里照做，
  // 好让用例能直接读出"改完之后的 style"
  const videoSubtitlesAtom = atom(
    (get) => get(base),
    (get, set, patch: any) => set(base, { ...get(base), ...patch }),
  )
  mocked.videoSubtitlesAtom = videoSubtitlesAtom
  return { configFieldsAtomMap: { videoSubtitles: videoSubtitlesAtom } }
})

function renderToolbar(target: ToolbarTarget, scales?: { main?: number; translation?: number }) {
  const store = createStore()
  const base = DEFAULT_CONFIG.videoSubtitles
  store.set(mocked.videoSubtitlesAtom, {
    ...base,
    style: {
      ...base.style,
      main: { ...base.style.main, fontScale: scales?.main ?? base.style.main.fontScale },
      translation: {
        ...base.style.translation,
        fontScale: scales?.translation ?? base.style.translation.fontScale,
      },
    },
  })

  render(
    <Provider store={store}>
      <SubtitleToolbar handleRef={createRef<HTMLDivElement>()} target={target} />
    </Provider>,
  )
  return {
    store,
    scaleOf: (key: "main" | "translation") => {
      return store.get(mocked.videoSubtitlesAtom).style[key].fontScale
    },
  }
}

describe("字幕工具条 · 调整大小", () => {
  it("放大只动它负责的那一行", () => {
    // 拉开距离模式下顶部框只有译文，动到原文就会把底部字幕一起改了
    const { scaleOf } = renderToolbar("translation")

    fireEvent.click(screen.getByLabelText("放大字幕"))

    expect(scaleOf("translation")).toBe(
      DEFAULT_CONFIG.videoSubtitles.style.translation.fontScale + 10,
    )
    expect(scaleOf("main")).toBe(DEFAULT_CONFIG.videoSubtitles.style.main.fontScale)
  })

  it("both：一个框里两行都在，就一起调", () => {
    // 普通模式下两行同框，只调一行会看着别扭
    const { scaleOf } = renderToolbar("both")

    fireEvent.click(screen.getByLabelText("放大字幕"))

    expect(scaleOf("main")).toBe(DEFAULT_CONFIG.videoSubtitles.style.main.fontScale + 10)
    expect(scaleOf("translation")).toBe(
      DEFAULT_CONFIG.videoSubtitles.style.translation.fontScale + 10,
    )
  })

  it("到上限就按不动了，不会越界", () => {
    const { scaleOf } = renderToolbar("main", { main: MAX_FONT_SCALE })

    const plus = screen.getByLabelText("放大字幕")
    expect(plus).toBeDisabled()
    fireEvent.click(plus)

    expect(scaleOf("main")).toBe(MAX_FONT_SCALE)
  })

  it("到下限也一样", () => {
    const { scaleOf } = renderToolbar("main", { main: MIN_FONT_SCALE })

    const minus = screen.getByLabelText("缩小字幕")
    expect(minus).toBeDisabled()
    fireEvent.click(minus)

    expect(scaleOf("main")).toBe(MIN_FONT_SCALE)
  })

  it("显示当前档位，点完跟着变", () => {
    const { scaleOf } = renderToolbar("main", { main: 100 })

    expect(screen.getByText("100%")).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("缩小字幕"))

    expect(scaleOf("main")).toBe(90)
    expect(screen.getByText("90%")).toBeInTheDocument()
  })
})
