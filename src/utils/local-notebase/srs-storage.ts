/**
 * 本地闪卡与间隔重复 · 存储层
 *
 * 卡片、卡片模板、复习日志都存在 chrome.storage.local，与笔记库同源，
 * 不依赖任何服务器。
 */

import { storage } from "#imports"

export interface LocalCardTemplate {
  id: string
  notebaseId: string
  name: string
  config: { type: "basic", frontPattern: string, backPattern: string }
  createdAt: string
  updatedAt: string
}

export interface LocalCard {
  id: string
  notebaseId: string
  notebaseRowId: string
  templateId: string
  variantKey: string
  // 记忆状态（FSRS）
  state: "new" | "learning" | "review" | "relearning"
  scheduleStatus: "new" | "learning" | "review" | "suspended" | "buried"
  dueAt: string
  lastReviewTime: string | null
  stability: number
  difficulty: number
  step: number
  lapses: number
  reps: number
  buriedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface LocalRevlog {
  id: string
  notebaseId: string
  cardId: string
  rating: "again" | "hard" | "good" | "easy"
  state: LocalCard["state"]
  stability: number
  afterScheduleStatus: LocalCard["scheduleStatus"]
  afterStability: number
  reviewedAt: string
  durationMs: number
  fsrsReviewLogSnapshot: Record<string, unknown>
  createdAt: string
  /** 回滚用：记录复习前的完整卡片状态 */
  beforeCard: Omit<LocalCard, "createdAt" | "updatedAt">
}

export interface LocalSrsDb {
  txid: number
  templates: Record<string, LocalCardTemplate>
  cards: Record<string, LocalCard>
  revlogs: LocalRevlog[]
}

const SRS_KEY = "local:localSrsDb"

function emptyDb(): LocalSrsDb {
  return { txid: 0, templates: {}, cards: {}, revlogs: [] }
}

/**
 * 与笔记库同样的串行化写入。复习时连续点评分很快，
 * 读-改-写不串行会丢掉评分记录。
 */
let writeChain: Promise<unknown> = Promise.resolve()

export async function readSrsDb(): Promise<LocalSrsDb> {
  const raw = await storage.getItem<LocalSrsDb>(SRS_KEY)
  if (!raw || typeof raw !== "object" || !raw.cards) return emptyDb()
  return { ...emptyDb(), ...raw }
}

export function mutateSrsDb<T>(mutator: (db: LocalSrsDb) => T): Promise<T> {
  const run = writeChain.then(async () => {
    const db = await readSrsDb()
    const result = mutator(db)
    await storage.setItem(SRS_KEY, db)
    return result
  })
  writeChain = run.catch(() => undefined)
  return run
}

export function nextSrsTxid(db: LocalSrsDb): number {
  db.txid = (db.txid || 0) + 1
  return db.txid
}
