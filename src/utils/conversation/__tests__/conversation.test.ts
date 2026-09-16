import type { ConversationTurn } from "../prompt"
import type { ConversationSession } from "../sessions"
import { describe, expect, it } from "vitest"
import {
  buildConversationInstructions,
  buildFeedbackPrompt,
  countUserTurns,
  FEEDBACK_FIELD,
  levelGuidance,
  parseExpressions,
  toFeedback,
  toModelMessages,
} from "../prompt"
import { BUILTIN_SCENARIOS, customScenario } from "../scenarios"
import { MAX_SESSIONS, removeSession, upsertSession } from "../sessions"

const RESTAURANT = BUILTIN_SCENARIOS.find((item) => item.id === "restaurant")!

describe("内置场景", () => {
  it("每个场景都有标题、目标、角色设定和开场白，id 不重复", () => {
    const ids = BUILTIN_SCENARIOS.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const scenario of BUILTIN_SCENARIOS) {
      expect(scenario.title && scenario.goal && scenario.role && scenario.opening).toBeTruthy()
    }
  })

  it("自定义场景没有固定开场白，交给 AI 自己开场", () => {
    const scenario = customScenario("  在机场值机时行李超重  ")
    expect(scenario.opening).toBe("")
    expect(scenario.learnerGoal).toContain("在机场值机时行李超重")
    expect(buildConversationInstructions(scenario, 3)).toContain("Open the conversation yourself")
  })
})

describe("对话提示词", () => {
  it("写明场景、角色、目标，开场白也写进去（消息列表从用户开始）", () => {
    const text = buildConversationInstructions(RESTAURANT, 3)
    expect(text).toContain(RESTAURANT.setting)
    expect(text).toContain(RESTAURANT.role)
    expect(text).toContain(RESTAURANT.opening)
    expect(text).toContain("Do not correct the learner's mistakes during the conversation")
  })

  it("按水平调整用词难度", () => {
    expect(levelGuidance(1)).toContain("very common")
    expect(levelGuidance(4)).toContain("phrasal verbs")
    expect(levelGuidance(7)).toContain("idioms")
    expect(buildConversationInstructions(RESTAURANT, 2)).toContain(levelGuidance(2))
  })

  it("发给模型的消息从用户第一句开始，去掉空消息", () => {
    const turns: ConversationTurn[] = [
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Hi, a table for two please." },
      { role: "assistant", content: "" },
      { role: "user", content: "Can I see the menu?" },
    ]
    expect(toModelMessages(turns)).toEqual([
      { role: "user", content: "Hi, a table for two please." },
      { role: "user", content: "Can I see the menu?" },
    ])
    expect(toModelMessages([{ role: "assistant", content: "Hello" }])).toEqual([])
    expect(countUserTurns(turns)).toBe(2)
  })
})

describe("结束点评", () => {
  it("文字稿带上场景和目标，开场白算作 AI 的第一句", () => {
    const prompt = buildFeedbackPrompt(RESTAURANT, [
      { role: "user", content: "I want a coffee." },
      { role: "assistant", content: "Sure, anything else?" },
    ])
    expect(prompt).toContain(`学生的目标：${RESTAURANT.learnerGoal}`)
    expect(prompt).toContain(`AI: ${RESTAURANT.opening}`)
    expect(prompt).toContain("Learner: I want a coffee.")
    expect(prompt).toContain("AI: Sure, anything else?")
  })

  it("值得记住的表达：两段式，跳过表头和不完整的行", () => {
    const raw = [
      "英文表达 ||| 中文意思",
      "1. Could I get the check, please? ||| 可以结账吗？",
      "- I'll have the salmon. ||| 我要三文鱼。",
      "incomplete line ||| ",
      "no separator here",
    ].join("\n")

    expect(parseExpressions(raw)).toEqual([
      { english: "Could I get the check, please?", chinese: "可以结账吗？" },
      { english: "I'll have the salmon.", chinese: "我要三文鱼。" },
    ])
  })

  it("结构化输出转成点评；少写或写错类型的字段当作没写", () => {
    const feedback = toFeedback({
      [FEEDBACK_FIELD.comment]: "完成了点餐目标。",
      [FEEDBACK_FIELD.corrections]:
        "I want a coffee ||| Could I get a coffee? ||| 更自然的说法 ||| 点餐时用 Could I get 更礼貌",
      [FEEDBACK_FIELD.expressions]: 42,
    })

    expect(feedback.comment).toBe("完成了点餐目标。")
    expect(feedback.corrections).toHaveLength(1)
    expect(feedback.corrections[0]!.corrected).toBe("Could I get a coffee?")
    expect(feedback.expressions).toEqual([])
  })
})

describe("对话记录", () => {
  const session = (id: string, startedAt: number): ConversationSession => ({
    id,
    scenarioId: "restaurant",
    scenarioTitle: "餐厅点餐",
    startedAt,
    opening: "",
    turns: [],
  })

  it("新的排最前；同一次对话更新而不是重复记", () => {
    let list = upsertSession([], session("a", 1))
    list = upsertSession(list, session("b", 2))
    list = upsertSession(list, { ...session("a", 1), turns: [{ role: "user", content: "hi" }] })

    expect(list.map((item) => item.id)).toEqual(["b", "a"])
    expect(list[1]!.turns).toHaveLength(1)
  })

  it("超出上限丢掉最旧的；可以删除", () => {
    let list: ConversationSession[] = []
    for (let i = 0; i < MAX_SESSIONS + 3; i++) {
      list = upsertSession(list, session(`s${i}`, i))
    }
    expect(list).toHaveLength(MAX_SESSIONS)
    expect(list.at(-1)!.id).toBe("s3")
    expect(removeSession(list, "s3")).toHaveLength(MAX_SESSIONS - 1)
  })
})
