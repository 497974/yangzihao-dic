/**
 * 每日必学（强制）的规则：什么时候该锁屏、怎么解锁。
 *
 * 这里全是不碰 Electron 的纯函数，方便测试。锁屏窗口见 lock-window.ts，
 * 题目和判分在浏览器扩展里（桌面版方案之外新增的 dailyGoal 消息）。
 *
 * 设计上特别小心的一点：锁住自己的电脑是件危险的事，出任何问题都不能把人关在外面。所以
 *   - 默认关闭，开启前要确认
 *   - 扩展是旧版（不支持出题）时不锁
 *   - 提供紧急解锁（手敲一句话，不能粘贴），解锁当天不再锁
 *   - 锁屏窗口不挡任务管理器（Ctrl+Shift+Esc），命令行加 --no-lock 启动可完全禁用
 */

export interface DailyGoalSettings {
  /** 总开关，默认关 */
  enabled: boolean
  /** 每天必须答对几道题 */
  target: number
  /** 几点以后才开始锁（0 = 一整天，开机就锁） */
  lockFromHour: number
  /** 哪天已经完成了目标（本地日期 YYYY-MM-DD）；当天不会再锁 */
  metDate: string | null
  /** 哪天用了紧急解锁；当天不会再锁 */
  emergencyDate: string | null
}

export const DEFAULT_DAILY_GOAL: DailyGoalSettings = {
  enabled: false,
  target: 10,
  lockFromHour: 0,
  metDate: null,
  emergencyDate: null,
}

export const TARGET_CHOICES = [5, 10, 15, 20, 30, 50] as const
export const LOCK_HOUR_CHOICES = [0, 6, 8, 12, 18, 20, 21, 22] as const

/** 紧急解锁要手敲的一句话：长到不是随手一点就能过，又短到真有急事时敲得完 */
export const EMERGENCY_PHRASE = "我承认我在偷懒，今天先放过我这一次"

export function localDateKey(date: Date): string {
  return date.toLocaleDateString("sv")
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}

function dateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

/** 把存盘里读出来的任意东西整理成合法的设置（文件被手改坏了也不会崩） */
export function normalizeDailyGoal(raw: unknown): DailyGoalSettings {
  const saved = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    enabled: saved.enabled === true,
    target: clampInt(saved.target, 1, 200, DEFAULT_DAILY_GOAL.target),
    lockFromHour: clampInt(saved.lockFromHour, 0, 23, DEFAULT_DAILY_GOAL.lockFromHour),
    metDate: dateOrNull(saved.metDate),
    emergencyDate: dateOrNull(saved.emergencyDate),
  }
}

export type LockVerdict =
  | { lock: true }
  | { lock: false; reason: "off" | "met" | "emergency" | "too-early" }

/**
 * 现在该不该锁。doneToday = 扩展报来的今天已答对数，还不知道（没连上）传 null。
 * 已经完成过一次，当天就不会再锁——哪怕之后又拖到别的日期的事。
 */
export function lockVerdict(
  goal: DailyGoalSettings,
  now: Date,
  doneToday: number | null,
): LockVerdict {
  if (!goal.enabled) {
    return { lock: false, reason: "off" }
  }
  const today = localDateKey(now)
  if (goal.emergencyDate === today) {
    return { lock: false, reason: "emergency" }
  }
  if (goal.metDate === today || (doneToday !== null && doneToday >= goal.target)) {
    return { lock: false, reason: "met" }
  }
  if (now.getHours() < goal.lockFromHour) {
    return { lock: false, reason: "too-early" }
  }
  return { lock: true }
}

export function isEmergencyPhrase(input: string): boolean {
  return input.trim() === EMERGENCY_PHRASE
}

/** 前台是这些程序时，锁屏窗口不去抢焦点——这是出问题时的逃生通道 */
const NEVER_STEAL_FROM = new Set([
  "taskmgr.exe",
  "processhacker.exe",
  "procexp.exe",
  "procexp64.exe",
])

export function shouldRefocus(foregroundExe: string | null): boolean {
  return !(foregroundExe && NEVER_STEAL_FROM.has(foregroundExe.toLowerCase()))
}

/** 锁屏上显示的进度：已答对 / 目标，最多显示到满格 */
export function progressText(done: number | null, target: number): string {
  return `${Math.min(done ?? 0, target)} / ${target}`
}

/** 判一道题对不对：不分大小写、多余空格不算错；answers 里任何一个写法都算对 */
export function isAnswerCorrect(input: string, answers: string[]): boolean {
  const normalize = (text: string) =>
    text
      .trim()
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/\s+/g, " ")
  const typed = normalize(input)
  return typed.length > 0 && answers.some((answer) => normalize(answer) === typed)
}
