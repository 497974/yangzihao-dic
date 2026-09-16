/**
 * 对话练习的提示词、消息拼装和结束点评（阶段五实现方案 · 步骤 4）。纯函数，方便测试。
 *
 * 两个关键约定：
 *   - 对话中 AI 不纠错，只管把对话自然地进行下去；纠错集中放到结束后的点评——
 *     每说一句就被纠正，人很快就不敢开口了
 *   - AI 的开场白写进系统提示，消息列表从用户第一句开始：
 *     部分模型要求第一条消息必须来自用户，先放一条 assistant 消息会直接报错
 */

import type { ConversationScenario } from "./scenarios"
import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import type { EnglishLevel } from "@/utils/word-wise/level"
import type { WritingCorrection } from "@/utils/writing/parse"
import { createOutputSchemaField } from "@/utils/constants/custom-action"
import { parseCorrections, parseSeparatedLines } from "@/utils/writing/parse"

/**
 * 用 type 而不是 interface：消息要原样传给后台的 messages（JSONValue[]），
 * interface 没有隐式索引签名，赋不过去。
 */
export type ConversationTurn = {
  role: "user" | "assistant"
  content: string
}

/** 按水平调整 AI 的用词和句子长度 */
export function levelGuidance(level: EnglishLevel): string {
  if (level <= 2) {
    return "Use only very common everyday words and short, simple sentences."
  }
  if (level <= 4) {
    return "Use everyday vocabulary and common phrasal verbs; keep sentences reasonably short."
  }
  return "Speak naturally as you would with a fluent speaker, including common idioms where they fit."
}

export function buildConversationInstructions(
  scenario: ConversationScenario,
  level: EnglishLevel,
): string {
  const lines = [
    "You are role-playing a realistic conversation to help a Chinese learner practice spoken English.",
    "",
    `Scenario: ${scenario.setting}`,
    `Your role: ${scenario.role}`,
    `The learner's goal: ${scenario.learnerGoal}`,
  ]
  if (scenario.opening) {
    lines.push(`You have already opened the conversation by saying: "${scenario.opening}"`)
  } else {
    lines.push("Open the conversation yourself with one short, natural line in character.")
  }
  lines.push(
    "",
    "Rules:",
    "1. Stay in character the whole time. Never mention that you are an AI or that this is practice.",
    "2. Reply in natural spoken English, 1 to 3 short sentences per turn. No lists, no markdown.",
    `3. ${levelGuidance(level)}`,
    "4. Do not correct the learner's mistakes during the conversation. Respond naturally; if a message is unclear, ask a short clarifying question as your character would.",
    "5. If the learner writes in Chinese, reply in simple English and keep the conversation going.",
    "6. Keep the scenario moving: end most turns with a question or a next step, so the learner always has something to answer.",
    "7. Once the learner's goal has clearly been achieved, wrap up politely in character.",
  )
  return lines.join("\n")
}

/**
 * 自定义场景没有写好的开场白：第一次请求用这条消息请模型开场（界面上不显示）。
 * 拿到的开场白随后当作固定开场白写进系统提示，之后的请求照常从用户第一句开始。
 */
export const OPENING_REQUEST: readonly ConversationTurn[] = [
  { role: "user", content: "Begin the conversation now with your first line, in character." },
]

/** 对话记录 → 发给模型的消息：只保留有内容的轮次，并且从用户的第一句开始 */
export function toModelMessages(turns: readonly ConversationTurn[]): ConversationTurn[] {
  const filled = turns.filter((turn) => turn.content.trim())
  const firstUser = filled.findIndex((turn) => turn.role === "user")
  return firstUser === -1 ? [] : filled.slice(firstUser)
}

/** 用户一共说了几句（点评至少要有一句可评） */
export function countUserTurns(turns: readonly ConversationTurn[]): number {
  return turns.filter((turn) => turn.role === "user" && turn.content.trim()).length
}

// ── 结束点评 ────────────────────────────────────────────────

export const FEEDBACK_FIELD = {
  comment: "总评",
  corrections: "逐条改进",
  expressions: "值得记住的表达",
} as const

export interface UsefulExpression {
  english: string
  chinese: string
}

export interface ConversationFeedback {
  comment: string
  corrections: WritingCorrection[]
  expressions: UsefulExpression[]
}

const FEEDBACK_SYSTEM_PROMPT = `你是一位耐心的英语口语老师，学生的母语是中文。
学生刚完成了一段英语情景对话练习，请只针对学生（Learner）说的话给出点评，AI 角色说的话不需要评价。

点评原则：
1. 先看学生有没有完成对话目标，再看语言本身。
2. 指出真正影响理解或明显不自然的地方，不要为了凑数挑剔小问题。
3. 讲解一律用中文，说清为什么这样说更好。
4. 「更好的说法」要是母语者在这个场景里真的会说的话，不要写成书面语。`

/** 结束点评用的临时动作：结构化输出，字段格式与写作纠错一致，改进项可以直接收进错题本 */
export function buildFeedbackAction(providerId: string): SelectionToolbarCustomAction {
  return {
    id: "conversation-feedback",
    name: "对话点评",
    enabled: true,
    icon: "tabler:messages",
    providerId,
    systemPrompt: FEEDBACK_SYSTEM_PROMPT,
    prompt: "",
    outputSchema: [
      createOutputSchemaField(
        FEEDBACK_FIELD.comment,
        "string",
        "两到三句中文：学生是否完成了对话目标，整体表达怎么样，最值得先改进的一点是什么。",
        "conversation-comment",
      ),
      createOutputSchemaField(
        FEEDBACK_FIELD.corrections,
        "string",
        [
          "逐条列出学生说的话里值得改进的地方，一行一条，每行四段，段与段之间用 ||| 隔开：",
          "学生的原话 ||| 更好的说法 ||| 类型 ||| 中文讲解",
          "类型只能是：语法、时态、单复数、冠词、介词、搭配、用词、拼写、语序、更自然的说法。",
          "不要加序号、项目符号或表头。没有需要改进的就返回空字符串。",
        ].join("\n"),
        "conversation-corrections",
      ),
      createOutputSchemaField(
        FEEDBACK_FIELD.expressions,
        "string",
        [
          "列出 3 到 5 个在这个场景里非常实用、值得记住的英文表达，一行一条，每行两段，用 ||| 隔开：",
          "英文表达 ||| 中文意思",
          "不要加序号、项目符号或表头。",
        ].join("\n"),
        "conversation-expressions",
      ),
    ],
  }
}

/** 点评用的对话文字稿 */
export function buildFeedbackPrompt(
  scenario: ConversationScenario,
  turns: readonly ConversationTurn[],
): string {
  const transcript = [
    ...(scenario.opening ? [`AI: ${scenario.opening}`] : []),
    ...turns
      .filter((turn) => turn.content.trim())
      .map((turn) => `${turn.role === "user" ? "Learner" : "AI"}: ${turn.content.trim()}`),
  ]
  return [
    `场景：${scenario.setting}`,
    `AI 扮演：${scenario.role}`,
    `学生的目标：${scenario.learnerGoal}`,
    "",
    "对话记录：",
    ...transcript,
  ].join("\n")
}

export function parseExpressions(raw: string): UsefulExpression[] {
  return parseSeparatedLines(raw, /^(?:英文表达|表达|English)$/i)
    .filter(([english, chinese]) => english && chinese)
    .map(([english, chinese]) => ({ english: english!, chinese: chinese! }))
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** 结构化输出 → 点评（模型偶尔少写字段，一律当没写） */
export function toFeedback(output: Record<string, unknown>): ConversationFeedback {
  return {
    comment: asText(output[FEEDBACK_FIELD.comment]),
    corrections: parseCorrections(asText(output[FEEDBACK_FIELD.corrections])),
    expressions: parseExpressions(asText(output[FEEDBACK_FIELD.expressions])),
  }
}
