import { describe, expect, it } from "vitest"
import { sortNewestFirst } from "../index"

describe("生词本排序", () => {
  it("最新保存的排最上面", () => {
    // position 是入库顺序：新行 push 到末尾，所以最大的就是最近存的
    const rows = [
      { id: "第一个存的", position: 0 },
      { id: "第二个存的", position: 1 },
      { id: "刚存的", position: 2 },
    ]

    expect(sortNewestFirst(rows).map((r) => r.id)).toEqual(["刚存的", "第二个存的", "第一个存的"])
  })

  it("不改动传进来的数组", () => {
    const rows = [{ position: 0 }, { position: 1 }]
    sortNewestFirst(rows)
    expect(rows.map((r) => r.position)).toEqual([0, 1])
  })
})
