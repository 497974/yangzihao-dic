// @vitest-environment jsdom

import { describe, expect, it } from "vitest"
import { canSpaceReveal, isTypingTarget } from "../index"

describe("闪卡复习 · 快捷键边界", () => {
  describe("空格揭晓只属于正反面题型", () => {
    it("正反面：空格就是翻面", () => {
      expect(canSpaceReveal("recognition")).toBe(true)
    })

    // 这三种都得先真正作答。放开的话，答案没露脸评分按钮就冒出来了，
    // 等于可以盲按 1/2/3/4 打分并跳下一题，复习记录会变成假的。
    it.each(["listening", "translation", "cloze"] as const)("%s：不能靠空格跳过作答", (mode) => {
      expect(canSpaceReveal(mode)).toBe(false)
    })
  })

  describe("正在打字时不该触发全局快捷键", () => {
    it("认出所有输入位置，而不只是某一个 ref", () => {
      // 语境填空有一排自己的输入框，都不等于拼写模式那个 ref。
      // 只比对单个 ref 的话，在填空里打字会被判成"没在输入"——
      // 空格被吃掉、打 1/2/3/4 直接变成评分。
      for (const tag of ["input", "textarea", "select"]) {
        expect(isTypingTarget(document.createElement(tag))).toBe(true)
      }
    })

    it("认出 contentEditable", () => {
      const el = document.createElement("div")
      el.contentEditable = "true"
      // jsdom 不会自己算 isContentEditable，显式声明来表达意图
      Object.defineProperty(el, "isContentEditable", { value: true })
      expect(isTypingTarget(el)).toBe(true)
    })

    it("只读 / 禁用的输入框不算在打字", () => {
      // 语境填空揭晓后每个空都变成 readOnly，而 readOnly 的框在真实浏览器里
      // 仍然保留焦点。若按"正在输入"处理，答案刚露脸评分按钮刚出来，
      // 1/2/3/4 就会被吞掉，键盘评分整个失效。
      const ro = document.createElement("input")
      ro.readOnly = true
      expect(isTypingTarget(ro)).toBe(false)

      const disabled = document.createElement("input")
      disabled.disabled = true
      expect(isTypingTarget(disabled)).toBe(false)

      const ta = document.createElement("textarea")
      ta.readOnly = true
      expect(isTypingTarget(ta)).toBe(false)
    })

    it("普通元素与 null 不算在打字", () => {
      expect(isTypingTarget(document.createElement("div"))).toBe(false)
      expect(isTypingTarget(document.createElement("button"))).toBe(false)
      expect(isTypingTarget(null)).toBe(false)
    })
  })
})
