import { describe, expect, it } from "vitest"
import { BridgeRequestError } from "../bridge-server"
import { buildErrorState, buildFieldRows, formatFieldValue, noSelectionState } from "../popup-model"

const SCHEMA = [
  { name: "词条", type: "string", speaking: true },
  { name: "音标", type: "string", speaking: false },
  { name: "释义", type: "string" },
]

describe("弹窗字段", () => {
  it("和网页一样按词典设置的顺序一行一行显示，开了朗读的字段带朗读按钮", () => {
    expect(buildFieldRows(SCHEMA, { 释义: "获得", 词条: "obtain", 音标: "" }, false)).toEqual([
      { label: "词条", value: "obtain", pending: false, speakable: true },
      { label: "音标", value: "", pending: false, speakable: false },
      { label: "释义", value: "获得", pending: false, speakable: false },
    ])
  })

  it("大模型还在写时，没写到的字段标成等待中", () => {
    const rows = buildFieldRows(SCHEMA, { 词条: "obt" }, true)
    expect(rows.map((row) => [row.label, row.value, row.pending])).toEqual([
      ["词条", "obt", false],
      ["音标", "", true],
      ["释义", "", true],
    ])
  })

  it("写完后，结果里多出来的字段排在最后；还在写时先不加（字段名可能还没写完）", () => {
    const fields = { 词条: "obtain", 助记: "ob + tain" }
    expect(buildFieldRows(SCHEMA, fields, false).at(-1)).toEqual({
      label: "助记",
      value: "ob + tain",
      pending: false,
      speakable: false,
    })
    expect(buildFieldRows(SCHEMA, fields, true)).toHaveLength(3)
  })

  it.each([
    [null, ""],
    ["  获得  ", "获得"],
    [3, "3"],
    [["获得", "", "得到"], "获得；得到"],
    [{ a: 1 }, '{"a":1}'],
  ])("字段值 %j 显示成 %j", (value, expected) => {
    expect(formatFieldValue(value)).toBe(expected)
  })
})

describe("出错时的弹窗", () => {
  it("没连上扩展：给出原因，可以重试", () => {
    const state = buildErrorState(
      new BridgeRequestError("not_connected", "还没连上浏览器扩展。请打开浏览器……"),
      "obtain",
      "QQ",
    )
    expect(state).toEqual({
      kind: "error",
      text: "obtain",
      source: "QQ",
      title: "还没连上浏览器扩展",
      message: "还没连上浏览器扩展。请打开浏览器……",
      canRetry: true,
    })
  })

  it("文字太长：重试也没用，不给重试按钮", () => {
    const state = buildErrorState(
      new BridgeRequestError("text_too_long", "选中的文字太长了"),
      "x",
      null,
    )
    expect(state.canRetry).toBe(false)
  })

  it("没见过的错误统一叫「查词失败」", () => {
    expect(buildErrorState(new Error("boom"), "x", null)).toMatchObject({
      title: "查词失败",
      message: "boom",
      canRetry: true,
    })
  })

  it("没选中文字：提示先选中，说出快捷键", () => {
    const state = noSelectionState("Ctrl+Alt+D", "记事本")
    expect(state.title).toBe("没取到选中的文字")
    expect(state.message).toContain("Ctrl+Alt+D")
    expect(state.canRetry).toBe(false)
  })
})
