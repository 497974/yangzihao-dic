/**
 * 造句练习 · 进度与标记
 *
 * 存「哪句已掌握 / 哪句是生词」和累计做对次数，落在 chrome.storage.local。
 *
 * 刻意不接进 FSRS 卡片系统：闪卡排期排的是**单词**，这里练的是**句子**。
 * 两者混在一起会出现"句子写错了，把这个单词的复习间隔也拉近"的怪现象——
 * 明明单词认得，只是句子没拼对。所以这里自成一套轻量记录。
 */

import { storage } from "#imports"

/** 注意 "local:" 是 WXT 的区域前缀，写进真实 chrome.storage 时会被去掉 */
const PROGRESS_KEY = "local:sentencePracticeProgress"

export type SentenceMark = "mastered" | "difficult"

export interface SentencePracticeProgress {
  /** 生词本行 id → 标记 */
  marks: Record<string, SentenceMark>
  /** 生词本行 id → 累计一次做对的次数 */
  solved: Record<string, number>
}

function emptyProgress(): SentencePracticeProgress {
  return { marks: {}, solved: {} }
}

/**
 * 写操作串行化。chrome.storage 的读-改-写不是原子的，连续标记两句会互相覆盖
 * ——用一条 Promise 链把写排队（同 local-notebase/storage.ts 的做法）。
 */
let writeChain: Promise<unknown> = Promise.resolve()

export async function readProgress(): Promise<SentencePracticeProgress> {
  const raw = await storage.getItem<SentencePracticeProgress>(PROGRESS_KEY)
  if (!raw || typeof raw !== "object") return emptyProgress()
  return { marks: raw.marks ?? {}, solved: raw.solved ?? {} }
}

function mutateProgress(
  mutator: (progress: SentencePracticeProgress) => void,
): Promise<SentencePracticeProgress> {
  const run = writeChain.then(async () => {
    const progress = await readProgress()
    mutator(progress)
    await storage.setItem(PROGRESS_KEY, progress)
    return progress
  })
  // 即使这次失败也不能卡死后续写入
  writeChain = run.catch(() => undefined)
  return run
}

/** 传 null 表示取消标记 */
export function setSentenceMark(rowId: string, mark: SentenceMark | null) {
  return mutateProgress((progress) => {
    if (mark === null) delete progress.marks[rowId]
    else progress.marks[rowId] = mark
  })
}

export function recordSentenceSolved(rowId: string) {
  return mutateProgress((progress) => {
    progress.solved[rowId] = (progress.solved[rowId] ?? 0) + 1
  })
}

/**
 * 出题排序权重：生词优先冒头，已掌握的沉到最后。
 * 数越小越靠前。同一档内的顺序由调用方随机打乱，避免每次都一样。
 */
export function markSortWeight(mark: SentenceMark | undefined): number {
  if (mark === "difficult") return 0
  if (mark === "mastered") return 2
  return 1
}
