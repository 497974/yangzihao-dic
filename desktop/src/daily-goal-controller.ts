/**
 * 每日必学的总管：隔一阵子判断该不该锁屏、替锁屏页向扩展要题和交答案、托盘菜单里的开关。
 *
 * 规则（该不该锁、怎么算对、紧急解锁口令）在 daily-goal.ts；窗口在 lock-window.ts；
 * 这里把它们和浏览器扩展接起来。依赖都从外面传进来，测试里换成假的。
 *
 * 出问题时宁可放开也不把人关在外面：扩展是旧版不支持出题、没有题可出，都不锁。
 * 只有「没连上扩展」会锁住并提示去开浏览器——题目就在那边，连上了才能答。
 */

import type { MenuItemConstructorOptions } from "electron"
import type { DailyGoalQuestion, DailyGoalRequest, DailyGoalResult } from "./protocol"
import type { DesktopSettings } from "./settings"
import type { LockNext, LockProgress, LockSubmit } from "./shared/lock-api"
import {
  EMERGENCY_PHRASE,
  isAnswerCorrect,
  isEmergencyPhrase,
  localDateKey,
  LOCK_HOUR_CHOICES,
  lockVerdict,
  progressText,
  TARGET_CHOICES,
} from "./daily-goal"

export interface DailyGoalControllerDeps {
  server: {
    getStatus: () => { connected: boolean }
    supports: (feature: string) => boolean
    dailyGoal: (request: DailyGoalRequest) => Promise<DailyGoalResult>
    speak: (text: string) => Promise<{ audioBase64: string; contentType: string }>
  }
  settings: DesktopSettings
  save: () => void
  lock: {
    isShown: () => boolean
    show: () => void
    hide: () => void
    notifyDone: (
      reason: "done" | "empty" | "emergency" | "off",
      progress: LockProgress | null,
    ) => void
  }
  now: () => Date
  log: (tag: string, message: string) => void
  errorCode: (error: unknown) => string
  openBrowser: () => void
  /** 开启前的确认：说清楚会发生什么，返回用户是否同意 */
  confirmEnable: () => Promise<boolean>
  /** 命令行带了 --no-lock：完全不锁，出问题时的后路 */
  disabledByFlag: boolean
  /** 状态变了（进度、开关），托盘菜单要刷新 */
  onChange: () => void
  /** 完成后过多久关窗口，测试里传 0 */
  closeDelayMs?: number
}

const CHECK_INTERVAL_MS = 20_000
const OLD_EXTENSION_MESSAGE =
  "浏览器扩展版本太旧，不支持每日必学。请到 chrome://extensions 重新加载扩展"

export function createDailyGoalController(deps: DailyGoalControllerDeps) {
  const { settings, lock, server } = deps
  const closeDelay = deps.closeDelayMs ?? 2_800
  /** 扩展最近一次报来的今天答对数，带日期：过了零点就作废，不然昨天的进度会让今天误判完成 */
  let known: { date: string; done: number } | null = null
  let evaluating = false
  let warnedOldExtension = false
  let timer: ReturnType<typeof setInterval> | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  /** 发给锁屏页的题，按卡片 id 留着，判题时要用标准答案 */
  const questions = new Map<string, DailyGoalQuestion>()

  const today = () => localDateKey(deps.now())
  const goal = () => settings.dailyGoal
  const doneToday = () => (known && known.date === today() ? known.done : null)
  const progress = (): LockProgress => ({ done: doneToday() ?? 0, target: goal().target })

  function remember(done: number) {
    known = { date: today(), done }
    deps.onChange()
  }

  function scheduleHide() {
    if (hideTimer) {
      clearTimeout(hideTimer)
    }
    hideTimer = setTimeout(() => {
      hideTimer = null
      lock.hide()
    }, closeDelay)
  }

  /** 今天的任务算完成：当天不再锁；锁屏正盖着就先给个收尾画面再放开 */
  function release(reason: "done" | "empty" | "emergency" | "off") {
    if (reason === "done" || reason === "empty") {
      goal().metDate = today()
      deps.save()
    }
    deps.onChange()
    if (lock.isShown()) {
      lock.notifyDone(reason, progress())
      scheduleHide()
    }
  }

  async function fetchStatus() {
    const reply = await server.dailyGoal({ action: "status" })
    remember(reply.status.doneToday)
    return reply.status
  }

  /** 判断现在该不该锁：隔一阵子、连上扩展、唤醒电脑时都会跑一遍 */
  async function evaluate(): Promise<void> {
    if (evaluating) {
      return
    }
    evaluating = true
    try {
      if (deps.disabledByFlag || !goal().enabled) {
        if (lock.isShown()) {
          release("off")
        }
        return
      }
      let verdict = lockVerdict(goal(), deps.now(), doneToday())
      if (!verdict.lock) {
        if (lock.isShown()) {
          release(verdict.reason === "emergency" ? "emergency" : "done")
        }
        return
      }

      const connected = server.getStatus().connected
      if (connected && !server.supports("dailyGoal")) {
        // 旧版扩展出不了题：不锁，免得把人关在外面
        if (!warnedOldExtension) {
          warnedOldExtension = true
          deps.log("每日必学", "扩展版本太旧，不支持出题，这次不锁")
        }
        if (lock.isShown()) {
          release("off")
        }
        return
      }
      if (connected) {
        try {
          const status = await fetchStatus()
          verdict = lockVerdict(goal(), deps.now(), status.doneToday)
          if (verdict.lock && status.available === 0) {
            // 没有词可答（还没存词、或今天的都答完了）：锁着也没有意义
            deps.log("每日必学", "今天没有可答的词，不锁")
            release("empty")
            return
          }
        } catch (error) {
          deps.log("每日必学", `读不到进度：${deps.errorCode(error)}`)
        }
      }
      if (verdict.lock) {
        lock.show()
      } else {
        if (verdict.reason === "met" && goal().metDate !== today()) {
          // 在别处（浏览器的闪卡复习）已经答够了：记下来，今天不用再问扩展
          goal().metDate = today()
          deps.save()
          deps.onChange()
        }
        if (lock.isShown()) {
          release("done")
        }
      }
    } finally {
      evaluating = false
    }
  }

  async function next(exclude: string[]): Promise<LockNext> {
    if (!server.getStatus().connected) {
      return { ok: false, code: "not_connected", message: "还没连上浏览器扩展" }
    }
    if (!server.supports("dailyGoal")) {
      return { ok: false, code: "unsupported", message: OLD_EXTENSION_MESSAGE }
    }
    try {
      const reply = await server.dailyGoal({ action: "next", exclude })
      remember(reply.status.doneToday)
      if (reply.status.doneToday >= goal().target) {
        release("done")
        return { ok: true, progress: progress(), question: null }
      }
      if (!reply.question) {
        release("empty")
        return { ok: true, progress: progress(), question: null }
      }
      questions.set(reply.question.cardId, reply.question)
      return { ok: true, progress: progress(), question: reply.question }
    } catch (error) {
      const code = deps.errorCode(error)
      deps.log("每日必学", `要题失败：${code}`)
      return {
        ok: false,
        code,
        message: error instanceof Error && error.message ? error.message : "出题失败，稍后自动重试",
      }
    }
  }

  async function submit(cardId: string, typed: string, durationMs: number): Promise<LockSubmit> {
    const question = questions.get(cardId)
    if (!question) {
      return { ok: false, code: "unknown_question", message: "这道题已经过期了，请继续下一题" }
    }
    const correct = isAnswerCorrect(typed, question.answers)
    if (!correct && question.mode === "intro") {
      // 新词是照着抄：打错了让他再打，不记成绩
      return {
        ok: true,
        correct: false,
        retry: true,
        answers: question.answers,
        progress: progress(),
      }
    }
    try {
      const reply = await server.dailyGoal({ action: "answer", cardId, correct, durationMs })
      remember(reply.status.doneToday)
      questions.delete(cardId)
      if (reply.status.doneToday >= goal().target) {
        // 页面答完题会自己要下一题并收尾；它万一没来，这里兜底
        setTimeout(() => {
          if (lock.isShown() && (doneToday() ?? 0) >= goal().target) {
            release("done")
          }
        }, 3_000)
      }
      return {
        ok: true,
        correct,
        retry: false,
        answers: question.answers,
        progress: progress(),
      }
    } catch (error) {
      return {
        ok: false,
        code: deps.errorCode(error),
        message: "记录答案失败，请再提交一次",
      }
    }
  }

  async function speak(text: string) {
    if (!server.getStatus().connected || !server.supports("speak")) {
      return { ok: false as const }
    }
    try {
      return { ok: true as const, ...(await server.speak(text)) }
    } catch {
      return { ok: false as const }
    }
  }

  function emergency(phrase: string): boolean {
    if (!isEmergencyPhrase(phrase)) {
      return false
    }
    goal().emergencyDate = today()
    deps.save()
    deps.log("每日必学", "用了紧急解锁")
    release("emergency")
    return true
  }

  async function setEnabled(enabled: boolean) {
    if (enabled && !(await deps.confirmEnable())) {
      deps.onChange()
      return
    }
    goal().enabled = enabled
    if (enabled) {
      // 重新开启时，清掉之前的紧急解锁记录
      goal().emergencyDate = null
    }
    deps.save()
    deps.log("每日必学", enabled ? "已开启" : "已关闭")
    deps.onChange()
    await evaluate()
  }

  function setTarget(target: number) {
    goal().target = target
    deps.save()
    deps.onChange()
    void evaluate()
  }

  function setLockFromHour(hour: number) {
    goal().lockFromHour = hour
    deps.save()
    deps.onChange()
    void evaluate()
  }

  function statusLabel(): string {
    const g = goal()
    if (!g.enabled) {
      return "每日必学（强制）：未开启"
    }
    const done = doneToday()
    if (g.metDate === today()) {
      return `每日必学：今天已完成 ✓`
    }
    return `每日必学：今天 ${done === null ? "…" : progressText(done, g.target)}`
  }

  function menuItems(): MenuItemConstructorOptions[] {
    const g = goal()
    return [
      {
        label: statusLabel(),
        submenu: [
          {
            label: "开启（目标没完成就锁屏答题）",
            type: "checkbox",
            checked: g.enabled,
            click: (item) => void setEnabled(item.checked),
          },
          {
            label: `每天要答对：${g.target} 个`,
            submenu: TARGET_CHOICES.map((count) => ({
              label: `${count} 个`,
              type: "radio" as const,
              checked: g.target === count,
              click: () => setTarget(count),
            })),
          },
          {
            label:
              g.lockFromHour === 0 ? "锁定时段：一整天" : `锁定时段：${g.lockFromHour}:00 以后`,
            submenu: LOCK_HOUR_CHOICES.map((hour) => ({
              label: hour === 0 ? "一整天（开机就锁，做完才放开）" : `${hour}:00 以后才开始锁`,
              type: "radio" as const,
              checked: g.lockFromHour === hour,
              click: () => setLockFromHour(hour),
            })),
          },
          { type: "separator" },
          { label: "答的是生词本里到期的词，和闪卡复习是同一份进度", enabled: false },
          { label: "锁屏时出问题：Ctrl+Shift+Esc 结束本程序", enabled: false },
        ],
      },
    ]
  }

  return {
    evaluate,
    next,
    submit,
    speak,
    emergency,
    setEnabled,
    menuItems,
    statusLabel,
    getInit: () => ({ target: goal().target, emergencyPhrase: EMERGENCY_PHRASE }),
    start() {
      void evaluate()
      timer ??= setInterval(() => void evaluate(), CHECK_INTERVAL_MS)
    },
    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = null
      }
    },
  }
}

export type DailyGoalController = ReturnType<typeof createDailyGoalController>
