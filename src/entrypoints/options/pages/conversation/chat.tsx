/**
 * 一场情景对话 + 结束后的点评（阶段五实现方案 · 步骤 4）。
 *
 * 对话过程中 AI 只管把对话自然地进行下去，不纠错；点「结束并点评」后才统一给出改进建议。
 * 每条 AI 回复可以朗读、可以看中文翻译；输入支持文字和浏览器自带的语音识别。
 */

import type { ConversationFeedback, ConversationTurn } from "@/utils/conversation/prompt"
import type { ConversationScenario } from "@/utils/conversation/scenarios"
import type { ConversationSession } from "@/utils/conversation/sessions"
import type { CustomActionProviderRef } from "@/utils/providers/provider-registry"
import type { EnglishLevel } from "@/utils/word-wise/level"
import {
  IconLanguage,
  IconLoader2,
  IconMicrophone,
  IconPlayerStopFilled,
  IconSend,
  IconVolume,
} from "@tabler/icons-react"
import { useAtomValue } from "jotai"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/base-ui/button"
import { toastManager } from "@/components/ui/base-ui/toast"
import { useTextToSpeech } from "@/hooks/use-text-to-speech"
import { ANALYTICS_SURFACE } from "@/types/analytics"
import { buildAiPayload } from "@/utils/ai/dictionary-provider"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { getProviderConfigById } from "@/utils/config/helpers"
import {
  streamBackgroundStructuredObject,
  streamBackgroundText,
} from "@/utils/content-script/background-stream-client"
import {
  buildConversationInstructions,
  buildFeedbackAction,
  buildFeedbackPrompt,
  countUserTurns,
  OPENING_REQUEST,
  toFeedback,
  toModelMessages,
} from "@/utils/conversation/prompt"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { executeTranslate } from "@/utils/host/translate/execute-translate"
import { getTranslatePrompt } from "@/utils/prompts/translate"
import { addMistakes, readMistakes, writeMistakes } from "@/utils/writing/mistakes"
import { CorrectionRow } from "../writing/correction-row"
import { useSpeechInput } from "./use-speech-input"

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "请求失败，请稍后重试"
}

export interface ChatProps {
  scenario: ConversationScenario
  level: EnglishLevel
  provider: CustomActionProviderRef
  /** 对话内容或点评变了就保存一次（最近 20 次） */
  onSave: (session: ConversationSession) => void
  onExit: () => void
}

export function ConversationChat({ scenario, level, provider, onSave, onExit }: ChatProps) {
  const language = useAtomValue(configFieldsAtomMap.language)
  const ttsConfig = useAtomValue(configFieldsAtomMap.tts)
  const providersConfig = useAtomValue(configFieldsAtomMap.providersConfig)
  const selectionToolbar = useAtomValue(configFieldsAtomMap.selectionToolbar)
  const {
    play,
    stop: stopSpeaking,
    isPlaying,
    isFetching,
  } = useTextToSpeech(ANALYTICS_SURFACE.CONVERSATION_PRACTICE)

  const [session] = useState(() => ({ id: getRandomUUID(), startedAt: Date.now() }))
  const [opening, setOpening] = useState(scenario.opening)
  const [turns, setTurns] = useState<ConversationTurn[]>([])
  const [input, setInput] = useState("")
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<ConversationFeedback | null>(null)
  const [feedbackLoading, setFeedbackLoading] = useState(false)
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [autoSpeak, setAutoSpeak] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const speech = useSpeechInput((text) =>
    setInput((current) => (current.trim() ? `${current.trim()} ${text}` : text)),
  )

  /** 流式对话共用的模型参数（温度、推理、供应商参数），与词典保持一致 */
  const modelParams = useMemo(() => {
    const { providerId, modelTier, providerOptions, reasoning, temperature } = buildAiPayload(
      provider,
      language,
      buildFeedbackAction(provider.id),
      "",
    )
    return { providerId, modelTier, providerOptions, reasoning, temperature }
  }, [provider, language])

  const effectiveScenario = useMemo(() => ({ ...scenario, opening }), [scenario, opening])

  const speak = (text: string) => {
    void play(text, ttsConfig).catch(() => {})
  }

  /** 请求 AI 的下一句 */
  const requestReply = async (history: ConversationTurn[], isOpening = false) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setPending("")
    try {
      const final = await streamBackgroundText(
        {
          ...modelParams,
          requestId: getRandomUUID(),
          instructions: buildConversationInstructions(effectiveScenario, level),
          messages: isOpening ? [...OPENING_REQUEST] : toModelMessages(history),
        },
        { signal: controller.signal, onChunk: (snapshot) => setPending(snapshot.output) },
      )
      const text = final.output.trim()
      if (!text) {
        throw new Error("AI 没有返回内容，请重试")
      }
      if (isOpening) {
        setOpening(text)
      } else {
        setTurns([...history, { role: "assistant", content: text }])
      }
      if (autoSpeak) {
        speak(text)
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(errorMessage(caught))
      }
    } finally {
      if (abortRef.current === controller) {
        setPending(null)
      }
    }
  }

  // 自定义场景没有固定开场白：进来先请 AI 开场；内置场景直接朗读写好的开场白
  useEffect(() => {
    if (scenario.opening) {
      if (autoSpeak) {
        speak(scenario.opening)
      }
    } else {
      void requestReply([], true)
    }
    return () => abortRef.current?.abort()
    // 只在进入场景时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 对话或点评有变化就保存
  useEffect(() => {
    if (!opening || turns.length === 0) {
      return
    }
    onSave({
      id: session.id,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      ...(scenario.id === "custom" ? { customDescription: scenario.goal } : {}),
      startedAt: session.startedAt,
      opening,
      turns,
      ...(feedback ? { feedback } : {}),
    })
    // onSave 由页面传入，引用变化不代表内容变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening, turns, feedback])

  // 新消息出来时滚到底部
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
  }, [turns, pending, opening])

  const send = () => {
    const text = input.trim()
    if (!text || pending !== null || feedback || feedbackLoading) {
      return
    }
    speech.stop()
    stopSpeaking()
    const history: ConversationTurn[] = [...turns, { role: "user", content: text }]
    setTurns(history)
    setInput("")
    void requestReply(history)
  }

  const retry = () => {
    if (!opening) {
      void requestReply([], true)
    } else if (turns.at(-1)?.role === "user") {
      void requestReply(turns)
    }
  }

  const translate = async (key: string, text: string) => {
    const providerConfig = getProviderConfigById(
      providersConfig,
      selectionToolbar.features.translate.providerId,
    )
    if (!providerConfig) {
      toastManager.add({ type: "error", title: "未找到划词翻译所用的翻译服务，无法显示中文" })
      return
    }
    setTranslations((current) => ({ ...current, [key]: "翻译中……" }))
    try {
      const result = await executeTranslate(
        text,
        { ...language, sourceCode: "eng" },
        providerConfig,
        getTranslatePrompt,
      )
      setTranslations((current) => ({ ...current, [key]: result }))
    } catch (caught) {
      setTranslations((current) => ({ ...current, [key]: `翻译失败：${errorMessage(caught)}` }))
    }
  }

  const finish = async () => {
    if (countUserTurns(turns) === 0) {
      return
    }
    abortRef.current?.abort()
    speech.stop()
    stopSpeaking()
    setFeedbackLoading(true)
    setError(null)
    try {
      const payload = buildAiPayload(provider, language, buildFeedbackAction(provider.id), "")
      const final = await streamBackgroundStructuredObject(
        {
          ...payload,
          prompt: buildFeedbackPrompt(effectiveScenario, turns),
          requestId: getRandomUUID(),
        },
        { onChunk: (snapshot) => setFeedback(toFeedback(snapshot.output)) },
      )
      setFeedback(toFeedback(final.output))
    } catch (caught) {
      setError(`生成点评失败：${errorMessage(caught)}`)
    } finally {
      setFeedbackLoading(false)
    }
  }

  const collectMistakes = async () => {
    if (!feedback?.corrections.length) {
      return
    }
    const next = addMistakes(await readMistakes(), feedback.corrections)
    await writeMistakes(next)
    toastManager.add({ type: "success", title: `已收入错题本（共 ${next.length} 条）` })
  }

  const audioBusy = isPlaying || isFetching
  const messages: Array<ConversationTurn & { key: string }> = [
    ...(opening ? [{ role: "assistant" as const, content: opening, key: "opening" }] : []),
    ...turns.map((turn, index) => ({ ...turn, key: String(index) })),
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4">
        <div className="min-w-0">
          <div className="font-medium">{scenario.title}</div>
          <div className="mt-0.5 text-sm text-muted-foreground">你的目标：{scenario.goal}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={autoSpeak}
              onChange={(event) => setAutoSpeak(event.target.checked)}
            />
            自动朗读回复
          </label>
          <Button variant="outline" size="sm" onClick={onExit}>
            返回场景列表
          </Button>
          {!feedback && (
            <Button
              size="sm"
              onClick={() => void finish()}
              disabled={countUserTurns(turns) === 0 || pending !== null || feedbackLoading}
            >
              {feedbackLoading && <IconLoader2 className="size-4 animate-spin" />}
              结束并点评
            </Button>
          )}
        </div>
      </div>

      <div
        ref={listRef}
        className="flex max-h-[28rem] min-h-64 flex-col gap-3 overflow-y-auto rounded-xl border p-4"
      >
        {messages.map((message) => (
          <div
            key={message.key}
            className={`flex flex-col gap-1 ${message.role === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed ${
                message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              {message.content}
            </div>
            {message.role === "assistant" && (
              <div className="flex items-center gap-1 pl-1 text-xs text-muted-foreground">
                <button
                  type="button"
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted"
                  onClick={() => (audioBusy ? stopSpeaking() : speak(message.content))}
                >
                  {audioBusy ? (
                    <IconPlayerStopFilled className="size-3.5" />
                  ) : (
                    <IconVolume className="size-3.5" />
                  )}
                  朗读
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted"
                  onClick={() => void translate(message.key, message.content)}
                >
                  <IconLanguage className="size-3.5" />
                  显示中文
                </button>
              </div>
            )}
            {translations[message.key] && (
              <div className="max-w-[85%] pl-1 text-sm text-muted-foreground">
                {translations[message.key]}
              </div>
            )}
          </div>
        ))}

        {pending !== null && (
          <div className="flex items-start">
            <div className="max-w-[85%] rounded-2xl bg-muted px-3.5 py-2 text-[15px] leading-relaxed">
              {pending || <IconLoader2 className="size-4 animate-spin text-muted-foreground" />}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm">
          <span>{error}</span>
          {!feedbackLoading && (
            <Button variant="outline" size="sm" onClick={retry}>
              重试
            </Button>
          )}
        </div>
      )}

      {!feedback && !feedbackLoading && (
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <textarea
              value={
                speech.listening && speech.interim ? `${input} ${speech.interim}`.trim() : input
              }
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  send()
                }
              }}
              rows={2}
              placeholder="用英文回复，回车发送（Shift + 回车换行）"
              spellCheck={false}
              className="min-h-[3.25rem] flex-1 resize-none rounded-xl border bg-background px-3.5 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-primary"
            />
            {speech.supported && (
              <Button
                variant="outline"
                onClick={() => (speech.listening ? speech.stop() : speech.start())}
                aria-label={speech.listening ? "停止语音输入" : "语音输入"}
                title={speech.listening ? "停止语音输入" : "语音输入（英文）"}
              >
                {speech.listening ? (
                  <IconPlayerStopFilled className="size-4 text-red-600" />
                ) : (
                  <IconMicrophone className="size-4" />
                )}
              </Button>
            )}
            <Button onClick={send} disabled={!input.trim() || pending !== null} aria-label="发送">
              <IconSend className="size-4" />
            </Button>
          </div>
          {speech.error && <div className="text-xs text-red-600">{speech.error}</div>}
          {speech.listening && <div className="text-xs text-muted-foreground">正在聆听……</div>}
        </div>
      )}

      {feedback && (
        <FeedbackView
          feedback={feedback}
          loading={feedbackLoading}
          onCollect={() => void collectMistakes()}
          onSpeak={speak}
        />
      )}

      {feedback && !feedbackLoading && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={onExit}>
            返回场景列表
          </Button>
        </div>
      )}
    </div>
  )
}

export function FeedbackView({
  feedback,
  loading,
  onCollect,
  onSpeak,
}: {
  feedback: ConversationFeedback
  loading?: boolean
  onCollect?: () => void
  onSpeak?: (text: string) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {feedback.comment && (
        <div className="rounded-xl border bg-card p-5 text-[15px] leading-relaxed">
          <div className="mb-1.5 text-sm font-medium text-muted-foreground">总评</div>
          {feedback.comment}
        </div>
      )}

      {feedback.corrections.length > 0 && (
        <div className="rounded-xl border p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">
              可以改进的表达（{feedback.corrections.length} 处）
            </span>
            {onCollect && !loading && (
              <Button variant="outline" size="sm" onClick={onCollect}>
                收入错题本
              </Button>
            )}
          </div>
          <div className="flex flex-col gap-3">
            {feedback.corrections.map((correction, index) => (
              // eslint-disable-next-line react/no-array-index-key -- 一次点评结果里顺序固定
              <CorrectionRow key={index} correction={correction} />
            ))}
          </div>
        </div>
      )}

      {feedback.expressions.length > 0 && (
        <div className="rounded-xl border p-5">
          <div className="mb-3 text-sm font-medium">值得记住的表达</div>
          <div className="flex flex-col gap-2">
            {feedback.expressions.map((expression, index) => (
              <div
                // eslint-disable-next-line react/no-array-index-key -- 一次点评结果里顺序固定
                key={index}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2"
              >
                <div>
                  <div className="text-[15px]">{expression.english}</div>
                  <div className="text-sm text-muted-foreground">{expression.chinese}</div>
                </div>
                {onSpeak && (
                  <button
                    type="button"
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="朗读"
                    onClick={() => onSpeak(expression.english)}
                  >
                    <IconVolume className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <IconLoader2 className="size-4 animate-spin" />
          正在生成点评……
        </div>
      )}
    </div>
  )
}
