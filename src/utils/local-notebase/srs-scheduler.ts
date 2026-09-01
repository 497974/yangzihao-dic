/**
 * 间隔重复调度器
 *
 * 用 ts-fsrs（FSRS 算法的标准实现）计算下次复习时间。
 * 本文件只负责「契约的数据结构 ⇄ FSRS 的数据结构」之间的转换。
 */

import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
} from "ts-fsrs"
import type { Card as FsrsCard, Grade, RecordLogItem } from "ts-fsrs"
import type { LocalCard } from "./srs-storage"

export type ReviewRating = "again" | "hard" | "good" | "easy"

/** 契约用字符串评分，FSRS 用 1..4 */
const RATING_TO_FSRS: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
}

/** FSRS 用数字状态，契约用字符串 */
const FSRS_STATE_TO_NAME = ["new", "learning", "review", "relearning"] as const

const NAME_TO_FSRS_STATE: Record<LocalCard["state"], State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
}

/** 卡片状态 → 调度状态（relearning 归入 learning 队列） */
export function cardStateToScheduleStatus(
  state: LocalCard["state"],
): "new" | "learning" | "review" {
  return state === "relearning" ? "learning" : state
}

export interface SchedulingParams {
  desiredRetention: number
  maximumInterval: number
  enableShortTerm: boolean
  learningSteps: string[]
  relearningSteps: string[]
  enableFuzz: boolean
  weights?: number[]
}

function buildScheduler(params: SchedulingParams) {
  return fsrs(generatorParameters({
    request_retention: params.desiredRetention,
    maximum_interval: params.maximumInterval,
    enable_short_term: params.enableShortTerm,
    enable_fuzz: params.enableFuzz,
    learning_steps: params.learningSteps as never,
    relearning_steps: params.relearningSteps as never,
    ...(params.weights?.length ? { w: params.weights } : {}),
  }))
}

/** 本地卡片 → FSRS 卡片 */
function toFsrsCard(card: LocalCard): FsrsCard {
  const empty = createEmptyCard(new Date(card.createdAt))
  return {
    ...empty,
    due: new Date(card.dueAt),
    stability: card.stability,
    difficulty: card.difficulty,
    // 新卡的 stability/difficulty 是 0，交给 FSRS 用初始值处理
    elapsed_days: 0,
    scheduled_days: 0,
    reps: card.reps,
    lapses: card.lapses,
    state: NAME_TO_FSRS_STATE[card.state],
    last_review: card.lastReviewTime ? new Date(card.lastReviewTime) : undefined,
    learning_steps: card.step,
  } as FsrsCard
}

export interface ScheduleResult {
  card: Pick<
    LocalCard,
    | "state" | "scheduleStatus" | "dueAt" | "lastReviewTime"
    | "stability" | "difficulty" | "step" | "lapses" | "reps"
  >
  snapshot: Record<string, unknown>
}

/**
 * 计算一次复习后的新状态。
 * reviewedAt 由调用方传入，便于测试与幂等重放。
 */
export function scheduleReview(
  card: LocalCard,
  rating: ReviewRating,
  params: SchedulingParams,
  reviewedAt: Date,
): ScheduleResult {
  const scheduler = buildScheduler(params)
  const result: RecordLogItem = scheduler.next(
    toFsrsCard(card),
    reviewedAt,
    RATING_TO_FSRS[rating],
  )

  const next = result.card
  const state = FSRS_STATE_TO_NAME[next.state] ?? "review"

  return {
    card: {
      state,
      scheduleStatus: cardStateToScheduleStatus(state),
      dueAt: next.due.toISOString(),
      lastReviewTime: reviewedAt.toISOString(),
      stability: next.stability,
      difficulty: next.difficulty,
      step: next.learning_steps ?? 0,
      lapses: next.lapses,
      reps: next.reps,
    },
    snapshot: {
      rating: RATING_TO_FSRS[rating],
      state: next.state,
      dueAt: next.due.toISOString(),
      stability: next.stability,
      difficulty: next.difficulty,
      scheduledDays: next.scheduled_days,
      learningSteps: next.learning_steps ?? 0,
      review: reviewedAt.toISOString(),
    },
  }
}

/** 新建卡片的初始记忆状态 */
export function initialCardMemory(now: Date) {
  const empty = createEmptyCard(now)
  return {
    state: "new" as const,
    scheduleStatus: "new" as const,
    dueAt: empty.due.toISOString(),
    lastReviewTime: null,
    stability: empty.stability,
    difficulty: empty.difficulty,
    step: 0,
    lapses: 0,
    reps: 0,
    buriedAt: null,
  }
}

/**
 * 渲染卡片正反面。
 * 模板里的 {{列名}} 会替换成该行对应单元格的值。
 */
export function renderPattern(
  pattern: string,
  cells: Record<string, unknown>,
  columns: { id: string, name: string }[],
): string {
  return pattern.replace(/\{\{([^}]+)\}\}/g, (_, rawName: string) => {
    const name = rawName.trim()
    const col = columns.find((c) => c.name === name || c.id === name)
    if (!col) return ""
    const v = cells[col.id]
    return v == null ? "" : String(v)
  })
}
