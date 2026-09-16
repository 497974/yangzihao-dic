import { describe, expect, it } from "vitest"
import { queuedState } from "../popup-model"

describe("浏览器没开时的提示", () => {
  it("刚记下：告诉用户打开浏览器后会自动存，以及一共记了几个", () => {
    const state = queuedState("added", "obtain", "QQ", 3)

    expect(state).toMatchObject({
      kind: "queued",
      text: "obtain",
      source: "QQ",
      title: "已记下，打开浏览器后自动查",
    })
    expect(state.message).toContain("一共记了 3 个词")
  })

  it("已经记过了", () => {
    expect(queuedState("already_queued", "obtain", null, 1).title).toBe("这个词已经记下了")
  })

  it("满了：让用户先打开浏览器", () => {
    const state = queuedState("full", "obtain", null, 200)

    expect(state.title).toBe("记不下了")
    expect(state.message).toContain("200")
  })
})
