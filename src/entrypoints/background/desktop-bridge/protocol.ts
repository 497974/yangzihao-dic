/**
 * 桌面版连接桥的通信协议（桌面版方案第 3 步）。
 *
 * 一条消息就是一个 JSON 对象，用 type 区分：
 *
 *   桌面 → 扩展   lookup  { id, text, context?, sourceTitle?, fresh? }   查一个词（fresh = 重新生成，不用缓存）
 *                 save    { id, fields }                        把查到的结果存进生词本
 *                 translate { id, text, sourceTitle?, mode? }   翻译：三下空格（input）或划词工具栏（selection）
 *                 toolbar { id }                                划词工具栏该放哪些按钮
 *                 speak   { id, text }                          按扩展的朗读设置合成语音
 *                 reviewStatus { id }                           今天有几个词该复习（复习提醒）
 *                 openReview   { id }                           打开闪卡复习页
 *                 dailyGoal    { id, action, ... }              每日必学：status 看进度 / next 要下一题 / answer 交答案
 *                 pong    {}                                    回应保活
 *   扩展 → 桌面   hello   { client, version, protocol }         连上时先发，自报家门
 *                 lookupProgress { id, progress }               大模型边生成边发（字段逐个填上）
 *                 lookupResult / saveResult / speakResult { id, ok, result | error }
 *                 ping    {}                                    每 20 秒一次，顺便让后台保持常驻
 *
 * id 由桌面程序生成，扩展原样带回，用来把回复和请求配上对。
 *
 * 桌面发来的每条消息都先按下面的格式校验，格式不对的直接丢弃——
 * 连接桥是对外开的口子，不能假设对面一定守规矩。
 */

import type { DailyGoalResult } from "./daily-goal"
import type { DesktopLookupProgress, DesktopLookupResult } from "./dictionary-lookup"
import type { DesktopTranslateResult } from "./input-translate"
import type { DesktopReviewStatus } from "./review-status"
import type { DesktopSaveResult } from "./save-word"
import type {
  DesktopSelectionTranslateProgress,
  DesktopSelectionTranslateResult,
} from "./selection-translate"
import type { DesktopSpeakResult } from "./speak"
import type { DesktopToolbarInfo } from "./toolbar"
import { z } from "zod"

/**
 * 一次查词最多多少个字符。
 *
 * 取词是靠模拟复制，用户一不小心全选了整篇文档，剪贴板里就是几万字——
 * 原样丢给大模型既慢又费 token，还查不出东西。超了就直接告诉用户选短一点。
 */
export const MAX_LOOKUP_TEXT_LENGTH = 2_000

const requestIdSchema = z.string().min(1).max(100)

const lookupMessageSchema = z.object({
  type: z.literal("lookup"),
  id: requestIdSchema,
  // 这里放得很宽，只挡明显的垃圾；"太长"要回一条带原因的错误，不能在校验这一步悄悄丢掉
  text: z.string().max(200_000),
  context: z.string().max(200_000).optional(),
  sourceTitle: z.string().max(1_000).optional(),
  /** 划词工具栏上的哪个动作；不传就是内置词典 */
  actionId: z.string().min(1).max(200).optional(),
  /** 「重新生成」：不用上次查过的结果 */
  fresh: z.boolean().optional(),
})

const saveMessageSchema = z.object({
  type: z.literal("save"),
  id: requestIdSchema,
  fields: z.record(z.string(), z.unknown()),
  actionId: z.string().min(1).max(200).optional(),
})

const translateMessageSchema = z.object({
  type: z.literal("translate"),
  id: requestIdSchema,
  // 同查词：放宽到只挡垃圾，"太长"要回带原因的错误
  text: z.string().max(200_000),
  sourceTitle: z.string().max(1_000).optional(),
  /** input = 三下空格翻译（按「输入翻译」的设置）；selection = 划词工具栏的翻译按钮 */
  mode: z.enum(["input", "selection"]).optional(),
})

/** 桌面版要显示划词工具栏前，问一下该放哪些按钮 */
const toolbarMessageSchema = z.object({
  type: z.literal("toolbar"),
  id: requestIdSchema,
})

/** 桌面版的朗读按钮：按扩展的朗读设置合成，桌面程序去放 */
const speakMessageSchema = z.object({
  type: z.literal("speak"),
  id: requestIdSchema,
  // 同查词：放宽到只挡垃圾，"太长"要回带原因的错误
  text: z.string().max(200_000),
})

/** 桌面版托盘问今天有几个词该复习（每天提醒一次） */
const reviewStatusMessageSchema = z.object({
  type: z.literal("reviewStatus"),
  id: requestIdSchema,
})

/** 桌面版点了复习提醒：打开闪卡复习页 */
const openReviewMessageSchema = z.object({
  type: z.literal("openReview"),
  id: requestIdSchema,
})

/** 每日必学锁屏：看进度、要下一题、交一道题的结果 */
const dailyGoalMessageSchema = z.discriminatedUnion("action", [
  z.object({ type: z.literal("dailyGoal"), id: requestIdSchema, action: z.literal("status") }),
  z.object({
    type: z.literal("dailyGoal"),
    id: requestIdSchema,
    action: z.literal("next"),
    /** 刚做过的卡，这次尽量别再出 */
    exclude: z.array(z.string().max(100)).max(50).optional(),
  }),
  z.object({
    type: z.literal("dailyGoal"),
    id: requestIdSchema,
    action: z.literal("answer"),
    cardId: z.string().min(1).max(100),
    correct: z.boolean(),
    durationMs: z.number().min(0).max(3_600_000).optional(),
  }),
])

const pongMessageSchema = z.object({
  type: z.literal("pong"),
})

export const desktopIncomingMessageSchema = z.discriminatedUnion("type", [
  lookupMessageSchema,
  saveMessageSchema,
  translateMessageSchema,
  toolbarMessageSchema,
  speakMessageSchema,
  reviewStatusMessageSchema,
  openReviewMessageSchema,
  dailyGoalMessageSchema,
  pongMessageSchema,
])

/** 朗读一次最多多少字：一句、一小段足够了，再长合成要等很久 */
export const MAX_SPEAK_TEXT_LENGTH = 1_000

/** 三下空格翻译一次最多多少字：一条聊天消息、一段话足够了 */
export const MAX_TRANSLATE_TEXT_LENGTH = 5_000

export type DesktopIncomingMessage = z.infer<typeof desktopIncomingMessageSchema>

/** 解析桌面发来的一条原始消息；不是合法 JSON、或格式不对，一律返回 null */
export function parseDesktopMessage(raw: unknown): DesktopIncomingMessage | null {
  if (typeof raw !== "string") {
    return null
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = desktopIncomingMessageSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

/** 回给桌面的错误。message 是给人看的，桌面弹窗直接显示它 */
export interface BridgeErrorPayload {
  code: string
  message: string
}

export type ExtensionOutgoingMessage =
  | { type: "hello"; client: string; version: string; protocol: number; features: string[] }
  | { type: "ping" }
  /** 大模型查词的中途进度，最多每 150 毫秒一条；旧版桌面程序不认识会直接忽略 */
  | { type: "lookupProgress"; id: string; progress: DesktopLookupProgress }
  | { type: "lookupResult"; id: string; ok: true; result: DesktopLookupResult }
  | { type: "lookupResult"; id: string; ok: false; error: BridgeErrorPayload }
  | { type: "saveResult"; id: string; ok: true; result: DesktopSaveResult }
  | { type: "saveResult"; id: string; ok: false; error: BridgeErrorPayload }
  | {
      type: "translateResult"
      id: string
      ok: true
      result: DesktopTranslateResult | DesktopSelectionTranslateResult
    }
  | { type: "translateResult"; id: string; ok: false; error: BridgeErrorPayload }
  /** 划词翻译的中途进度，最多每 150 毫秒一条 */
  | { type: "translateProgress"; id: string; progress: DesktopSelectionTranslateProgress }
  | { type: "toolbarResult"; id: string; ok: true; result: DesktopToolbarInfo }
  | { type: "toolbarResult"; id: string; ok: false; error: BridgeErrorPayload }
  | { type: "speakResult"; id: string; ok: true; result: DesktopSpeakResult }
  | { type: "speakResult"; id: string; ok: false; error: BridgeErrorPayload }
  | { type: "reviewStatusResult"; id: string; ok: true; result: DesktopReviewStatus }
  | { type: "reviewStatusResult"; id: string; ok: false; error: BridgeErrorPayload }
  | { type: "openReviewResult"; id: string; ok: true; result: { opened: true } }
  | { type: "openReviewResult"; id: string; ok: false; error: BridgeErrorPayload }
  | { type: "dailyGoalResult"; id: string; ok: true; result: DailyGoalResult }
  | { type: "dailyGoalResult"; id: string; ok: false; error: BridgeErrorPayload }

/**
 * 把异常整理成回给桌面的错误。
 *
 * 查词、存词服务抛出的 DesktopLookupError / DesktopSaveError 自带 code 和给人看的原因，
 * 原样转交；其余意外错误统一成 internal_error，并在原因前加上"查词失败 / 存词失败"。
 * 这里按形状判断而不是 instanceof：免得协议模块为了一个类型判断把两个服务整个引进来。
 */
export function toBridgeError(error: unknown, fallbackTitle: string): BridgeErrorPayload {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.message
  ) {
    return { code: error.code, message: error.message }
  }
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  return {
    code: "internal_error",
    message: detail ? `${fallbackTitle}：${detail}` : fallbackTitle,
  }
}
