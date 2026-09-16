import { beforeEach, describe, expect, it } from "vitest"
import { storage } from "#imports"
import { readSrsDb } from "@/utils/local-notebase/srs-storage"
import { LOOKUP_HISTORY_KEY, MAX_HISTORY_ENTRIES, recordDictionaryLookup } from "../lookup-history"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 8, 15, 8)

/** 生词本里存了 obtain，它有一张复习卡，dueAt 由测试决定 */
async function seed(card: { scheduleStatus: string; dueAt: number }) {
  await storage.setItem("local:localNotebaseDb", {
    txid: 1,
    notebases: {
      nb: {
        id: "nb",
        name: "生词本",
        notebaseColumns: [
          { id: "term", name: "词条", position: 0, isPrimary: true },
          { id: "meaning", name: "释义", position: 1, isPrimary: false },
        ],
        notebaseRows: [
          { id: "row-obtain", cells: { term: "obtain", meaning: "获得" }, position: 0 },
        ],
      },
    },
  })
  await storage.setItem("local:localSrsDb", {
    txid: 1,
    templates: {},
    revlogs: [],
    cards: {
      c1: {
        id: "c1",
        notebaseId: "nb",
        notebaseRowId: "row-obtain",
        state: card.scheduleStatus === "new" ? "new" : "review",
        scheduleStatus: card.scheduleStatus,
        dueAt: new Date(card.dueAt).toISOString(),
      },
    },
  })
}

const dueOf = async () => new Date((await readSrsDb()).cards.c1!.dueAt).getTime()

describe("查词次数", () => {
  beforeEach(async () => {
    await storage.removeItem(LOOKUP_HISTORY_KEY)
    await storage.removeItem("local:localNotebaseDb")
    await storage.removeItem("local:localSrsDb")
  })

  it("每查一次加一，不管大小写和多余的空白", async () => {
    await expect(recordDictionaryLookup("Take off", NOW)).resolves.toEqual({
      count: 1,
      inNotebase: false,
      reviewBumped: false,
    })
    await expect(recordDictionaryLookup(" take   OFF ", NOW)).resolves.toMatchObject({ count: 2 })
  })

  it("空的、太长的（整句）不算查词", async () => {
    await expect(recordDictionaryLookup("   ")).resolves.toBeNull()
    await expect(recordDictionaryLookup("word ".repeat(20))).resolves.toBeNull()
  })

  it("存过的词又查了一次：排在以后的复习卡提前到今天", async () => {
    await seed({ scheduleStatus: "review", dueAt: NOW + 10 * DAY })

    await expect(recordDictionaryLookup("obtain", NOW)).resolves.toEqual({
      count: 1,
      inNotebase: true,
      reviewBumped: false,
    })
    expect(await dueOf()).toBe(NOW + 10 * DAY)

    await expect(recordDictionaryLookup("Obtain", NOW)).resolves.toMatchObject({
      count: 2,
      reviewBumped: true,
    })
    expect(await dueOf()).toBe(NOW)
  })

  it("还没学过的新卡、已经到期的卡不动", async () => {
    await seed({ scheduleStatus: "new", dueAt: NOW + DAY })
    await recordDictionaryLookup("obtain", NOW)

    await expect(recordDictionaryLookup("obtain", NOW)).resolves.toMatchObject({
      reviewBumped: false,
    })
    expect(await dueOf()).toBe(NOW + DAY)
  })

  it("记太多时丢掉最久没查的", async () => {
    const history = Object.fromEntries(
      Array.from({ length: MAX_HISTORY_ENTRIES }, (_, index) => [
        `w${index}`,
        { count: 1, lastAt: index },
      ]),
    )
    await storage.setItem(LOOKUP_HISTORY_KEY, history)

    await recordDictionaryLookup("newest", MAX_HISTORY_ENTRIES + 1)

    const saved = (await storage.getItem<Record<string, unknown>>(LOOKUP_HISTORY_KEY))!
    expect(Object.keys(saved)).toHaveLength(MAX_HISTORY_ENTRIES)
    expect(saved.newest).toBeDefined()
    expect(saved.w0).toBeUndefined()
  })
})
