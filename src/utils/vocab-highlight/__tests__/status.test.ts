import { describe, expect, it } from "vitest"
import { countByStatus, formatDueIn, MASTERED_STABILITY_DAYS, wordProgress } from "../status"

const DAY = 86_400_000
const NOW = Date.UTC(2026, 8, 16)

function card(overrides: Partial<Parameters<typeof wordProgress>[0][number]> = {}) {
  return {
    state: "review" as const,
    scheduleStatus: "review" as const,
    stability: 30,
    reps: 5,
    dueAt: new Date(NOW + 10 * DAY).toISOString(),
    ...overrides,
  }
}

describe("一个词学到什么程度", () => {
  it("没有卡片、还没复习过，都是新词", () => {
    expect(wordProgress([]).status).toBe("new")
    expect(wordProgress([card({ reps: 0, state: "new" })])).toEqual({ status: "new", dueAt: null })
  })

  it("在学、重学都是学习中", () => {
    expect(wordProgress([card({ state: "learning", stability: 1 })]).status).toBe("learning")
    expect(wordProgress([card({ state: "relearning", stability: 40 })]).status).toBe("learning")
  })

  it("复习阶段以稳定度 21 天为界：到了才算已掌握", () => {
    expect(wordProgress([card({ stability: MASTERED_STABILITY_DAYS })]).status).toBe("mastered")
    expect(wordProgress([card({ stability: MASTERED_STABILITY_DAYS - 0.1 })]).status).toBe(
      "learning",
    )
  })

  it("多张卡取记得最差的那张：只要有一种考法没过关就不算掌握", () => {
    const result = wordProgress([
      card({ stability: 60 }),
      card({ state: "learning", stability: 2 }),
    ])
    expect(result.status).toBe("learning")
  })

  it("暂停的卡不计；全部暂停就按新词算", () => {
    const suspended = card({ scheduleStatus: "suspended", state: "learning" })
    expect(wordProgress([suspended, card({ stability: 60 })]).status).toBe("mastered")
    expect(wordProgress([suspended]).status).toBe("new")
  })

  it("下次复习时间取最早到期的那张", () => {
    const soon = new Date(NOW + 2 * DAY).toISOString()
    const later = new Date(NOW + 9 * DAY).toISOString()
    expect(wordProgress([card({ dueAt: later }), card({ dueAt: soon })]).dueAt).toBe(soon)
  })
})

describe("下次复习时间的说法", () => {
  it("已到期、明天、几天后", () => {
    expect(formatDueIn(new Date(NOW - DAY).toISOString(), NOW)).toBe("今天")
    expect(formatDueIn(new Date(NOW + 20 * 3_600_000).toISOString(), NOW)).toBe("明天")
    expect(formatDueIn(new Date(NOW + 3 * DAY).toISOString(), NOW)).toBe("3 天后")
  })
})

describe("按状态计数", () => {
  it("三种状态分别数", () => {
    expect(countByStatus(["new", "mastered", "learning", "mastered"])).toEqual({
      new: 1,
      learning: 1,
      mastered: 2,
    })
  })
})
