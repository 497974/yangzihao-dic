import { describe, expect, it } from "vitest"
import {
  DEFAULT_DAILY_GOAL,
  EMERGENCY_PHRASE,
  isAnswerCorrect,
  isEmergencyPhrase,
  localDateKey,
  lockVerdict,
  normalizeDailyGoal,
  progressText,
  shouldRefocus,
} from "../daily-goal"

const NOON = new Date(2026, 9, 1, 12, 0, 0)
const TODAY = localDateKey(NOON)
const ON = { ...DEFAULT_DAILY_GOAL, enabled: true, target: 10 }

describe("该不该锁屏", () => {
  it("没开就不锁", () => {
    expect(lockVerdict(DEFAULT_DAILY_GOAL, NOON, 0)).toEqual({ lock: false, reason: "off" })
  })

  it("开了、没完成、过了开始时间：锁；还不知道进度（没连上）也锁", () => {
    expect(lockVerdict(ON, NOON, 3)).toEqual({ lock: true })
    expect(lockVerdict(ON, NOON, null)).toEqual({ lock: true })
  })

  it("答够目标数就不锁，哪怕没记录过完成日期", () => {
    expect(lockVerdict(ON, NOON, 10)).toEqual({ lock: false, reason: "met" })
    expect(lockVerdict(ON, NOON, 25)).toEqual({ lock: false, reason: "met" })
  })

  it("今天已经完成过：不再锁，不用再问扩展", () => {
    expect(lockVerdict({ ...ON, metDate: TODAY }, NOON, null)).toEqual({
      lock: false,
      reason: "met",
    })
  })

  it("昨天完成的不算今天", () => {
    expect(lockVerdict({ ...ON, metDate: "2026-09-30" }, NOON, 0)).toEqual({ lock: true })
  })

  it("还没到开始锁的钟点：不锁", () => {
    const evening = { ...ON, lockFromHour: 21 }
    expect(lockVerdict(evening, NOON, 0)).toEqual({ lock: false, reason: "too-early" })
    expect(lockVerdict(evening, new Date(2026, 9, 1, 21, 0, 0), 0)).toEqual({ lock: true })
  })

  it("用了紧急解锁，当天不再锁", () => {
    expect(lockVerdict({ ...ON, emergencyDate: TODAY }, NOON, 0)).toEqual({
      lock: false,
      reason: "emergency",
    })
  })
})

describe("读设置", () => {
  it("缺项补默认值，数值夹在合理范围，日期格式不对当没有", () => {
    expect(normalizeDailyGoal(undefined)).toEqual(DEFAULT_DAILY_GOAL)
    expect(
      normalizeDailyGoal({ enabled: true, target: 9999, lockFromHour: -3, metDate: "昨天" }),
    ).toEqual({ ...DEFAULT_DAILY_GOAL, enabled: true, target: 200, lockFromHour: 0 })
    expect(normalizeDailyGoal({ target: "十个", enabled: "yes" })).toEqual(DEFAULT_DAILY_GOAL)
  })
})

describe("紧急解锁", () => {
  it("必须一字不差敲对那句话（首尾空格不算）", () => {
    expect(isEmergencyPhrase(EMERGENCY_PHRASE)).toBe(true)
    expect(isEmergencyPhrase(`  ${EMERGENCY_PHRASE}\n`)).toBe(true)
    expect(isEmergencyPhrase("我承认我在偷懒")).toBe(false)
    expect(isEmergencyPhrase("")).toBe(false)
  })
})

describe("任务管理器是逃生通道", () => {
  it("前台是任务管理器时不抢焦点，其他时候抢", () => {
    expect(shouldRefocus("Taskmgr.exe")).toBe(false)
    expect(shouldRefocus("taskmgr.exe")).toBe(false)
    expect(shouldRefocus("chrome.exe")).toBe(true)
    expect(shouldRefocus(null)).toBe(true)
  })
})

describe("判题", () => {
  it("不分大小写，多余空格不算错，任何一个认可的写法都对", () => {
    expect(isAnswerCorrect("  Walking ", ["walk", "walking"])).toBe(true)
    expect(isAnswerCorrect("give   up", ["give up"])).toBe(true)
    expect(isAnswerCorrect("don’t", ["don't"])).toBe(true)
  })

  it("空答案、拼错都不对", () => {
    expect(isAnswerCorrect("", ["walk"])).toBe(false)
    expect(isAnswerCorrect("wlak", ["walk"])).toBe(false)
  })
})

describe("进度文字", () => {
  it("超过目标也只显示满格，不知道时按 0", () => {
    expect(progressText(3, 10)).toBe("3 / 10")
    expect(progressText(14, 10)).toBe("10 / 10")
    expect(progressText(null, 10)).toBe("0 / 10")
  })
})
