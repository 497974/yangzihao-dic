/**
 * 词汇量测试页（功能路线图阶段四第 3 条）
 *
 * 做法学 LexTALE：只回答「认识 / 不认识」，中间混进假词防止乱蒙（见 utils/vocab-test/）。
 * 两分钟测完，给一个粗略的词汇量估计和每天该学几个新词的建议。
 *
 * 刻意不做的：不给释义、不做选择题——那会变成一场考试，而这里只需要一个大致的坐标。
 */

import type { TestAnswer, VocabTestResult } from "@/utils/vocab-test/score"
import type { TestItem } from "@/utils/vocab-test/word-bank"
import { IconCheck, IconRefresh, IconRulerMeasure, IconX } from "@tabler/icons-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router"
import { storage } from "#imports"
import { Button } from "@/components/ui/base-ui/button"
import { toastManager } from "@/components/ui/base-ui/toast"
import { PageLayout } from "@/entrypoints/options/components/page-layout"
import { VOCAB_TEST_RESULT_KEY } from "@/utils/constants/vocab-test"
import { describeLevel, scoreVocabTest } from "@/utils/vocab-test/score"
import { ALL_ITEMS, BAND_LABEL, shuffleItems } from "@/utils/vocab-test/word-bank"

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

export function VocabTestPage() {
  const [items, setItems] = useState<TestItem[]>([])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<TestAnswer[]>([])
  const [result, setResult] = useState<VocabTestResult | null>(null)
  /** 上次测的结果（没在测的时候显示） */
  const [lastResult, setLastResult] = useState<VocabTestResult | null>(null)

  useEffect(() => {
    let cancelled = false
    void storage.getItem<VocabTestResult>(VOCAB_TEST_RESULT_KEY).then((value) => {
      if (!cancelled) setLastResult(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const testing = items.length > 0 && index < items.length
  const current = items[index]

  const start = () => {
    setItems(shuffleItems(ALL_ITEMS))
    setIndex(0)
    setAnswers([])
    setResult(null)
  }

  const answer = useCallback(
    (known: boolean) => {
      const item = items[index]
      if (!item) {
        return
      }
      const nextAnswers = [...answers, { word: item.word, band: item.band, known }]
      setAnswers(nextAnswers)
      setIndex((value) => value + 1)

      if (nextAnswers.length === items.length) {
        const scored = scoreVocabTest(nextAnswers)
        setResult(scored)
        setLastResult(scored)
        void storage.setItem(VOCAB_TEST_RESULT_KEY, scored)
      }
    },
    [answers, index, items],
  )

  // 键盘操作：左右方向键、1/2 都行，一路按下去两分钟测完
  useEffect(() => {
    if (!testing) {
      return undefined
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === "2") {
        event.preventDefault()
        answer(true)
      } else if (event.key === "ArrowLeft" || event.key === "1") {
        event.preventDefault()
        answer(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [answer, testing])

  const shown = result ?? (testing ? null : lastResult)

  return (
    <PageLayout
      title="词汇量测试"
      description="约两分钟测出大致的英语词汇量，并据此给出每天的新词学习量建议"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        {testing && current && (
          <TestCard
            item={current}
            index={index}
            total={items.length}
            onAnswer={answer}
            onQuit={() => setItems([])}
          />
        )}

        {!testing && shown && <ResultCard result={shown} onRestart={start} />}

        {!testing && !shown && <IntroCard onStart={start} />}
      </div>
    </PageLayout>
  )
}

function IntroCard({ onStart }: { onStart: () => void }) {
  return (
    <div className="rounded-xl border border-dashed py-14 text-center">
      <IconRulerMeasure className="mx-auto size-8 text-muted-foreground" />
      <div className="mt-3 text-lg font-medium">测试你的词汇量</div>
      <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        测试会逐个显示英文单词，你只需回答「认识」或「不认识」，无需写出含义。
        <br />
        题目中混有<strong>假词</strong>：拼写接近英文但并不存在的词。对假词选择「认识」会拉低
        估算结果，请如实作答。
      </div>
      <Button className="mt-6" onClick={onStart}>
        开始测试（约 2 分钟）
      </Button>
    </div>
  )
}

function TestCard({
  item,
  index,
  total,
  onAnswer,
  onQuit,
}: {
  item: TestItem
  index: number
  total: number
  onAnswer: (known: boolean) => void
  onQuit: () => void
}) {
  return (
    <>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          第 {index + 1} / {total} 个
        </span>
        <button type="button" className="hover:text-foreground" onClick={onQuit}>
          退出测试
        </button>
      </div>

      <div className="h-1 w-full overflow-hidden rounded bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${(index / total) * 100}%` }}
        />
      </div>

      <div className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-xl border bg-card p-8">
        <div className="text-xs text-muted-foreground">下面这个词，你认识吗？</div>
        {/* 词本身不带任何提示：给了音标或词性，等于帮人回忆，测出来会偏高 */}
        <div className="text-4xl font-semibold tracking-wide">{item.word}</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onAnswer(false)}
          className="flex flex-col items-center gap-1 rounded-lg border px-4 py-4 transition hover:bg-muted"
        >
          <IconX className="size-5 text-muted-foreground" />
          <span className="font-medium">不认识</span>
          <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">← 或 1</span>
        </button>
        <button
          type="button"
          onClick={() => onAnswer(true)}
          className="flex flex-col items-center gap-1 rounded-lg border px-4 py-4 transition hover:bg-muted"
        >
          <IconCheck className="size-5 text-emerald-600" />
          <span className="font-medium">认识</span>
          <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">→ 或 2</span>
        </button>
      </div>

      <div className="text-center text-xs text-muted-foreground">
        请如实作答：看着眼熟但说不出含义的，选「不认识」
      </div>
    </>
  )
}

function ResultCard({ result, onRestart }: { result: VocabTestResult; onRestart: () => void }) {
  const level = useMemo(() => describeLevel(result.estimatedWords), [result.estimatedWords])

  const copyUnknown = () => {
    void navigator.clipboard
      .writeText(result.unknownWords.join("\n"))
      .then(() => toastManager.add({ type: "success", title: "已复制这些词" }))
      .catch(() => toastManager.add({ type: "error", title: "复制失败" }))
  }

  return (
    <>
      <div className="flex flex-col items-center gap-2 rounded-xl border bg-card p-8 text-center">
        <div className="text-sm text-muted-foreground">你大概认识</div>
        <div className="text-5xl font-semibold tabular-nums">{result.estimatedWords}</div>
        <div className="text-sm text-muted-foreground">个英语常用词 · {level.label}</div>
        <div className="mt-3 max-w-md text-[15px] leading-relaxed">{level.advice}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          建议每天学 <strong>{level.dailyNewWords}</strong> 个新词
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          测试时间 {formatDate(result.takenAt)} · 结果为估算值，仅供参考
        </div>
      </div>

      {result.unreliable && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          本次有 {Math.round(result.falseAlarmRate * 100)}% 的假词被选为「认识」，而这些词并不存在，
          说明答案中包含较多猜测，估算结果不可靠。建议重新测试，拿不准的一律选「不认识」。
        </div>
      )}

      <div className="rounded-xl border p-5">
        <div className="mb-3 text-sm font-medium">各难度档的掌握情况</div>
        <div className="flex flex-col gap-2.5">
          {result.bands.map((band) => (
            <div key={band.band} className="flex items-center gap-3 text-sm">
              <span className="w-44 shrink-0 text-muted-foreground">{BAND_LABEL[band.band]}</span>
              <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary" style={{ width: `${band.rate * 100}%` }} />
              </div>
              <span className="w-14 shrink-0 text-right text-muted-foreground tabular-nums">
                {Math.round(band.rate * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {result.unknownWords.length > 0 && (
        <div className="rounded-xl border p-5">
          <div className="mb-2 text-sm font-medium">
            这次答「不认识」的词（{result.unknownWords.length} 个）
          </div>
          <div className="text-[15px] leading-relaxed break-words">
            {result.unknownWords.join(" · ")}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyUnknown}>
              复制这些词
            </Button>
            <span className="text-xs text-muted-foreground">
              如需记忆这些词：在网页上划词查询后保存到生词本，闪卡复习会自动安排
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button variant="outline" onClick={onRestart}>
          <IconRefresh className="size-4" />
          重新测一次
        </Button>
        <Link
          to="/review"
          className="rounded-lg border border-dashed px-4 py-2 text-sm text-muted-foreground transition hover:border-primary hover:text-primary"
        >
          去闪卡复习
        </Link>
      </div>
    </>
  )
}
