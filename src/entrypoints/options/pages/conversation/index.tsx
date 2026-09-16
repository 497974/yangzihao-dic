/**
 * 对话练习页（阶段五实现方案 · 步骤 4，参考 Speak、TalkPal）。
 *
 * 选一个场景，AI 扮演对方陪你把事情办完；结束后用中文点评哪里可以说得更好，
 * 改进项可以收入写作纠错的错题本。最近 20 次对话会保存下来，可以回看。
 *
 * 只在发送消息、生成点评时请求 AI；AI 服务与词典共用。
 */

import type { ConversationScenario } from "@/utils/conversation/scenarios"
import type { ConversationSession } from "@/utils/conversation/sessions"
import type { EnglishLevel } from "@/utils/word-wise/level"
import { IconMessages, IconTrash } from "@tabler/icons-react"
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router"
import { Button } from "@/components/ui/base-ui/button"
import { PageLayout } from "@/entrypoints/options/components/page-layout"
import { useDictionaryAiProvider } from "@/utils/ai/dictionary-provider"
import { countUserTurns } from "@/utils/conversation/prompt"
import { BUILTIN_SCENARIOS, customScenario } from "@/utils/conversation/scenarios"
import {
  readSessions,
  removeSession,
  upsertSession,
  writeSessions,
} from "@/utils/conversation/sessions"
import { DEFAULT_ENGLISH_LEVEL, ENGLISH_LEVEL_OPTIONS } from "@/utils/word-wise/level"
import { readEnglishLevel } from "@/utils/word-wise/settings"
import { ConversationChat, FeedbackView } from "./chat"

type View =
  | { kind: "picker" }
  | { kind: "chat"; scenario: ConversationScenario; key: number }
  | { kind: "replay"; session: ConversationSession }

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function ConversationPage() {
  const provider = useDictionaryAiProvider()
  const [view, setView] = useState<View>({ kind: "picker" })
  const [level, setLevel] = useState<EnglishLevel>(DEFAULT_ENGLISH_LEVEL)
  const [sessions, setSessions] = useState<ConversationSession[]>([])
  const [customText, setCustomText] = useState("")

  useEffect(() => {
    void readEnglishLevel().then((resolved) => setLevel(resolved.level))
    void readSessions().then(setSessions)
  }, [])

  const saveSession = useCallback((session: ConversationSession) => {
    setSessions((current) => {
      const next = upsertSession(current, session)
      void writeSessions(next)
      return next
    })
  }, [])

  const deleteSession = (id: string) => {
    setSessions((current) => {
      const next = removeSession(current, id)
      void writeSessions(next)
      return next
    })
  }

  const start = (scenario: ConversationScenario) =>
    setView({ kind: "chat", scenario, key: Date.now() })

  const levelLabel = ENGLISH_LEVEL_OPTIONS.find((option) => option.value === level)?.label

  return (
    <PageLayout
      title="对话练习"
      description="选择一个生活场景，与 AI 扮演的角色用英语完成对话；结束后获得中文点评"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {!provider && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            尚未配置可用的 AI 服务，无法进行对话练习。请先在{" "}
            <Link to="/api-providers" className="underline">
              AI 供应商
            </Link>{" "}
            中完成配置（与词典使用同一项配置）。
          </div>
        )}

        {view.kind === "chat" && provider && (
          <ConversationChat
            key={view.key}
            scenario={view.scenario}
            level={level}
            provider={provider}
            onSave={saveSession}
            onExit={() => setView({ kind: "picker" })}
          />
        )}

        {view.kind === "replay" && (
          <SessionReplay session={view.session} onBack={() => setView({ kind: "picker" })} />
        )}

        {view.kind === "picker" && (
          <>
            <div className="text-sm text-muted-foreground">
              AI 会按你的英语水平（{levelLabel}）调整用词难度，可在「阅读辅助」页修改水平。
              对话过程中不会打断纠错，点「结束并点评」后统一给出改进建议。
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {BUILTIN_SCENARIOS.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  disabled={!provider}
                  onClick={() => start(scenario)}
                  className="flex flex-col items-start gap-1 rounded-xl border bg-card p-4 text-left transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="font-medium">{scenario.title}</span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    {scenario.goal}
                  </span>
                </button>
              ))}
            </div>

            <div className="rounded-xl border p-4">
              <div className="mb-2 text-sm font-medium">自定义场景</div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={customText}
                  onChange={(event) => setCustomText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && customText.trim() && provider) {
                      start(customScenario(customText))
                    }
                  }}
                  placeholder="用一句话描述场景，例如：在机场值机时行李超重"
                  className="flex-1 rounded-lg border bg-background px-3 py-2 text-[15px] outline-none focus:ring-2 focus:ring-primary"
                />
                <Button
                  disabled={!customText.trim() || !provider}
                  onClick={() => start(customScenario(customText))}
                >
                  开始对话
                </Button>
              </div>
            </div>

            {sessions.length > 0 && (
              <div className="rounded-xl border p-4">
                <div className="mb-3 text-sm font-medium">最近的对话</div>
                <div className="flex flex-col gap-2">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-[15px]">
                          {session.scenarioTitle}
                          {session.customDescription && (
                            <span className="text-muted-foreground">
                              {" "}
                              · {session.customDescription}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatTime(session.startedAt)} · 你说了 {countUserTurns(session.turns)}{" "}
                          句{session.feedback ? " · 已点评" : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setView({ kind: "replay", session })}
                        >
                          查看
                        </Button>
                        <button
                          type="button"
                          aria-label="删除这次对话"
                          title="删除这次对话"
                          onClick={() => deleteSession(session.id)}
                          className="rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        >
                          <IconTrash className="size-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </PageLayout>
  )
}

function SessionReplay({ session, onBack }: { session: ConversationSession; onBack: () => void }) {
  const messages = [
    { role: "assistant" as const, content: session.opening },
    ...session.turns,
  ].filter((message) => message.content.trim())

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div>
          <div className="flex items-center gap-2 font-medium">
            <IconMessages className="size-4 text-muted-foreground" />
            {session.scenarioTitle}
          </div>
          <div className="mt-0.5 text-sm text-muted-foreground">
            {formatTime(session.startedAt)}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onBack}>
          返回场景列表
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border p-4">
        {messages.map((message, index) => (
          <div
            // eslint-disable-next-line react/no-array-index-key -- 已保存的记录，顺序固定
            key={index}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed ${
                message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}
      </div>

      {session.feedback ? (
        <FeedbackView feedback={session.feedback} />
      ) : (
        <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          这次对话没有生成点评
        </div>
      )}
    </div>
  )
}
