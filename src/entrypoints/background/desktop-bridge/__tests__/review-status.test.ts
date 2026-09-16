import { describe, expect, it, vi } from "vitest"
import { getReviewStatusForDesktop, openReviewPageForDesktop } from "../review-status"

describe("今天有几个词该复习", () => {
  it("到期的学习中、复习卡全算；新卡按每个生词本每天的上限封顶", async () => {
    const status = await getReviewStatusForDesktop({
      getStats: async () => ({
        a: { new: 50, learning: 2, review: 5 },
        b: { new: 3, learning: 0, review: 1 },
      }),
      getNewPerDay: async () => ({ a: 20, b: 20 }),
    })

    expect(status).toEqual({ due: 20 + 3 + 7 + 1, newCount: 23, reviewCount: 8 })
  })

  it("没有卡片就是 0", async () => {
    await expect(
      getReviewStatusForDesktop({ getStats: async () => ({}), getNewPerDay: async () => ({}) }),
    ).resolves.toEqual({ due: 0, newCount: 0, reviewCount: 0 })
  })

  it("不知道上限的生词本，新卡照实数", async () => {
    const status = await getReviewStatusForDesktop({
      getStats: async () => ({ a: { new: 4 } }),
      getNewPerDay: async () => ({}),
    })

    expect(status.newCount).toBe(4)
  })
})

describe("打开复习页", () => {
  it("打开扩展设置里的闪卡复习", async () => {
    const open = vi.fn<(...args: any[]) => Promise<void>>(async () => {})

    await expect(openReviewPageForDesktop(open)).resolves.toEqual({ opened: true })
    expect(open).toHaveBeenCalledWith({ route: "/review" })
  })
})
