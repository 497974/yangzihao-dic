import { call } from "@orpc/server"
import { beforeEach, describe, expect, it } from "vitest"
import { storage } from "#imports"
import { localNotebaseRouter } from "../router"
import { mutateSrsDb, readSrsDb } from "../srs-storage"
import { mutateDb, readDb } from "../storage"

// 契约要求这些 id 是 UUID，随便编的字符串过不了输入校验
const NB = "11111111-1111-4111-8111-111111111111"
const ROW_KEEP = "22222222-2222-4222-8222-222222222222"
const ROW_GONE = "33333333-3333-4333-8333-333333333333"

async function seed() {
  await mutateDb((db) => {
    const ts = new Date().toISOString()
    db.notebases[NB] = {
      id: NB,
      userId: "local",
      name: "生词本",
      srsNewPerDay: -1,
      srsReviewsPerDay: -1,
      srsDesiredRetention: 0.9,
      srsEnableShortTerm: true,
      srsMaximumInterval: 36500,
      srsLearningSteps: ["1m", "10m"],
      srsRelearningSteps: ["10m"],
      srsLeechThreshold: 8,
      srsEnableFuzz: false,
      srsWeights: null,
      createdAt: ts,
      updatedAt: ts,
      notebaseColumns: [],
      notebaseRows: [
        { id: ROW_KEEP, notebaseId: NB, cells: {}, position: 0, createdAt: ts, updatedAt: ts },
        { id: ROW_GONE, notebaseId: NB, cells: {}, position: 1, createdAt: ts, updatedAt: ts },
      ],
      notebaseViews: [],
    }
  })

  await mutateSrsDb((srs) => {
    const ts = new Date().toISOString()
    for (const [cardId, rowId] of [
      ["card-keep", ROW_KEEP],
      ["card-gone", ROW_GONE],
    ] as const) {
      srs.cards[cardId] = {
        id: cardId,
        notebaseId: NB,
        notebaseRowId: rowId,
        templateId: "tpl",
        variantKey: "forward",
        state: "review",
        scheduleStatus: "review",
        dueAt: ts,
        lastReviewTime: null,
        buriedAt: null,
        stability: 1,
        difficulty: 1,
        reps: 1,
        lapses: 0,
        step: 0,
        createdAt: ts,
        updatedAt: ts,
      }
      srs.revlogs.push({
        id: `log-${cardId}`,
        notebaseId: NB,
        cardId,
        rating: "good",
        state: "review",
        stability: 1,
        afterScheduleStatus: "review",
        afterStability: 1,
        reviewedAt: ts,
        durationMs: 100,
        fsrsReviewLogSnapshot: {
          rating: 3,
          state: 2,
          dueAt: ts,
          stability: 1,
          difficulty: 1,
          scheduledDays: 1,
          learningSteps: 0,
          review: ts,
        },
        createdAt: ts,
        beforeCard: { ...srs.cards[cardId] },
      })
    }
  })
}

describe("删除生词时连带清理闪卡", () => {
  beforeEach(async () => {
    await storage.removeItem("local:localNotebaseDb")
    await storage.removeItem("local:localSrsDb")
    await seed()
  })

  it("删掉这一行，它的卡片和复习日志一起没了", async () => {
    // 卡片的正反面是拿 notebaseRowId 回笔记库取单元格现渲染的。行没了卡片还在，
    // 复习时就会蹦出一张正反面全空的幽灵卡，既答不了也删不掉。
    await call(localNotebaseRouter.notebaseRow.delete, { notebaseRowId: ROW_GONE })

    const srs = await readSrsDb()
    expect(srs.cards["card-gone"]).toBeUndefined()
    expect(srs.revlogs.map((l) => l.cardId)).not.toContain("card-gone")
  })

  it("不碰别的词的卡片和记录", async () => {
    await call(localNotebaseRouter.notebaseRow.delete, { notebaseRowId: ROW_GONE })

    const srs = await readSrsDb()
    expect(srs.cards["card-keep"]).toBeDefined()
    expect(srs.revlogs.map((l) => l.cardId)).toContain("card-keep")
  })

  it("行本身删掉了，剩下的行 position 重新排好", async () => {
    await call(localNotebaseRouter.notebaseRow.delete, { notebaseRowId: ROW_GONE })

    const db = await readDb()
    const rows = db.notebases[NB]!.notebaseRows
    expect(rows.map((r) => r.id)).toEqual([ROW_KEEP])
    expect(rows[0]!.position).toBe(0)
  })
})
