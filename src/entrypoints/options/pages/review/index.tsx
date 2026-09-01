/**
 * 闪卡复习页
 *
 * 上游把复习放在网页端，本项目改为完全在扩展内完成 —— 不用开网页、不用登录。
 * 调度由本地 FSRS 计算（见 utils/local-notebase/srs-scheduler.ts）。
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/base-ui/button"
import { PageLayout } from "@/entrypoints/options/components/page-layout"
import { orpcClient } from "@/utils/orpc/client"

type Rating = "again" | "hard" | "good" | "easy"

interface ReviewCard {
  id: string
  front: string
  back: string
  state: string
  dueAt: string | Date
  reps: number
  lapses: number
}

const RATING_META: { key: Rating, label: string, hint: string, cls: string, keyCap: string }[] = [
  { key: "again", label: "忘了", hint: "重新学", cls: "bg-red-500/90 hover:bg-red-500 text-white", keyCap: "1" },
  { key: "hard", label: "有点难", hint: "缩短间隔", cls: "bg-amber-500/90 hover:bg-amber-500 text-white", keyCap: "2" },
  { key: "good", label: "记得", hint: "正常间隔", cls: "bg-emerald-600/90 hover:bg-emerald-600 text-white", keyCap: "3" },
  { key: "easy", label: "太简单", hint: "拉长间隔", cls: "bg-sky-600/90 hover:bg-sky-600 text-white", keyCap: "4" },
]

function isDue(c: ReviewCard) {
  if (c.state === "new") return true
  return new Date(c.dueAt).getTime() <= Date.now()
}

export function ReviewPage() {
  const qc = useQueryClient()
  const [revealed, setRevealed] = useState(false)
  const [idx, setIdx] = useState(0)
  const [done, setDone] = useState(0)
  const shownAtRef = useRef<number>(Date.now())

  const { data: notebases } = useQuery({
    queryKey: ["local-notebases"],
    queryFn: () => orpcClient.notebase.list({}),
  })
  const notebaseId = notebases?.[0]?.id

  const { data: cards, isPending } = useQuery({
    queryKey: ["review-cards", notebaseId],
    queryFn: () => orpcClient.card.list({ notebaseId: notebaseId! }),
    enabled: !!notebaseId,
  })

  // 只复习到期的；顺序在本轮内固定，避免每次评分后队列重排导致跳卡
  const queue = useMemo(() => (cards ?? []).filter(isDue) as ReviewCard[], [cards])
  const current = queue[idx]

  useEffect(() => {
    shownAtRef.current = Date.now()
  }, [current?.id])

  const { mutate: submit, isPending: isSubmitting } = useMutation({
    mutationFn: async (rating: Rating) => {
      if (!current) return
      await orpcClient.srs.review({
        cardId: current.id,
        rating,
        durationMs: Math.min(Date.now() - shownAtRef.current, 180_000),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
    },
    onSuccess: () => {
      setDone((n) => n + 1)
      setRevealed(false)
      setIdx((i) => i + 1)
    },
  })

  const finished = !isPending && queue.length > 0 && idx >= queue.length

  const handleRate = useCallback((r: Rating) => {
    if (!revealed || isSubmitting) return
    submit(r)
  }, [revealed, isSubmitting, submit])

  // 键盘操作：空格翻面，1-4 评分。复习是高频重复动作，鼠标点太慢。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault()
        if (!revealed) setRevealed(true)
        return
      }
      const m = RATING_META.find((x) => x.keyCap === e.key)
      if (m) { e.preventDefault(); handleRate(m.key) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [revealed, handleRate])

  const restart = () => {
    setIdx(0); setDone(0); setRevealed(false)
    void qc.invalidateQueries({ queryKey: ["review-cards"] })
  }

  return (
    <PageLayout title="闪卡复习" description="按记忆规律安排复习，快忘的词优先出现">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        {isPending && (
          <div className="py-16 text-center text-muted-foreground">加载中…</div>
        )}

        {!isPending && queue.length === 0 && (
          <EmptyState onRefresh={restart} />
        )}

        {!isPending && finished && (
          <div className="rounded-xl border border-dashed py-16 text-center">
            <div className="text-4xl">🎉</div>
            <div className="mt-3 text-lg font-medium">今天的复习完成了</div>
            <div className="mt-1 text-sm text-muted-foreground">
              本轮复习 {done} 张卡片
            </div>
            <Button variant="outline" size="sm" className="mt-5" onClick={restart}>
              再看一轮
            </Button>
          </div>
        )}

        {!isPending && current && !finished && (
          <>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>剩余 {queue.length - idx} 张</span>
              <span>已完成 {done} 张</span>
            </div>

            <div className="h-1 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(idx / Math.max(queue.length, 1)) * 100}%` }}
              />
            </div>

            <div
              className="flex min-h-64 cursor-pointer flex-col items-center justify-center gap-5
                         rounded-xl border bg-card p-8 text-center"
              onClick={() => !revealed && setRevealed(true)}
            >
              <div className="text-3xl font-semibold">{current.front}</div>

              {revealed
                ? (
                    <div className="w-full whitespace-pre-line border-t pt-5 text-left text-[15px] leading-relaxed">
                      {current.back}
                    </div>
                  )
                : (
                    <div className="text-sm text-muted-foreground">
                      点击卡片或按 <kbd className="rounded border px-1.5 py-0.5 text-xs">空格</kbd> 显示答案
                    </div>
                  )}
            </div>

            {revealed && (
              <div className="grid grid-cols-4 gap-2">
                {RATING_META.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleRate(m.key)}
                    className={`flex flex-col items-center gap-0.5 rounded-lg px-3 py-3
                                text-sm font-medium transition disabled:opacity-50 ${m.cls}`}
                  >
                    <span>{m.label}</span>
                    <span className="text-[11px] opacity-80">{m.hint}</span>
                    <span className="mt-0.5 rounded bg-black/20 px-1.5 text-[10px]">{m.keyCap}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="text-center text-xs text-muted-foreground">
              复习 {current.reps} 次 · 忘记 {current.lapses} 次
            </div>
          </>
        )}
      </div>
    </PageLayout>
  )
}

function EmptyState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="rounded-xl border border-dashed py-16 text-center">
      <div className="text-4xl">📚</div>
      <div className="mt-3 text-lg font-medium">暂时没有要复习的卡片</div>
      <div className="mt-1 text-sm text-muted-foreground">
        划词保存生词后会自动生成卡片；已复习的卡片会按记忆规律在之后的日子里再次出现
      </div>
      <Button variant="outline" size="sm" className="mt-5" onClick={onRefresh}>
        刷新
      </Button>
    </div>
  )
}
