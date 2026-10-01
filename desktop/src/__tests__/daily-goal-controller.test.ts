import type { DailyGoalControllerDeps } from "../daily-goal-controller"
import type { DailyGoalQuestion, DailyGoalRequest, DailyGoalResult } from "../protocol"
import type { DesktopSettings } from "../settings"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_DAILY_GOAL, EMERGENCY_PHRASE, localDateKey } from "../daily-goal"
import { createDailyGoalController } from "../daily-goal-controller"

const NOW = new Date(2026, 9, 1, 12, 0, 0)

function question(partial: Partial<DailyGoalQuestion> = {}): DailyGoalQuestion {
  return {
    cardId: "k1",
    mode: "spell",
    word: "ambition",
    answers: ["ambition"],
    phonetic: "",
    partOfSpeech: "",
    definition: "野心",
    sentence: "",
    sentenceTranslation: "",
    mnemonic: "",
    ...partial,
  }
}

function setup(overrides: Partial<{ done: number; available: number; target: number }> = {}) {
  let shown = false
  let now = NOW
  const state = { done: overrides.done ?? 0, available: overrides.available ?? 5 }
  const settings = {
    dailyGoal: { ...DEFAULT_DAILY_GOAL, enabled: true, target: overrides.target ?? 3 },
  } as DesktopSettings
  const calls: DailyGoalRequest[] = []
  const dailyGoal = vi.fn<(request: DailyGoalRequest) => Promise<DailyGoalResult>>(
    async (request) => {
      calls.push(request)
      if (request.action === "answer" && request.correct) {
        state.done += 1
      }
      return {
        status: { doneToday: state.done, available: state.available },
        ...(request.action === "next" ? { question: question() } : {}),
      }
    },
  )
  const connection = { connected: true, features: ["dailyGoal", "speak"] }
  const lock = {
    isShown: () => shown,
    show: vi.fn(() => {
      shown = true
    }),
    hide: vi.fn(() => {
      shown = false
    }),
    notifyDone: vi.fn(),
  }
  const deps: DailyGoalControllerDeps = {
    server: {
      getStatus: () => ({ connected: connection.connected }),
      supports: (feature) => connection.features.includes(feature),
      dailyGoal,
      speak: async () => ({ audioBase64: "AAAA", contentType: "audio/mpeg" }),
    },
    settings,
    save: vi.fn(),
    lock,
    now: () => now,
    log: vi.fn(),
    errorCode: (error) => (error instanceof Error ? error.message : "unknown"),
    openBrowser: vi.fn(),
    confirmEnable: async () => true,
    disabledByFlag: false,
    onChange: vi.fn(),
    closeDelayMs: 0,
  }
  const controller = createDailyGoalController(deps)
  return {
    controller,
    deps,
    settings,
    lock,
    calls,
    state,
    connection,
    dailyGoal,
    setNow: (date: Date) => {
      now = date
    },
  }
}

describe("每日必学：该不该锁", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("没开就不锁，也不去问扩展", async () => {
    const { controller, lock, settings, dailyGoal } = setup()
    settings.dailyGoal.enabled = false

    await controller.evaluate()

    expect(lock.show).not.toHaveBeenCalled()
    expect(dailyGoal).not.toHaveBeenCalled()
  })

  it("开了、连着扩展、今天没答够：锁屏", async () => {
    const { controller, lock } = setup({ done: 1 })

    await controller.evaluate()

    expect(lock.show).toHaveBeenCalledTimes(1)
  })

  it("扩展报来今天已经答够了：不锁，并记下今天完成", async () => {
    const { controller, lock, settings } = setup({ done: 3 })

    await controller.evaluate()

    expect(lock.show).not.toHaveBeenCalled()
    expect(settings.dailyGoal.metDate).toBe(localDateKey(NOW))
  })

  it("没连上扩展：也锁（题目在浏览器里，提示去开浏览器）", async () => {
    const { controller, lock, connection, dailyGoal } = setup()
    connection.connected = false

    await controller.evaluate()

    expect(lock.show).toHaveBeenCalledTimes(1)
    expect(dailyGoal).not.toHaveBeenCalled()
  })

  it("扩展是旧版、出不了题：不锁，免得把人关在外面", async () => {
    const { controller, lock, connection } = setup()
    connection.features = ["lookup"]

    await controller.evaluate()

    expect(lock.show).not.toHaveBeenCalled()
  })

  it("今天没有词可答：不锁，当天也不再锁", async () => {
    const { controller, lock, settings } = setup({ available: 0 })

    await controller.evaluate()

    expect(lock.show).not.toHaveBeenCalled()
    expect(settings.dailyGoal.metDate).toBe(localDateKey(NOW))
  })

  it("命令行带 --no-lock：什么都不锁", async () => {
    const { controller, lock, deps } = setup()
    ;(deps as { disabledByFlag: boolean }).disabledByFlag = true

    await controller.evaluate()

    expect(lock.show).not.toHaveBeenCalled()
  })

  it("锁着的时候在别处（浏览器复习页）答够了：自动放开", async () => {
    const { controller, lock, state } = setup({ done: 0 })
    await controller.evaluate()
    expect(lock.show).toHaveBeenCalled()

    state.done = 3
    await controller.evaluate()
    await vi.runAllTimersAsync()

    expect(lock.notifyDone).toHaveBeenCalledWith("done", expect.anything())
    expect(lock.hide).toHaveBeenCalled()
  })

  it("昨天报来的进度不能算到今天头上", async () => {
    const { controller, lock, setNow, state, connection } = setup({ done: 3 })
    await controller.evaluate()
    expect(lock.show).not.toHaveBeenCalled()

    // 过了零点，扩展又连不上了：昨天的"答够了"不能让今天免锁
    setNow(new Date(2026, 9, 2, 0, 5, 0))
    state.done = 0
    connection.connected = false
    await controller.evaluate()

    expect(lock.show).toHaveBeenCalledTimes(1)
  })
})

describe("每日必学：锁屏页要题、交答案", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("没连上扩展时告诉页面原因，页面会自己重试", async () => {
    const { controller, connection } = setup()
    connection.connected = false

    await expect(controller.next([])).resolves.toMatchObject({ ok: false, code: "not_connected" })
  })

  it("要题：带回题目和进度，并把 exclude 交给扩展", async () => {
    const { controller, calls } = setup({ done: 1 })

    const reply = await controller.next(["k0"])

    expect(reply).toMatchObject({
      ok: true,
      progress: { done: 1, target: 3 },
      question: { cardId: "k1" },
    })
    expect(calls).toContainEqual({ action: "next", exclude: ["k0"] })
  })

  it("答对：交给扩展记「记得」，进度加一", async () => {
    const { controller, calls } = setup({ done: 1 })
    await controller.next([])

    const reply = await controller.submit("k1", "  Ambition ", 3000)

    expect(reply).toMatchObject({ ok: true, correct: true, retry: false, progress: { done: 2 } })
    expect(calls).toContainEqual({
      action: "answer",
      cardId: "k1",
      correct: true,
      durationMs: 3000,
    })
  })

  it("答错：记「忘了」，进度不变，页面拿到标准答案", async () => {
    const { controller, calls } = setup({ done: 1 })
    await controller.next([])

    const reply = await controller.submit("k1", "ambtion", 1000)

    expect(reply).toMatchObject({
      ok: true,
      correct: false,
      retry: false,
      answers: ["ambition"],
      progress: { done: 1 },
    })
    expect(calls).toContainEqual({
      action: "answer",
      cardId: "k1",
      correct: false,
      durationMs: 1000,
    })
  })

  it("新词是照着抄：打错了让他再打，不记成绩", async () => {
    const { controller, dailyGoal } = setup()
    dailyGoal.mockImplementationOnce(async () => ({
      status: { doneToday: 0, available: 5 },
      question: question({ mode: "intro" }),
    }))
    await controller.next([])
    dailyGoal.mockClear()

    const reply = await controller.submit("k1", "wrong", 500)

    expect(reply).toMatchObject({ ok: true, correct: false, retry: true })
    expect(dailyGoal).not.toHaveBeenCalled()
  })

  it("没要过的题不能交答案（防止乱发）", async () => {
    const { controller } = setup()

    await expect(controller.submit("never-asked", "x", 0)).resolves.toMatchObject({
      ok: false,
      code: "unknown_question",
    })
  })

  it("答够目标数后再要题：收尾，记下今天完成，一会儿关掉锁屏", async () => {
    const { controller, lock, settings, dailyGoal } = setup({ done: 2 })
    await controller.evaluate()
    expect(lock.show).toHaveBeenCalled()
    await controller.next([])
    await controller.submit("k1", "ambition", 1000)
    dailyGoal.mockClear()

    const reply = await controller.next([])
    await vi.runAllTimersAsync()

    expect(reply).toMatchObject({ ok: true, question: null })
    expect(settings.dailyGoal.metDate).toBe(localDateKey(NOW))
    expect(lock.notifyDone).toHaveBeenCalledWith("done", { done: 3, target: 3 })
    expect(lock.hide).toHaveBeenCalled()
  })

  it("没有更多词可出：当天放开", async () => {
    const { controller, lock, settings, dailyGoal } = setup({ done: 1 })
    await controller.evaluate()
    dailyGoal.mockImplementationOnce(async () => ({
      status: { doneToday: 1, available: 0 },
      question: null,
    }))

    await controller.next([])
    await vi.runAllTimersAsync()

    expect(settings.dailyGoal.metDate).toBe(localDateKey(NOW))
    expect(lock.notifyDone).toHaveBeenCalledWith("empty", expect.anything())
    expect(lock.hide).toHaveBeenCalled()
  })
})

describe("每日必学：紧急解锁和开关", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("口令不对不解锁；敲对了当天不再锁，锁屏收尾放开", async () => {
    const { controller, lock, settings } = setup()
    await controller.evaluate()

    expect(controller.emergency("随便敲点什么")).toBe(false)
    expect(lock.hide).not.toHaveBeenCalled()

    expect(controller.emergency(EMERGENCY_PHRASE)).toBe(true)
    await vi.runAllTimersAsync()

    expect(settings.dailyGoal.emergencyDate).toBe(localDateKey(NOW))
    expect(lock.notifyDone).toHaveBeenCalledWith("emergency", expect.anything())
    expect(lock.hide).toHaveBeenCalled()

    await controller.evaluate()
    expect(lock.show).toHaveBeenCalledTimes(1)
  })

  it("开启要先确认；点了取消就保持关闭", async () => {
    const { controller, deps, settings, lock } = setup()
    settings.dailyGoal.enabled = false
    ;(deps as { confirmEnable: () => Promise<boolean> }).confirmEnable = async () => false

    await controller.setEnabled(true)

    expect(settings.dailyGoal.enabled).toBe(false)
    expect(lock.show).not.toHaveBeenCalled()
  })

  it("确认后开启：存盘，并马上判断要不要锁", async () => {
    const { controller, deps, settings, lock } = setup()
    settings.dailyGoal.enabled = false

    await controller.setEnabled(true)

    expect(settings.dailyGoal.enabled).toBe(true)
    expect(deps.save).toHaveBeenCalled()
    expect(lock.show).toHaveBeenCalledTimes(1)
  })

  it("锁着的时候被关掉（比如改设置文件）：放开", async () => {
    const { controller, lock, settings } = setup()
    await controller.evaluate()
    expect(lock.show).toHaveBeenCalled()

    settings.dailyGoal.enabled = false
    await controller.evaluate()
    await vi.runAllTimersAsync()

    expect(lock.notifyDone).toHaveBeenCalledWith("off", expect.anything())
    expect(lock.hide).toHaveBeenCalled()
  })

  it("托盘上的状态文字：没开 / 进度 / 已完成", async () => {
    const { controller, settings } = setup({ done: 1 })
    settings.dailyGoal.enabled = false
    expect(controller.statusLabel()).toBe("每日必学（强制）：未开启")

    settings.dailyGoal.enabled = true
    expect(controller.statusLabel()).toBe("每日必学：今天 …")
    await controller.evaluate()
    expect(controller.statusLabel()).toBe("每日必学：今天 1 / 3")

    settings.dailyGoal.metDate = localDateKey(NOW)
    expect(controller.statusLabel()).toBe("每日必学：今天已完成 ✓")
  })
})
