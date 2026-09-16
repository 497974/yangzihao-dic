import { describe, expect, it } from "vitest"
import { findDuplicateNotebaseRow, normalizeNotebaseTerm } from "../duplicate"

const COLUMNS = [
  { id: "term", isPrimary: true, position: 0 },
  { id: "meaning", isPrimary: false, position: 1 },
]
const ROWS = [
  { id: "r1", cells: { term: "obtain", meaning: "获得" } },
  { id: "r2", cells: { term: "take off", meaning: "起飞" } },
]

describe("生词本存词去重", () => {
  it("词条一样就算重复，不管释义写得一不一样", () => {
    expect(
      findDuplicateNotebaseRow(COLUMNS, ROWS, { term: "obtain", meaning: "得到；获取" }),
    ).toMatchObject({ id: "r1" })
  })

  it("忽略大小写、首尾空白和多余的空格", () => {
    expect(findDuplicateNotebaseRow(COLUMNS, ROWS, { term: "  Take   OFF " })).toMatchObject({
      id: "r2",
    })
  })

  it("新词不算重复", () => {
    expect(findDuplicateNotebaseRow(COLUMNS, ROWS, { term: "confront" })).toBeNull()
  })

  it("词条是空的就不判重，照常存", () => {
    expect(findDuplicateNotebaseRow(COLUMNS, [{ cells: { term: "" } }], { term: "" })).toBeNull()
  })

  it("没标主列时用排在最前面的那一列", () => {
    const columns = [
      { id: "meaning", position: 1 },
      { id: "term", position: 0 },
    ]
    expect(findDuplicateNotebaseRow(columns, ROWS, { term: "obtain" })).toMatchObject({ id: "r1" })
  })

  it("数字、对象这些非文字的格子当空处理", () => {
    expect(normalizeNotebaseTerm({ text: "obtain" })).toBe("")
    expect(normalizeNotebaseTerm(42)).toBe("42")
  })
})
