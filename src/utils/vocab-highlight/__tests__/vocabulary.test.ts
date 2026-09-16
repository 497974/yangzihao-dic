import type { LocalNotebaseDb } from "@/utils/local-notebase/storage"
import { describe, expect, it } from "vitest"
import { buildMatcher, buildVocabulary, findVocabMatches } from "../vocabulary"

function column(id: string, name: string, position: number, isPrimary = false) {
  return {
    id,
    notebaseId: "nb",
    name,
    config: { type: "string" },
    position,
    isPrimary,
    width: null,
    wrap: false,
    createdAt: "",
    updatedAt: "",
  }
}

function dbWith(
  columns: ReturnType<typeof column>[],
  rows: Array<Record<string, string>>,
): LocalNotebaseDb {
  return {
    txid: 1,
    notebases: {
      nb: {
        notebaseColumns: columns,
        notebaseRows: rows.map((cells, index) => ({
          id: `r${index}`,
          notebaseId: "nb",
          cells,
          position: index,
          createdAt: "",
          updatedAt: "",
        })),
      },
    },
  } as unknown as LocalNotebaseDb
}

const DICTIONARY_COLUMNS = [
  column("term", "词条", 0, true),
  column("phonetic", "音标", 1),
  column("meaning", "释义", 2),
  column("example", "例句", 3),
]

describe("生词本 → 词表", () => {
  it("取出词条、音标和释义", () => {
    const vocab = buildVocabulary(
      dbWith(DICTIONARY_COLUMNS, [
        { term: "Obtain", phonetic: "/əbˈteɪn/", meaning: "获得", example: "..." },
      ]),
    )

    // 没传闪卡库：只关心有哪些词的地方不必读闪卡库，一律按新词算
    expect(vocab.get("obtain")).toEqual({
      term: "Obtain",
      phonetic: "/əbˈteɪn/",
      meaning: "获得",
      status: "new",
      dueAt: null,
    })
  })

  it("传入闪卡库时，按生词本的行关联卡片，得出每个词的学习状态", () => {
    const db = dbWith(DICTIONARY_COLUMNS, [
      { term: "obtain", phonetic: "", meaning: "获得", example: "" },
      { term: "confront", phonetic: "", meaning: "面对", example: "" },
      { term: "abandon", phonetic: "", meaning: "放弃", example: "" },
    ])
    const due = "2026-10-01T00:00:00.000Z"
    const card = (rowId: string, state: string, stability: number, reps: number) => ({
      id: `c-${rowId}`,
      notebaseRowId: rowId,
      state,
      scheduleStatus: state,
      stability,
      reps,
      dueAt: due,
    })
    const srsDb = {
      txid: 1,
      templates: {},
      revlogs: [],
      cards: {
        a: card("r0", "review", 40, 6),
        b: card("r1", "learning", 1, 1),
      },
    } as unknown as Parameters<typeof buildVocabulary>[1]

    const vocab = buildVocabulary(db, srsDb)

    expect(vocab.get("obtain")).toMatchObject({ status: "mastered", dueAt: due })
    expect(vocab.get("confront")).toMatchObject({ status: "learning" })
    expect(vocab.get("abandon")).toMatchObject({ status: "new", dueAt: null })
  })

  it("列名不认识时，第二列当释义", () => {
    const vocab = buildVocabulary(
      dbWith(
        [column("a", "Word", 0, true), column("b", "Notes", 1)],
        [{ a: "confront", b: "面对" }],
      ),
    )

    expect(vocab.get("confront")).toMatchObject({ meaning: "面对", phonetic: "" })
  })

  it("中文、整句、太短的词不标；同一个词只留一份", () => {
    const vocab = buildVocabulary(
      dbWith(DICTIONARY_COLUMNS, [
        { term: "获得" },
        { term: "It is a nice day." },
        { term: "to" },
        { term: "take  off" },
        { term: "Take off" },
      ]),
    )

    expect([...vocab.keys()]).toEqual(["take off"])
  })
})

describe("在文字里找生词", () => {
  const vocab = buildVocabulary(
    dbWith(DICTIONARY_COLUMNS, [{ term: "obtain" }, { term: "take off" }, { term: "take" }]),
  )
  const matcher = buildMatcher(vocab)!

  it("认得常见的词尾变化，不管大小写", () => {
    const text = "Obtains, obtained and obtaining a permit."

    expect(findVocabMatches(text, matcher).map((m) => text.slice(m.start, m.end))).toEqual([
      "Obtains",
      "obtained",
      "obtaining",
    ])
  })

  it("短语优先于里面的单词，中间换行也算", () => {
    const text = "The plane will take\noff soon, take care."

    expect(findVocabMatches(text, matcher).map((m) => m.key)).toEqual(["take off", "take"])
  })

  it("只匹配整个词，不匹配词的一部分", () => {
    expect(findVocabMatches("unobtainable mistake", matcher)).toEqual([])
  })

  it("空词表没有正则", () => {
    expect(buildMatcher(new Map())).toBeNull()
  })
})
