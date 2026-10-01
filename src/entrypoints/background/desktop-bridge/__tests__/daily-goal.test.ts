import type { DailyGoalDeps } from "../daily-goal"
import type { LocalCard, LocalRevlog } from "@/utils/local-notebase/srs-storage"
import type { LocalNotebaseDb } from "@/utils/local-notebase/storage"
import { describe, expect, it, vi } from "vitest"
import { countDoneToday, handleDailyGoal, maskWordInSentence } from "../daily-goal"

const NOW = new Date(2026, 9, 1, 15, 0, 0)
const HOUR = 3_600_000

function iso(offsetMs: number) {
  return new Date(NOW.getTime() + offsetMs).toISOString()
}

/** 一个生词本：列是 词条/释义/句子/句子翻译，每行一个词 */
function makeDb(
  rows: {
    id: string
    word: string
    definition?: string
    sentence?: string
    translation?: string
  }[],
  newPerDay = 20,
): LocalNotebaseDb {
  return {
    txid: 1,
    notebases: {
      nb1: {
        id: "nb1",
        name: "生词",
        srsNewPerDay: newPerDay,
        notebaseColumns: [
          { id: "c-word", name: "词条", position: 0, isPrimary: true },
          { id: "c-def", name: "释义", position: 1, isPrimary: false },
          { id: "c-sen", name: "句子", position: 2, isPrimary: false },
          { id: "c-tr", name: "句子翻译", position: 3, isPrimary: false },
        ],
        notebaseRows: rows.map((row) => ({
          id: row.id,
          cells: {
            "c-word": row.word,
            "c-def": row.definition ?? `${row.word}的释义`,
            "c-sen": row.sentence ?? "",
            "c-tr": row.translation ?? "",
          },
        })),
      },
    },
  } as unknown as LocalNotebaseDb
}

function card(partial: Partial<LocalCard> & { id: string; notebaseRowId: string }): LocalCard {
  return {
    notebaseId: "nb1",
    templateId: "t1",
    variantKey: "basic",
    state: "review",
    scheduleStatus: "review",
    dueAt: iso(-HOUR),
    lastReviewTime: null,
    stability: 5,
    difficulty: 5,
    step: 0,
    lapses: 0,
    reps: 1,
    buriedAt: null,
    createdAt: iso(-24 * HOUR),
    updatedAt: iso(-24 * HOUR),
    ...partial,
  }
}

function revlog(partial: Partial<LocalRevlog>): LocalRevlog {
  return {
    id: Math.random().toString(),
    notebaseId: "nb1",
    cardId: "x",
    rating: "good",
    state: "review",
    reviewedAt: iso(-HOUR),
    ...partial,
  } as LocalRevlog
}

function makeDeps(opts: {
  db: LocalNotebaseDb
  cards: LocalCard[]
  revlogs?: LocalRevlog[]
}): DailyGoalDeps & { review: ReturnType<typeof vi.fn> } {
  const review = vi.fn<DailyGoalDeps["review"]>(async () => {})
  return {
    readDb: async () => opts.db,
    readSrsDb: async () => ({
      cards: Object.fromEntries(opts.cards.map((c) => [c.id, c])),
      revlogs: opts.revlogs ?? [],
    }),
    ensureCards: async () => {},
    review,
    now: () => NOW,
  }
}

describe("今天答对了几个", () => {
  it("只数今天、没选「忘了」的", () => {
    const logs = [
      revlog({ reviewedAt: iso(-HOUR) }),
      revlog({ reviewedAt: iso(-HOUR), rating: "easy" }),
      revlog({ reviewedAt: iso(-HOUR), rating: "again" }),
      revlog({ reviewedAt: iso(-30 * HOUR) }),
    ]

    expect(countDoneToday(logs, NOW)).toBe(2)
  })
})

describe("例句里挖掉这个词", () => {
  it("连变形一起挖，并记下例句里实际的写法", () => {
    expect(maskWordInSentence("She went home early.", "went")).toMatchObject({ matched: "went" })
    const result = maskWordInSentence("He is walking fast.", "walk")
    expect(result?.matched).toBe("walking")
    expect(result?.masked).not.toContain("walking")
  })

  it("例句里找不到这个词就是 null", () => {
    expect(maskWordInSentence("Nothing here.", "apple")).toBeNull()
  })
})

describe("出题", () => {
  it("到期的复习卡先出，题型按这张卡复习过几次轮换：奇数次中译英", async () => {
    const deps = makeDeps({
      db: makeDb([{ id: "r1", word: "ambition", definition: "野心" }]),
      cards: [card({ id: "k1", notebaseRowId: "r1", reps: 1 })],
    })

    const result = await handleDailyGoal({ action: "next" }, deps)

    expect(result.question).toMatchObject({
      cardId: "k1",
      mode: "spell",
      word: "ambition",
      answers: ["ambition"],
      definition: "野心",
      sentence: "",
    })
    expect(result.status).toEqual({ doneToday: 0, available: 1 })
  })

  it("偶数次且有例句：出填空题，答案包含例句里的变形", async () => {
    const deps = makeDeps({
      db: makeDb([
        {
          id: "r1",
          word: "walk",
          sentence: "He is walking fast.",
          translation: "他走得很快。",
        },
      ]),
      cards: [card({ id: "k1", notebaseRowId: "r1", reps: 2 })],
    })

    const { question } = await handleDailyGoal({ action: "next" }, deps)

    expect(question?.mode).toBe("cloze")
    expect(question?.answers).toEqual(["walk", "walking"])
    expect(question?.sentence).not.toContain("walking")
    expect(question?.sentenceTranslation).toBe("他走得很快。")
  })

  it("例句里找不到这个词，填空退回中译英", async () => {
    const deps = makeDeps({
      db: makeDb([{ id: "r1", word: "apple", sentence: "Nothing here.", translation: "没有。" }]),
      cards: [card({ id: "k1", notebaseRowId: "r1", reps: 2 })],
    })

    expect((await handleDailyGoal({ action: "next" }, deps)).question?.mode).toBe("spell")
  })

  it("新词先给「照着打一遍」的 intro 题，并带上完整例句", async () => {
    const deps = makeDeps({
      db: makeDb([{ id: "r1", word: "novel", sentence: "A novel idea.", translation: "新想法。" }]),
      cards: [card({ id: "k1", notebaseRowId: "r1", state: "new", reps: 0 })],
    })

    const { question } = await handleDailyGoal({ action: "next" }, deps)

    expect(question).toMatchObject({ mode: "intro", sentence: "A novel idea." })
  })

  it("新词按每天上限封顶，今天已经学满的不再出", async () => {
    const deps = makeDeps({
      db: makeDb(
        [
          { id: "r1", word: "a1" },
          { id: "r2", word: "a2" },
        ],
        1,
      ),
      cards: [
        card({ id: "k1", notebaseRowId: "r1", state: "new", reps: 0 }),
        card({ id: "k2", notebaseRowId: "r2", state: "new", reps: 0 }),
      ],
      revlogs: [revlog({ state: "new", reviewedAt: iso(-HOUR) })],
    })

    const result = await handleDailyGoal({ action: "next" }, deps)

    expect(result.question).toBeNull()
    expect(result.status.available).toBe(0)
  })

  it("到期的排在新词前面；被搁置、被埋起来的卡不出", async () => {
    const deps = makeDeps({
      db: makeDb([
        { id: "r1", word: "fresh" },
        { id: "r2", word: "due" },
        { id: "r3", word: "paused" },
      ]),
      cards: [
        card({ id: "k1", notebaseRowId: "r1", state: "new", reps: 0 }),
        card({ id: "k2", notebaseRowId: "r2" }),
        card({ id: "k3", notebaseRowId: "r3", scheduleStatus: "suspended" }),
      ],
    })

    const { question, status } = await handleDailyGoal({ action: "next" }, deps)

    expect(question?.word).toBe("due")
    expect(status.available).toBe(2)
  })

  it("今天答错、几分钟后才到期的卡，没别的可出时当场再出一遍", async () => {
    const deps = makeDeps({
      db: makeDb([{ id: "r1", word: "again" }]),
      cards: [
        card({
          id: "k1",
          notebaseRowId: "r1",
          state: "relearning",
          scheduleStatus: "learning",
          dueAt: iso(10 * 60_000),
        }),
      ],
    })

    expect((await handleDailyGoal({ action: "next" }, deps)).question?.word).toBe("again")
  })

  it("exclude 里的卡尽量不重复出；但只剩它时宁可重复，不说没题了", async () => {
    const deps = makeDeps({
      db: makeDb([
        { id: "r1", word: "one" },
        { id: "r2", word: "two" },
      ]),
      cards: [card({ id: "k1", notebaseRowId: "r1" }), card({ id: "k2", notebaseRowId: "r2" })],
    })

    expect((await handleDailyGoal({ action: "next", exclude: ["k1"] }, deps)).question?.word).toBe(
      "two",
    )

    const onlyOne = makeDeps({
      db: makeDb([{ id: "r1", word: "one" }]),
      cards: [card({ id: "k1", notebaseRowId: "r1" })],
    })
    expect(
      (await handleDailyGoal({ action: "next", exclude: ["k1"] }, onlyOne)).question?.word,
    ).toBe("one")
  })

  it("没有任何卡片：没题可出", async () => {
    const deps = makeDeps({ db: makeDb([]), cards: [] })

    await expect(handleDailyGoal({ action: "next" }, deps)).resolves.toEqual({
      status: { doneToday: 0, available: 0 },
      question: null,
    })
  })
})

describe("交答案", () => {
  it("答对记「记得」，答错记「忘了」，并带回最新进度", async () => {
    const deps = makeDeps({
      db: makeDb([{ id: "r1", word: "one" }]),
      cards: [card({ id: "k1", notebaseRowId: "r1" })],
    })

    await handleDailyGoal({ action: "answer", cardId: "k1", correct: true, durationMs: 4200 }, deps)
    await handleDailyGoal({ action: "answer", cardId: "k1", correct: false }, deps)

    expect(deps.review).toHaveBeenNthCalledWith(1, {
      cardId: "k1",
      rating: "good",
      durationMs: 4200,
    })
    expect(deps.review).toHaveBeenNthCalledWith(2, {
      cardId: "k1",
      rating: "again",
      durationMs: 0,
    })
  })
})
