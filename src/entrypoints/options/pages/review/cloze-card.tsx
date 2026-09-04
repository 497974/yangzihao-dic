/**
 * 闪卡复习 · 语境填空题型
 *
 * 给出例句的中文，句子留下功能词当骨架（the / of / in 这类），只挖实词。
 *
 * 这个题型考的是**"这个位置该填哪个词"**——本质是词汇题，不是表达题。
 * 所以它属于闪卡复习（复习单词），而不属于造句练习（练从零表达）。
 * 造句练习那边用的是整句全挖，一个骨架都不给，两者刻意分开。
 *
 * 判错逻辑与造句练习一致：可乱序填，逐空判定，只标错的那个空，
 * 对的锁定，错的保留输入让人自己改，不抖答案。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/base-ui/button"
import {
  type BlankVerdict,
  blankWidthCh,
  checkBlanks,
  prepareSentence,
  type SentenceToken,
} from "@/utils/sentence-practice/blanks"

/** 跟在前面内容后面、前面不该加空格的标点 */
const ATTACHES_LEFT = /^[.,!?;:%)\]}'"]/
const ATTACHES_RIGHT = /[([{$"']$/

function needsSpaceBefore(prev: SentenceToken | undefined, token: SentenceToken): boolean {
  if (!prev) return false
  if (ATTACHES_LEFT.test(token.text)) return false
  if (ATTACHES_RIGHT.test(prev.text)) return false
  return true
}

export function ClozeCard({
  sentence,
  translation,
  onDone,
}: {
  sentence: string
  translation: string
  /** 全部填对或点了"看答案"时回调，correct 表示是不是自己填对的 */
  onDone: (correct: boolean) => void
}) {
  const prepared = useMemo(() => prepareSentence(sentence, "content-words"), [sentence])
  const [inputs, setInputs] = useState<string[]>([])
  const [verdicts, setVerdicts] = useState<BlankVerdict[] | null>(null)
  const [settled, setSettled] = useState(false)
  const blankRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    setInputs(Array.from({ length: prepared.answers.length }, () => ""))
    setVerdicts(null)
    setSettled(false)
    requestAnimationFrame(() => blankRefs.current[0]?.focus())
  }, [sentence, prepared.answers.length])

  /** 只在还没填对的空之间循环——已锁定的空停上去没有意义 */
  const focusBlank = useCallback(
    (from: number, dir: 1 | -1) => {
      const total = prepared.answers.length
      if (total === 0) return
      for (let step = 1; step <= total; step++) {
        const target = (((from + dir * step) % total) + total) % total
        if (verdicts?.[target] === "correct") continue
        const el = blankRefs.current[target]
        if (el) {
          el.focus()
          el.select()
          return
        }
      }
    },
    [prepared.answers.length, verdicts],
  )

  const check = useCallback(() => {
    if (settled) return
    const next = checkBlanks(inputs, prepared.answers)
    setVerdicts(next)
    if (next.length > 0 && next.every((v) => v === "correct")) {
      setSettled(true)
      onDone(true)
      return
    }
    const firstWrong = next.findIndex((v) => v === "wrong")
    const target = firstWrong >= 0 ? firstWrong : next.findIndex((v) => v === "empty")
    if (target >= 0) requestAnimationFrame(() => blankRefs.current[target]?.focus())
  }, [settled, inputs, prepared.answers, onDone])

  const reveal = useCallback(() => {
    setInputs([...prepared.answers])
    setVerdicts(prepared.answers.map(() => "correct" as const))
    setSettled(true)
    onDone(false)
  }, [prepared.answers, onDone])

  const remaining = verdicts?.filter((v) => v !== "correct").length ?? 0

  return (
    <div className="flex min-h-72 flex-col justify-center gap-5 rounded-xl border bg-card p-8">
      <div className="flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="rounded-full bg-muted px-2 py-0.5">语境填空</span>
        <span>看中文，把句子缺的词补上</span>
      </div>

      <div className="text-center text-lg leading-relaxed">{translation}</div>

      <div className="flex flex-wrap items-end justify-center gap-y-3 leading-loose">
        {prepared.tokens.map((token, tokenIndex) => {
          const space = needsSpaceBefore(prepared.tokens[tokenIndex - 1], token)
          if (token.blankIndex === null) {
            return (
              <span key={token.key} className={space ? "ml-1.5" : ""}>
                {token.text}
              </span>
            )
          }
          const bi = token.blankIndex
          const verdict = verdicts?.[bi]
          const locked = verdict === "correct"
          return (
            <input
              key={token.key}
              ref={(el) => {
                blankRefs.current[bi] = el
              }}
              value={inputs[bi] ?? ""}
              onChange={(e) => {
                const value = e.target.value
                setInputs((prev) => {
                  const next = [...prev]
                  next[bi] = value
                  return next
                })
                // 只清掉这个空的判定，别动别的空的对错
                setVerdicts((prev) => {
                  if (!prev) return prev
                  const next = [...prev]
                  next[bi] = "empty"
                  return next
                })
              }}
              onKeyDown={(e) => {
                const el = e.currentTarget
                if (e.key === "Tab") {
                  e.preventDefault()
                  focusBlank(bi, e.shiftKey ? -1 : 1)
                } else if (e.key === "Enter") {
                  e.preventDefault()
                  check()
                } else if (e.key === "ArrowLeft" && el.selectionStart === 0) {
                  e.preventDefault()
                  focusBlank(bi, -1)
                } else if (e.key === "ArrowRight" && el.selectionStart === el.value.length) {
                  e.preventDefault()
                  focusBlank(bi, 1)
                }
              }}
              readOnly={locked}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              // 等宽字体是必须的：宽度用 ch 算，ch 只在等宽字体里才等于一个字母宽
              style={{ width: `${blankWidthCh(prepared.answers[bi] ?? "", inputs[bi] ?? "")}ch` }}
              className={`${space ? "ml-1.5" : ""} border-0 border-b-2 bg-transparent px-0.5 pb-0.5 text-center font-mono transition-colors outline-none ${
                locked
                  ? "border-emerald-500 text-emerald-600"
                  : verdict === "wrong"
                    ? "border-red-500 text-red-600"
                    : "border-muted-foreground/40 focus:border-primary"
              }`}
            />
          )
        })}
      </div>

      {!settled && verdicts && remaining > 0 && (
        <div className="text-center text-sm text-red-600">
          还有 {remaining} 个空没对
          {verdicts.some((v) => v === "wrong") && "，标红的改一下"}
        </div>
      )}

      {!settled && (
        <div className="flex justify-center gap-2">
          <Button onClick={check}>提交</Button>
          <Button variant="ghost" onClick={reveal}>
            显示答案
          </Button>
        </div>
      )}

      {settled && <div className="text-center text-[15px] leading-relaxed">{sentence}</div>}
    </div>
  )
}
