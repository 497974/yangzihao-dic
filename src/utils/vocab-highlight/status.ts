/**
 * 生词本里一个词学到什么程度了（阶段五实现方案 · 步骤 1）。
 *
 * 全部取自本地闪卡的 FSRS 记录，用户不用手动维护——
 * LingQ 那种「自己点着改颜色」的做法，时间一长没人坚持，颜色就不准了。
 *
 *   新词   生词本里有，但还没复习过
 *   学习中 在学 / 重学，或者复习间隔还不稳（稳定度不到 21 天）
 *   已掌握 进入复习阶段且稳定度 ≥ 21 天
 *
 * 21 天沿用 Anki 的「成熟卡」门槛：记忆能稳定保持三周以上，基本不会再忘。
 */

import type { LocalCard } from "@/utils/local-notebase/srs-storage"

export type WordStatus = "new" | "learning" | "mastered"

export const MASTERED_STABILITY_DAYS = 21

export const WORD_STATUS_LABEL: Record<WordStatus, string> = {
  new: "新词",
  learning: "学习中",
  mastered: "已掌握",
}

type CardLike = Pick<LocalCard, "state" | "scheduleStatus" | "stability" | "reps" | "dueAt">

function cardStatus(card: CardLike): WordStatus {
  if (card.reps === 0 || card.state === "new") {
    return "new"
  }
  if (card.state === "review" && card.stability >= MASTERED_STABILITY_DAYS) {
    return "mastered"
  }
  return "learning"
}

/** 状态从「差」到「好」的顺序，一个词有多张卡时取最差的那张 */
const RANK: Record<WordStatus, number> = { new: 0, learning: 1, mastered: 2 }

export interface WordProgress {
  status: WordStatus
  /** 最早到期的那张卡的下次复习时间；新词或没有卡时为 null */
  dueAt: string | null
}

/**
 * 一个词（生词本里的一行）可能有好几张卡（不同题型模板）。
 * 取记得最差的那张定状态：只要有一种考法还没过关，就不算掌握。
 * 暂停的卡不计——那是用户主动不学了；全部暂停或没有卡，就按新词算。
 */
export function wordProgress(cards: readonly CardLike[]): WordProgress {
  const active = cards.filter((card) => card.scheduleStatus !== "suspended")
  if (active.length === 0) {
    return { status: "new", dueAt: null }
  }
  let status: WordStatus = "mastered"
  let dueAt: string | null = null
  for (const card of active) {
    const current = cardStatus(card)
    if (RANK[current] < RANK[status]) {
      status = current
    }
    if (current !== "new" && (dueAt === null || card.dueAt < dueAt)) {
      dueAt = card.dueAt
    }
  }
  return { status, dueAt: status === "new" ? null : dueAt }
}

/** 下次复习时间 → 「今天」「明天」「3 天后」 */
export function formatDueIn(dueAt: string, now = Date.now()): string {
  const days = Math.ceil((new Date(dueAt).getTime() - now) / 86_400_000)
  if (days <= 0) {
    return "今天"
  }
  if (days === 1) {
    return "明天"
  }
  return `${days} 天后`
}

export function countByStatus(statuses: Iterable<WordStatus>): Record<WordStatus, number> {
  const counts: Record<WordStatus, number> = { new: 0, learning: 0, mastered: 0 }
  for (const status of statuses) {
    counts[status] += 1
  }
  return counts
}
