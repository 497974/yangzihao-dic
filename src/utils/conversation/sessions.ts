/**
 * 对话练习的记录（阶段五实现方案 · 步骤 4）：最近 20 次，可以回看对话和点评。
 * 单独一个键，不进生词本也不进 Config。
 */

import type { ConversationFeedback, ConversationTurn } from "./prompt"
import { storage } from "#imports"

export const CONVERSATION_SESSIONS_KEY = "local:conversationSessions" as const

/** 只留最近这么多次：再早的对话很少回看 */
export const MAX_SESSIONS = 20

export interface ConversationSession {
  id: string
  scenarioId: string
  scenarioTitle: string
  /** 自定义场景时用户写的描述；内置场景为空 */
  customDescription?: string
  startedAt: number
  opening: string
  turns: ConversationTurn[]
  feedback?: ConversationFeedback
}

/** 记下（或更新）一次对话：同一次对话覆盖原记录，新的排最前，超出上限丢掉最旧的 */
export function upsertSession(
  sessions: readonly ConversationSession[],
  session: ConversationSession,
): ConversationSession[] {
  const others = sessions.filter((item) => item.id !== session.id)
  return [session, ...others].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_SESSIONS)
}

export function removeSession(
  sessions: readonly ConversationSession[],
  id: string,
): ConversationSession[] {
  return sessions.filter((item) => item.id !== id)
}

export async function readSessions(): Promise<ConversationSession[]> {
  const value = await storage.getItem<ConversationSession[]>(CONVERSATION_SESSIONS_KEY)
  return Array.isArray(value) ? value : []
}

export async function writeSessions(sessions: ConversationSession[]): Promise<void> {
  await storage.setItem(CONVERSATION_SESSIONS_KEY, sessions)
}
