/**
 * 每日必学：桌面版在目标没完成时把屏幕锁住，让用户当场答题。题目和判分都在这里出——
 * 生词本和复习记录都存在扩展里，桌面版只负责显示和锁屏。
 *
 * 答题直接走闪卡复习的 srs.review，所以锁屏时答的题和在复习页答的题是同一份进度，
 * 「今天已经完成几个」也是从同一份复习记录里数出来的。
 *
 * 出题顺序：到期的复习卡 → 今天还能学的新词 → 今天答错、本来要稍后再见的卡（让用户当场再来一遍）。
 * 每道题都要把词亲手打出来，不是点一下「记得」就算过——不然几秒钟点完，等于没锁。
 */

import type { LocalCard, LocalRevlog } from "@/utils/local-notebase/srs-storage"
import type { LocalNotebase, LocalNotebaseDb } from "@/utils/local-notebase/storage"
import { call } from "@orpc/server"
import { localSrsRouter } from "@/utils/local-notebase/srs-router"
import { readSrsDb } from "@/utils/local-notebase/srs-storage"
import { readDb } from "@/utils/local-notebase/storage"
import { cellToText } from "@/utils/notebase/cell-text"

/** 默认卡片模板生成的列名（和闪卡复习页一致） */
const FIELD = {
  phonetic: "音标",
  partOfSpeech: "词性",
  definition: "释义",
  sentence: "句子",
  sentenceTranslation: "句子翻译",
  mnemonic: "助记",
} as const

/**
 * 题型：
 *   intro —— 今天第一次见的新词：把词、释义、例句都给出来，照着打一遍
 *   spell —— 只给中文释义，把英文拼出来
 *   cloze —— 给例句的中文和挖掉这个词的英文句子，把词补上
 */
export type DailyGoalQuestionMode = "intro" | "spell" | "cloze"

export interface DailyGoalQuestion {
  cardId: string
  mode: DailyGoalQuestionMode
  word: string
  /** 都算对的写法：词条本身，加上例句里实际出现的变形（went / going） */
  answers: string[]
  phonetic: string
  partOfSpeech: string
  definition: string
  /** intro 是完整例句；cloze 是挖掉这个词之后的句子；spell 为空 */
  sentence: string
  sentenceTranslation: string
  mnemonic: string
}

export interface DailyGoalStatus {
  /** 今天已经答对的题数（含在闪卡复习页答的） */
  doneToday: number
  /** 现在还能出的题数：到期的卡 + 今天还能学的新词 */
  available: number
}

export interface DailyGoalResult {
  status: DailyGoalStatus
  /** next 请求带回下一题；没有题可出（今天的词都答完了）是 null */
  question?: DailyGoalQuestion | null
}

export type DailyGoalRequest =
  | { action: "status" }
  | { action: "next"; exclude?: string[] }
  | { action: "answer"; cardId: string; correct: boolean; durationMs?: number }

type CardWithFields = { card: LocalCard; fields: Record<string, string>; word: string }

export function startOfLocalDay(now: Date): Date {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return start
}

export function endOfLocalDay(now: Date): Date {
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  return end
}

function isReviewedToday(log: LocalRevlog, dayStart: Date): boolean {
  return new Date(log.reviewedAt).getTime() >= dayStart.getTime()
}

/** 今天答对（没选「忘了」）的次数 */
export function countDoneToday(revlogs: LocalRevlog[], now: Date): number {
  const dayStart = startOfLocalDay(now)
  return revlogs.filter((log) => isReviewedToday(log, dayStart) && log.rating !== "again").length
}

function primaryColumnId(notebase: LocalNotebase): string | undefined {
  const columns = [...notebase.notebaseColumns].sort((a, b) => a.position - b.position)
  return (columns.find((column) => column.isPrimary) ?? columns[0])?.id
}

function readFields(notebase: LocalNotebase, rowId: string): Record<string, string> | null {
  const row = notebase.notebaseRows.find((item) => item.id === rowId)
  if (!row) {
    return null
  }
  const nameById = new Map(notebase.notebaseColumns.map((column) => [column.id, column.name]))
  const fields: Record<string, string> = {}
  for (const [columnId, value] of Object.entries(row.cells ?? {})) {
    const name = nameById.get(columnId)
    if (name) {
      fields[name] = cellToText(value).trim()
    }
  }
  const primary = primaryColumnId(notebase)
  const word = primary ? cellToText(row.cells?.[primary]).trim() : ""
  fields.__word = word
  return fields
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** 在例句里找到这个词（含 -s / -ed / -ing 这类变形），把它挖掉 */
export function maskWordInSentence(
  sentence: string,
  word: string,
): { masked: string; matched: string } | null {
  if (!sentence || !word) {
    return null
  }
  const pattern = new RegExp(`\\b${escapeRegExp(word)}[A-Za-z']{0,4}\\b`, "i")
  const match = pattern.exec(sentence)
  if (!match) {
    return null
  }
  const blank = "＿".repeat(Math.max(3, match[0].length))
  return {
    masked: `${sentence.slice(0, match.index)}${blank}${sentence.slice(match.index + match[0].length)}`,
    matched: match[0],
  }
}

function buildQuestion(item: CardWithFields): DailyGoalQuestion {
  const { card, fields, word } = item
  const sentence = fields[FIELD.sentence] ?? ""
  const sentenceTranslation = fields[FIELD.sentenceTranslation] ?? ""
  const base = {
    cardId: card.id,
    word,
    answers: [word],
    phonetic: fields[FIELD.phonetic] ?? "",
    partOfSpeech: fields[FIELD.partOfSpeech] ?? "",
    definition: fields[FIELD.definition] ?? "",
    mnemonic: fields[FIELD.mnemonic] ?? "",
    sentenceTranslation,
  }

  if (card.state === "new" || card.reps === 0) {
    return { ...base, mode: "intro", sentence }
  }

  // 有例句的词，隔一次出一道填空，其余是中译英；两种都要靠自己想起来
  const masked =
    card.reps % 2 === 0 && sentenceTranslation ? maskWordInSentence(sentence, word) : null
  if (masked) {
    const answers = [...new Set([word, masked.matched])]
    return { ...base, mode: "cloze", answers, sentence: masked.masked }
  }
  return { ...base, mode: "spell", sentence: "" }
}

interface PickInput {
  db: LocalNotebaseDb
  cards: LocalCard[]
  revlogs: LocalRevlog[]
  now: Date
  exclude: string[]
}

/** 按顺序排好现在能出的卡：到期的 → 今天还能学的新词 → 今天答错、稍后才到期的 */
export function listAvailableCards({
  db,
  cards,
  revlogs,
  now,
  exclude,
}: PickInput): CardWithFields[] {
  const dayStart = startOfLocalDay(now)
  const dayEnd = endOfLocalDay(now)
  const skip = new Set(exclude)

  const newIntroducedToday = new Map<string, number>()
  for (const log of revlogs) {
    if (log.state === "new" && isReviewedToday(log, dayStart)) {
      newIntroducedToday.set(log.notebaseId, (newIntroducedToday.get(log.notebaseId) ?? 0) + 1)
    }
  }
  const newBudget = new Map<string, number>()
  for (const notebase of Object.values(db.notebases)) {
    newBudget.set(
      notebase.id,
      Math.max(0, notebase.srsNewPerDay - (newIntroducedToday.get(notebase.id) ?? 0)),
    )
  }

  const resolve = (card: LocalCard): CardWithFields | null => {
    const notebase = db.notebases[card.notebaseId]
    const fields = notebase ? readFields(notebase, card.notebaseRowId) : null
    const word = fields?.__word ?? ""
    return fields && word ? { card, fields, word } : null
  }

  const usable = cards.filter(
    (card) =>
      card.scheduleStatus !== "suspended" && card.scheduleStatus !== "buried" && !skip.has(card.id),
  )
  const dueNow = usable
    .filter((card) => card.state !== "new" && new Date(card.dueAt).getTime() <= now.getTime())
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
  const fresh: LocalCard[] = []
  for (const card of [...usable]
    .filter((item) => item.state === "new")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const left = newBudget.get(card.notebaseId) ?? 0
    if (left > 0) {
      fresh.push(card)
      newBudget.set(card.notebaseId, left - 1)
    }
  }
  const retryLater = usable
    .filter(
      (card) =>
        card.state !== "new" &&
        new Date(card.dueAt).getTime() > now.getTime() &&
        new Date(card.dueAt).getTime() <= dayEnd.getTime() &&
        (card.state === "learning" || card.state === "relearning"),
    )
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())

  return [...dueNow, ...fresh, ...retryLater]
    .map(resolve)
    .filter((item): item is CardWithFields => item !== null)
}

export interface DailyGoalDeps {
  readDb: () => Promise<LocalNotebaseDb>
  readSrsDb: () => Promise<{ cards: Record<string, LocalCard>; revlogs: LocalRevlog[] }>
  /** 新存的词还没有卡片，出题前先补上 */
  ensureCards: (notebaseIds: string[]) => Promise<void>
  review: (input: { cardId: string; rating: "again" | "good"; durationMs: number }) => Promise<void>
  now: () => Date
}

const defaultDeps: DailyGoalDeps = {
  readDb,
  readSrsDb,
  ensureCards: async (notebaseIds) => {
    for (const notebaseId of notebaseIds) {
      await call(localSrsRouter.card.generate, { notebaseId })
    }
  },
  review: async (input) => {
    await call(localSrsRouter.srs.review, {
      ...input,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
  },
  now: () => new Date(),
}

async function snapshot(deps: DailyGoalDeps) {
  const db = await deps.readDb()
  await deps.ensureCards(Object.keys(db.notebases))
  const srs = await deps.readSrsDb()
  return { db, cards: Object.values(srs.cards), revlogs: srs.revlogs }
}

export async function handleDailyGoal(
  request: DailyGoalRequest,
  deps: DailyGoalDeps = defaultDeps,
): Promise<DailyGoalResult> {
  if (request.action === "answer") {
    await deps.review({
      cardId: request.cardId,
      rating: request.correct ? "good" : "again",
      durationMs: Math.max(0, Math.round(request.durationMs ?? 0)),
    })
  }

  const { db, cards, revlogs } = await snapshot(deps)
  const now = deps.now()
  const available = listAvailableCards({ db, cards, revlogs, now, exclude: [] })
  const status: DailyGoalStatus = {
    doneToday: countDoneToday(revlogs, now),
    available: available.length,
  }

  if (request.action !== "next") {
    return { status }
  }

  const candidates = listAvailableCards({
    db,
    cards,
    revlogs,
    now,
    exclude: request.exclude ?? [],
  })
  // 只剩刚做过的那一张时，宁可重复也别说"没有题了"，让用户把今天的目标做完
  const picked = candidates[0] ?? available[0] ?? null
  return { status, question: picked ? buildQuestion(picked) : null }
}
