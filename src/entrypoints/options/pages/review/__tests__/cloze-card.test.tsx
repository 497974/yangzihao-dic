// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { prepareSentence } from "@/utils/sentence-practice/blanks"
import { ClozeCard } from "../cloze-card"

const SENTENCE = "Kamiya is confronting something that might turn the world around."
const TRANSLATION = "神山先生在直面可能让世界侧目之物。"

function renderCard(onDone = vi.fn<(correct: boolean) => void>()) {
  render(<ClozeCard sentence={SENTENCE} translation={TRANSLATION} onDone={onDone} />)
  return onDone
}

function blanks(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll("input"))
}

describe("语境填空卡", () => {
  it("Ctrl+; 显示答案，不必用鼠标点按钮", () => {
    const onDone = renderCard()

    // 显示答案在改造前只能点按钮触发，键盘用户被迫把手离开填空框
    fireEvent.keyDown(window, { key: ";", ctrlKey: true })

    // correct 为 false —— 是"看了答案"，不是自己填对的
    expect(onDone).toHaveBeenCalledWith(false)
    expect(screen.getByText(SENTENCE)).toBeInTheDocument()
  })

  it("Ctrl+Enter 提交：填对了才判过，correct 为 true", () => {
    const onDone = renderCard()
    const answers = prepareSentence(SENTENCE, "content-words").answers
    const inputs = blanks()
    expect(inputs).toHaveLength(answers.length)
    expect(answers.length).toBeGreaterThan(0)

    inputs.forEach((el, i) => {
      fireEvent.change(el, { target: { value: answers[i]! } })
    })
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true })

    // true = 自己填对的，区别于"看了答案"
    expect(onDone).toHaveBeenCalledWith(true)
  })

  it("Ctrl+Enter 提交：没填完不判过，也不抖答案", () => {
    const onDone = renderCard()

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true })

    expect(onDone).not.toHaveBeenCalled()
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument()
  })

  it("答案揭晓后，快捷键不再重复触发", () => {
    const onDone = renderCard()

    fireEvent.keyDown(window, { key: ";", ctrlKey: true })
    expect(onDone).toHaveBeenCalledTimes(1)

    // settled 之后再按不应该再回调一次
    fireEvent.keyDown(window, { key: ";", ctrlKey: true })
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it("不带 Ctrl 的分号是填空内容，不能当快捷键", () => {
    const onDone = renderCard()

    fireEvent.keyDown(window, { key: ";" })

    expect(onDone).not.toHaveBeenCalled()
  })
})

describe("语境填空卡 · 揭晓后交还键盘", () => {
  // 揭晓时每个空都变成 readOnly，而 readOnly 的框在真实浏览器里仍然保留焦点。
  // 焦点留在框里的话，父页面会把随后按下的 1/2/3/4 当成"正在打字"吞掉，
  // 评分只能改用鼠标——这正是本次要修的毛病之一。
  it("显示答案后，焦点不再停在填空框上", () => {
    renderCard()
    const first = blanks()[0]!
    first.focus()
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(window, { key: ";", ctrlKey: true })

    expect(document.activeElement).not.toBe(first)
  })

  it("全部填对后，焦点也不再停在填空框上", () => {
    renderCard()
    const answers = prepareSentence(SENTENCE, "content-words").answers
    const inputs = blanks()
    inputs.forEach((el, i) => fireEvent.change(el, { target: { value: answers[i]! } }))
    inputs[0]!.focus()

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true })

    expect(document.activeElement).not.toBe(inputs[0])
  })
})
