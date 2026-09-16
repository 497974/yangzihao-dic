// @vitest-environment jsdom
import type { SubtitlesUIContext } from "../subtitles-ui-context"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, describe, expect, it } from "vitest"
import { currentTimeMsAtom, dictationStatsAtom, sourceTrackAtom } from "../../atoms"
import { DictationPanel } from "../subtitle-dictation"
import { SubtitlesUIContext as Context } from "../subtitles-ui-context"

type ContextValue = NonNullable<React.ContextType<typeof SubtitlesUIContext>>

const CUES = [
  { start: 0, end: 2_000, text: "I really want to go home." },
  { start: 3_000, end: 5_000, text: "See you tomorrow." },
]

/** 假的视频元素：可以控制暂停状态和进度，并记录被跳到哪 */
function fakeVideo(currentTimeSec: number) {
  const video = document.createElement("video")
  let paused = true
  Object.defineProperty(video, "paused", { get: () => paused })
  video.currentTime = currentTimeSec
  video.play = async () => {
    paused = false
    video.dispatchEvent(new Event("play"))
  }
  video.pause = () => {
    paused = true
    video.dispatchEvent(new Event("pause"))
  }
  return video
}

function renderPanel(timeSec: number) {
  const store = createStore()
  store.set(sourceTrackAtom, CUES)
  store.set(currentTimeMsAtom, timeSec * 1000)
  const video = fakeVideo(timeSec)
  const ui = { getVideoElement: () => video } as unknown as ContextValue
  render(
    <Context value={ui}>
      <Provider store={store}>
        <DictationPanel />
      </Provider>
    </Context>,
  )
  return { store, video }
}

afterEach(() => {
  document.body.innerHTML = ""
})

describe("字幕听写面板", () => {
  it("作答之前原文遮住，只露出词数和长短", () => {
    renderPanel(1.9)

    expect(screen.getByText("_ ______ ____ __ __ ____")).toBeTruthy()
    expect(screen.queryByText(/really/)).toBeNull()
  })

  it("暂停时出现输入框并自动获得焦点；回车提交后逐词标出，并记入本次统计", () => {
    const { store } = renderPanel(1.9)
    const input = screen.getByPlaceholderText("输入听到的内容，回车提交")
    expect(document.activeElement).toBe(input)

    fireEvent.change(input, { target: { value: "I want to go home" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(screen.getByTitle("漏听或听错的词").textContent).toBe("really")
    expect(screen.getByText("本句正确率 83%（5 / 6）")).toBeTruthy()
    expect(store.get(dictationStatsAtom).lines).toBe(1)
  })

  it("提交后焦点移到「下一句」按钮：再按回车直接播下一句，不用碰鼠标", () => {
    const { video } = renderPanel(1.9)
    const input = screen.getByPlaceholderText("输入听到的内容，回车提交")
    fireEvent.change(input, { target: { value: "anything" } })
    fireEvent.keyDown(input, { key: "Enter" })

    const nextButton = screen.getByText("下一句（回车）")
    expect(document.activeElement).toBe(nextButton)

    act(() => {
      nextButton.click()
    })
    expect(video.currentTime).toBe(3)
  })

  it("打字时按键不会冒泡到播放器（YouTube 的 k / f / 空格等快捷键）", () => {
    renderPanel(1.9)
    let leaked = 0
    const listener = () => {
      leaked += 1
    }
    document.addEventListener("keydown", listener)

    const input = screen.getByPlaceholderText("输入听到的内容，回车提交")
    fireEvent.keyDown(input, { key: "k" })
    fireEvent.keyDown(input, { key: "f" })
    fireEvent.keyDown(input, { key: " " })

    document.removeEventListener("keydown", listener)
    expect(leaked).toBe(0)
  })

  it("可以先看原文", () => {
    renderPanel(1.9)
    fireEvent.click(screen.getByText("显示原文"))

    expect(screen.getByText("I really want to go home.")).toBeTruthy()
  })
})
