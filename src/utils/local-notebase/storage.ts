/**
 * 本地笔记库 · 存储层
 *
 * 数据存在 chrome.storage.local，不依赖任何外部服务器或云端。
 * 装上扩展即可使用，无数量上限。
 */

import type { NotebaseView } from "@read-frog/api-contract"
import type { NotebaseColumnConfig, SrsStep } from "@read-frog/definitions"
import { storage } from "#imports"

export interface LocalNotebaseColumn {
  id: string
  notebaseId: string
  name: string
  // 列的类型配置是契约里的判别联合（string / number / boolean / date / …），
  // 之前写成 unknown，导致 notebase.get 与 getSchema 的输出形状对不上契约
  config: NotebaseColumnConfig
  position: number
  isPrimary: boolean
  width: number | null
  wrap: boolean
  createdAt: string
  updatedAt: string
}

export interface LocalNotebaseRow {
  id: string
  notebaseId: string
  cells: Record<string, unknown>
  position: number
  createdAt: string
  updatedAt: string
}

export interface LocalNotebase {
  id: string
  userId: string
  name: string
  srsNewPerDay: number
  srsReviewsPerDay: number
  srsDesiredRetention: number
  srsEnableShortTerm: boolean
  srsMaximumInterval: number
  // 契约里这两个是 "1m" / "10m" 这样的步长字符串（SrsStep），不是数字。
  // 早先误写成 number[]，各处只好用强转把类型糊过去，现在按真实形状声明。
  srsLearningSteps: SrsStep[]
  srsRelearningSteps: SrsStep[]
  srsLeechThreshold: number
  srsEnableFuzz: boolean
  srsWeights: number[] | null
  createdAt: string
  updatedAt: string
  notebaseColumns: LocalNotebaseColumn[]
  notebaseRows: LocalNotebaseRow[]
  // 本地实现不提供多视图（看板／画廊），这里恒为空数组；
  // 但类型要跟契约一致，否则 notebase.get 的输出形状对不上。
  notebaseViews: NotebaseView[]
}

export interface LocalNotebaseDb {
  txid: number
  notebases: Record<string, LocalNotebase>
}

const DB_KEY = "local:localNotebaseDb"

function emptyDb(): LocalNotebaseDb {
  return { txid: 0, notebases: {} }
}

/**
 * 写操作串行化。chrome.storage 的读-改-写不是原子的，
 * 并发保存两个生词会互相覆盖 —— 用一条 Promise 链把写操作排队。
 */
let writeChain: Promise<unknown> = Promise.resolve()

export async function readDb(): Promise<LocalNotebaseDb> {
  const raw = await storage.getItem<LocalNotebaseDb>(DB_KEY)
  if (!raw || typeof raw !== "object" || !raw.notebases) return emptyDb()
  return raw
}

/**
 * 以串行方式读出、修改、写回。mutator 返回值即本次调用的结果。
 */
export function mutateDb<T>(mutator: (db: LocalNotebaseDb) => T): Promise<T> {
  const run = writeChain.then(async () => {
    const db = await readDb()
    const result = mutator(db)
    await storage.setItem(DB_KEY, db)
    return result
  })
  // 即使本次失败也不能卡死后续写入
  writeChain = run.catch(() => undefined)
  return run
}

export function nextTxid(db: LocalNotebaseDb): number {
  db.txid = (db.txid || 0) + 1
  return db.txid
}

export function nowIso(): string {
  return new Date().toISOString()
}
