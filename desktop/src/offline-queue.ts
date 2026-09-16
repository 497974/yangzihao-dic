/**
 * 离线收词队列（桌面版方案第 7 步）：浏览器没开、扩展没连上时，按快捷键或点工具栏上的词典，
 * 先把词记在本地；扩展一连上就自动补查、补存进生词本。
 *
 * 存在 %APPDATA%\yangzihao-dic-desktop\offline-queue.json，关掉桌面版、重启电脑都不丢。
 * 这里只管队列本身（加、去重、依次处理、失败计数）；查词存词从外面传进来，方便测试。
 */

import fs from "node:fs"
import path from "node:path"

export interface QueuedWord {
  /** 选中的文字 */
  text: string
  /** 选中文字所在的那一段（读得到的话） */
  context?: string
  /** 来源程序，比如 QQ */
  source: string | null
  /** 划词工具栏上的哪个动作；没有就是内置词典 */
  actionId?: string
  /** 动作的名字，给人看的 */
  actionName: string
  addedAt: number
  /** 补查失败过几次 */
  attempts: number
}

export type NewQueuedWord = Omit<QueuedWord, "addedAt" | "attempts">

/** 最多记这么多个：真攒到这么多，多半是哪里出了问题，别无限涨 */
export const MAX_QUEUED_WORDS = 200
/** 补查失败这么多次就放弃（比如这个动作已经被删了），免得每次连上都卡在它身上 */
export const MAX_ATTEMPTS = 3

/**
 * 处理一个词的结果：
 * - saved / duplicate：存好了（或者生词本里本来就有），从队列里拿掉
 * - retry_later：扩展又断了、超时了——这次先停，等下次连上再从这个词接着来
 * - failed：这个词本身有问题，记一次失败，失败够次数就放弃
 */
export type QueuedWordOutcome = "saved" | "duplicate" | "retry_later" | "failed"

export interface DrainSummary {
  saved: number
  duplicate: number
  /** 失败次数到了上限、被放弃的 */
  dropped: number
  /** 还留在队列里等下次的 */
  remaining: number
}

export interface OfflineQueueStore {
  load: () => QueuedWord[]
  save: (words: QueuedWord[]) => void
}

function isQueuedWord(value: unknown): value is QueuedWord {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const word = value as Record<string, unknown>
  return (
    typeof word.text === "string" &&
    word.text.trim() !== "" &&
    typeof word.actionName === "string" &&
    typeof word.addedAt === "number" &&
    typeof word.attempts === "number" &&
    (word.source === null || typeof word.source === "string") &&
    (word.context === undefined || typeof word.context === "string") &&
    (word.actionId === undefined || typeof word.actionId === "string")
  )
}

/** 存成一个 JSON 文件；文件坏了就当队列是空的，不能因此起不来 */
export function createFileQueueStore(file: string): OfflineQueueStore {
  return {
    load() {
      try {
        const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"))
        return Array.isArray(raw) ? raw.filter(isQueuedWord) : []
      } catch {
        return []
      }
    },
    save(words) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, `${JSON.stringify(words, null, 2)}\n`)
      } catch (error) {
        console.error("保存离线收词队列失败", error)
      }
    },
  }
}

/** 同一个动作、同一个词（不管大小写、首尾空白）只记一次 */
function keyOf(word: Pick<QueuedWord, "text" | "actionId">): string {
  return `${word.actionId ?? ""}\n${word.text.trim().replace(/\s+/g, " ").toLowerCase()}`
}

export function createOfflineQueue(store: OfflineQueueStore, now: () => number = Date.now) {
  let words = store.load()
  let draining = false

  const persist = () => store.save(words)

  return {
    size: () => words.length,
    list: (): QueuedWord[] => words.map((word) => ({ ...word })),

    add(word: NewQueuedWord): "added" | "already_queued" | "full" {
      const key = keyOf(word)
      if (words.some((queued) => keyOf(queued) === key)) {
        return "already_queued"
      }
      if (words.length >= MAX_QUEUED_WORDS) {
        return "full"
      }
      words.push({ ...word, text: word.text.trim(), addedAt: now(), attempts: 0 })
      persist()
      return "added"
    },

    /** 全部清掉（用户在托盘里选了不存了） */
    clear() {
      words = []
      persist()
    },

    /** 正在补查时再调用会直接返回 null：连接反复断开重连时不会同时跑两遍 */
    async drain(
      process: (word: QueuedWord) => Promise<QueuedWordOutcome>,
    ): Promise<DrainSummary | null> {
      if (draining) {
        return null
      }
      draining = true
      const summary: DrainSummary = { saved: 0, duplicate: 0, dropped: 0, remaining: 0 }
      try {
        for (const word of [...words]) {
          let outcome: QueuedWordOutcome
          try {
            outcome = await process(word)
          } catch {
            outcome = "failed"
          }
          if (outcome === "retry_later") {
            break
          }
          const key = keyOf(word)
          if (outcome === "saved" || outcome === "duplicate") {
            summary[outcome] += 1
            words = words.filter((queued) => keyOf(queued) !== key)
          } else {
            const attempts = word.attempts + 1
            if (attempts >= MAX_ATTEMPTS) {
              summary.dropped += 1
              words = words.filter((queued) => keyOf(queued) !== key)
            } else {
              words = words.map((queued) =>
                keyOf(queued) === key ? { ...queued, attempts } : queued,
              )
            }
          }
          persist()
        }
      } finally {
        draining = false
      }
      summary.remaining = words.length
      return summary
    },
  }
}

export type OfflineQueue = ReturnType<typeof createOfflineQueue>
