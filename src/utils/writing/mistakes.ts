/**
 * 写作错题本（功能路线图阶段四第 4 条）：改出来的错存下来，过些天再练一遍。
 *
 * 常犯的错才值得练，所以按「练对过几次」排序——练对得越少越先出现。
 * 单独存一个键，不进生词本：生词本的一行是一个词，错题是一条「原句 → 改法」，
 * 硬塞进去会把闪卡也搅乱。
 */

import type { WritingCorrection } from "./parse"
import { storage } from "#imports"
import { getRandomUUID } from "@/utils/crypto-polyfill"

export const WRITING_MISTAKES_KEY = "local:writingMistakesDb" as const

/** 攒到这么多条就把最早的挤掉：几百条之后，最早那批早就不是「常犯的错」了 */
export const MAX_MISTAKES = 300

export interface WritingMistake extends WritingCorrection {
  id: string
  createdAt: number
  /** 重练时答对过几次 */
  practiced: number
  lastPracticedAt?: number
}

export type WritingMistakesDb = WritingMistake[]

/** 同一条错（原文和改法都一样）不重复存 */
function isSame(a: WritingCorrection, b: WritingCorrection): boolean {
  return (
    a.original.trim().toLowerCase() === b.original.trim().toLowerCase() &&
    a.corrected.trim().toLowerCase() === b.corrected.trim().toLowerCase()
  )
}

export function addMistakes(
  db: WritingMistakesDb,
  corrections: readonly WritingCorrection[],
  now = Date.now(),
): WritingMistakesDb {
  const next = [...db]
  for (const correction of corrections) {
    if (next.some((mistake) => isSame(mistake, correction))) {
      continue
    }
    next.push({ ...correction, id: getRandomUUID(), createdAt: now, practiced: 0 })
  }
  return next.slice(-MAX_MISTAKES)
}

export function removeMistake(db: WritingMistakesDb, id: string): WritingMistakesDb {
  return db.filter((mistake) => mistake.id !== id)
}

export function markPracticed(
  db: WritingMistakesDb,
  id: string,
  now = Date.now(),
): WritingMistakesDb {
  return db.map((mistake) =>
    mistake.id === id
      ? { ...mistake, practiced: mistake.practiced + 1, lastPracticedAt: now }
      : mistake,
  )
}

/** 重练的出题顺序：练对得最少的排前面，一样少的先出最早记下的 */
export function practiceOrder(db: WritingMistakesDb): WritingMistakesDb {
  return [...db].sort((a, b) => a.practiced - b.practiced || a.createdAt - b.createdAt)
}

/** 按错误类型统计，告诉用户最该先改掉哪个习惯 */
export function countByType(db: WritingMistakesDb): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>()
  for (const mistake of db) {
    counts.set(mistake.type, (counts.get(mistake.type) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
}

export async function readMistakes(): Promise<WritingMistakesDb> {
  return (await storage.getItem<WritingMistakesDb>(WRITING_MISTAKES_KEY)) ?? []
}

export async function writeMistakes(db: WritingMistakesDb): Promise<void> {
  await storage.setItem(WRITING_MISTAKES_KEY, db)
}
