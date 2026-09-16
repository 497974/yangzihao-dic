/**
 * 英文写作纠错 + 错题本（功能路线图阶段四第 4 条）
 *
 * 写一段英文，AI 改对并用中文讲为什么错；改出来的每条错都能收进错题本，
 * 过些天再练一遍——常犯的错练对得少，就一直排在前面。
 *
 * 只有点「检查」才会请求一次 AI：不自动检查，也不在输入过程中反复请求。
 */

import type { BackgroundStructuredObjectStreamSnapshot } from "@/types/background-stream"
import type { WritingMistake } from "@/utils/writing/mistakes"
import type { WritingCorrection } from "@/utils/writing/parse"
import {
  IconCircleCheck,
  IconLoader2,
  IconNotebook,
  IconPencilCheck,
  IconTrash,
} from "@tabler/icons-react"
import { useAtomValue } from "jotai"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router"
import { Button } from "@/components/ui/base-ui/button"
import { toastManager } from "@/components/ui/base-ui/toast"
import { PageLayout } from "@/entrypoints/options/components/page-layout"
import { buildAiPayload, useDictionaryAiProvider } from "@/utils/ai/dictionary-provider"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { streamBackgroundStructuredObject } from "@/utils/content-script/background-stream-client"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import {
  addMistakes,
  countByType,
  markPracticed,
  practiceOrder,
  readMistakes,
  removeMistake,
  writeMistakes,
} from "@/utils/writing/mistakes"
import { isSameSentence, parseCorrections } from "@/utils/writing/parse"
import {
  buildWritingCheckAction,
  buildWritingPrompt,
  MAX_WRITING_LENGTH,
  WRITING_FIELD,
} from "@/utils/writing/prompt"
import { CorrectionRow } from "./correction-row"

/** 结构化输出的字段值类型上是 unknown：模型偶尔少写一个字段或写成别的类型，一律当没写 */
function asText(value: unknown): string {
  return typeof value === "string" ? value : ""
}

interface CheckResult {
  corrected: string
  comment: string
  corrections: WritingCorrection[]
}

type Tab = "check" | "mistakes"

export function WritingPage() {
  const [tab, setTab] = useState<Tab>("check")
  const [mistakes, setMistakes] = useState<WritingMistake[]>([])

  useEffect(() => {
    void readMistakes().then(setMistakes)
  }, [])

  const updateMistakes = useCallback((next: WritingMistake[]) => {
    setMistakes(next)
    void writeMistakes(next)
  }, [])

  return (
    <PageLayout
      title="写作纠错"
      description="提交一段英文，由 AI 批改并用中文说明原因；批改出的错误可收入错题本反复练习"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center justify-center gap-1 text-sm">
          {(
            [
              { key: "check", label: "写作纠错" },
              { key: "mistakes", label: `错题本${mistakes.length ? ` (${mistakes.length})` : ""}` },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`rounded-full px-4 py-1.5 transition ${
                tab === item.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "check" ? (
          <CheckPanel
            onCollect={(corrections) => {
              const next = addMistakes(mistakes, corrections)
              updateMistakes(next)
              toastManager.add({
                type: "success",
                title: `已收进错题本（共 ${next.length} 条）`,
              })
            }}
          />
        ) : (
          <MistakesPanel mistakes={mistakes} onChange={updateMistakes} />
        )}
      </div>
    </PageLayout>
  )
}

function CheckPanel({ onCollect }: { onCollect: (corrections: WritingCorrection[]) => void }) {
  const [text, setText] = useState("")
  const [result, setResult] = useState<CheckResult | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const language = useAtomValue(configFieldsAtomMap.language)
  // 和词典、对话练习共用同一个 AI 供应商（见 utils/ai/dictionary-provider.ts）
  const provider = useDictionaryAiProvider()

  const check = async () => {
    const trimmed = text.trim()
    if (!trimmed || !provider) {
      return
    }
    setIsChecking(true)
    setError(null)
    setResult(null)
    try {
      const payload = buildAiPayload(
        provider,
        language,
        buildWritingCheckAction(provider.id),
        trimmed,
      )

      const apply = (output: Record<string, unknown>) => {
        setResult({
          corrected: asText(output[WRITING_FIELD.corrected]),
          comment: asText(output[WRITING_FIELD.comment]),
          corrections: parseCorrections(asText(output[WRITING_FIELD.mistakes])),
        })
      }

      const final = await streamBackgroundStructuredObject(
        {
          ...payload,
          prompt: buildWritingPrompt(trimmed),
          requestId: getRandomUUID(),
        },
        {
          onChunk: (partial: BackgroundStructuredObjectStreamSnapshot) => apply(partial.output),
        },
      )
      apply(final.output)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "检查失败，请稍后再试")
    } finally {
      setIsChecking(false)
    }
  }

  const tooLong = text.length > MAX_WRITING_LENGTH

  return (
    <>
      <div className="flex flex-col gap-2">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="粘贴或输入你写的英文，例如一封邮件、一段自我介绍、一段作业…"
          rows={8}
          spellCheck={false}
          className="w-full resize-y rounded-xl border bg-background p-4 text-[15px] leading-relaxed outline-none focus:ring-2 focus:ring-primary"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className={tooLong ? "text-red-600" : undefined}>
            {text.length} / {MAX_WRITING_LENGTH} 字符
          </span>
          <span>点击「检查」时才会请求 AI，输入过程中不会自动检查</span>
        </div>
      </div>

      {!provider && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          尚未配置可用的 AI 服务，无法批改。请先在{" "}
          <Link to="/api-providers" className="underline">
            AI 供应商
          </Link>{" "}
          中完成配置（与词典使用同一项配置）。
        </div>
      )}

      <div className="flex justify-center">
        <Button
          onClick={() => void check()}
          disabled={!text.trim() || tooLong || !provider || isChecking}
        >
          {isChecking ? (
            <IconLoader2 className="size-4 animate-spin" />
          ) : (
            <IconPencilCheck className="size-4" />
          )}
          {isChecking ? "批改中…" : "检查这段英文"}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {result && (
        <>
          {result.comment && (
            <div className="rounded-xl border bg-card p-5 text-[15px] leading-relaxed">
              {result.comment}
            </div>
          )}

          {result.corrected && (
            <div className="rounded-xl border p-5">
              <div className="mb-2 text-sm font-medium">改好的版本</div>
              <div className="text-[15px] leading-relaxed whitespace-pre-wrap">
                {result.corrected}
              </div>
            </div>
          )}

          {result.corrections.length > 0 ? (
            <div className="rounded-xl border p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  逐条讲解（{result.corrections.length} 处）
                </span>
                <Button variant="outline" size="sm" onClick={() => onCollect(result.corrections)}>
                  全部收进错题本
                </Button>
              </div>
              <div className="flex flex-col gap-3">
                {result.corrections.map((correction, index) => (
                  // eslint-disable-next-line react/no-array-index-key -- 一次结果里顺序固定
                  <CorrectionRow key={index} correction={correction} />
                ))}
              </div>
            </div>
          ) : (
            !isChecking && (
              <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                未发现明显错误
              </div>
            )
          )}
        </>
      )}
    </>
  )
}

function MistakesPanel({
  mistakes,
  onChange,
}: {
  mistakes: WritingMistake[]
  onChange: (next: WritingMistake[]) => void
}) {
  const [practicing, setPracticing] = useState(false)

  const queue = useMemo(() => practiceOrder(mistakes), [mistakes])
  const types = useMemo(() => countByType(mistakes), [mistakes])

  if (mistakes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed py-14 text-center">
        <IconNotebook className="mx-auto size-8 text-muted-foreground" />
        <div className="mt-3 text-lg font-medium">错题本为空</div>
        <div className="mt-1 text-sm text-muted-foreground">
          在「写作纠错」中检查一段英文，将批改出的错误收进错题本，即可反复练习
        </div>
      </div>
    )
  }

  if (practicing) {
    return (
      <PracticePanel
        queue={queue}
        onDone={() => setPracticing(false)}
        onCorrect={(id) => onChange(markPracticed(mistakes, id))}
      />
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">最常犯的：</span>
          {types.slice(0, 4).map((item) => (
            <span key={item.type} className="rounded-full bg-muted px-2.5 py-0.5">
              {item.type} × {item.count}
            </span>
          ))}
        </div>
        <Button size="sm" onClick={() => setPracticing(true)}>
          开始重练
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {queue.map((mistake) => (
          <div key={mistake.id} className="rounded-lg border p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CorrectionRow correction={mistake} />
              </div>
              <button
                type="button"
                aria-label="删掉这条"
                title="删掉这条"
                onClick={() => onChange(removeMistake(mistakes, mistake.id))}
                className="shrink-0 rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <IconTrash className="size-4" />
              </button>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">练对过 {mistake.practiced} 次</div>
          </div>
        ))}
      </div>
    </>
  )
}

function PracticePanel({
  queue,
  onDone,
  onCorrect,
}: {
  queue: WritingMistake[]
  onDone: () => void
  onCorrect: (id: string) => void
}) {
  const [index, setIndex] = useState(0)
  const [typed, setTyped] = useState("")
  const [checked, setChecked] = useState(false)

  const current = queue[index]
  if (!current) {
    return (
      <div className="rounded-xl border border-dashed py-14 text-center">
        <IconCircleCheck className="mx-auto size-8 text-emerald-600" />
        <div className="mt-3 text-lg font-medium">本轮练习已完成</div>
        <Button variant="outline" size="sm" className="mt-5" onClick={onDone}>
          回到错题本
        </Button>
      </div>
    )
  }

  const isCorrect = checked && isSameSentence(typed, current.corrected)

  const submit = () => {
    if (checked || !typed.trim()) {
      return
    }
    setChecked(true)
    if (isSameSentence(typed, current.corrected)) {
      onCorrect(current.id)
    }
  }

  const next = () => {
    setIndex((value) => value + 1)
    setTyped("")
    setChecked(false)
  }

  return (
    <>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          第 {index + 1} / {queue.length} 条
        </span>
        <button type="button" className="hover:text-foreground" onClick={onDone}>
          退出重练
        </button>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
        <div className="text-xs text-muted-foreground">
          这句话你此前写错过（{current.type}），请改正：
        </div>
        <div className="text-lg leading-relaxed">{current.original}</div>

        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              if (checked) {
                next()
              } else {
                submit()
              }
            }
          }}
          readOnly={checked}
          placeholder="输入正确的写法…"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border bg-background px-4 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-primary"
        />

        {checked ? (
          <div className="flex flex-col gap-3 border-t pt-4">
            <div
              className={`self-start rounded-lg px-3 py-1.5 font-medium ${
                isCorrect ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"
              }`}
            >
              {isCorrect ? "✓ 正确" : "✗ 尚未改对"}
            </div>
            <div className="text-[15px]">
              <span className="text-muted-foreground">正确写法：</span>
              {current.corrected}
            </div>
            {current.explanation && (
              <div className="text-sm leading-relaxed text-muted-foreground">
                {current.explanation}
              </div>
            )}
            <Button className="self-start" onClick={next}>
              下一条
            </Button>
          </div>
        ) : (
          <Button className="self-start" onClick={submit} disabled={!typed.trim()}>
            提交
          </Button>
        )}
      </div>
    </>
  )
}
