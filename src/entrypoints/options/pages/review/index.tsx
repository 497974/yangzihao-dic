/**
 * 闪卡复习页
 *
 * 上游把复习放在网页端，本项目改为完全在扩展内完成 —— 不用开网页、不用登录。
 * 调度由本地 FSRS 计算（见 utils/local-notebase/srs-scheduler.ts）。
 *
 * 参考百词斩等背单词 App 验证有效的机制（不是照搬全部功能）：
 *   - 拼写测验：复习（非首次学习）时必须真正打出单词，而不是自己说"我记得"——
 *     多篇测评指出纯识图/自我判断是背单词 App 最大的坑，拼写才是真正逼出记忆的环节。
 *   - 发音朗读：听读结合。
 * 有意跳过的：图片联想记忆（需要图库或按词生图，成本高且要联网，
 * 与本项目的本地化定位冲突）；社交排行榜/打卡群（需要服务器和多用户）。
 */

import { useAtomValue } from "jotai"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { IconLoader2, IconPlayerStopFilled, IconVolume } from "@tabler/icons-react"
import { Button } from "@/components/ui/base-ui/button"
import { PageLayout } from "@/entrypoints/options/components/page-layout"
import { useTextToSpeech } from "@/hooks/use-text-to-speech"
import { ANALYTICS_SURFACE } from "@/types/analytics"
import { configFieldsAtomMap } from "@/utils/atoms/config"
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

/** 复习过至少一次的卡片才考拼写——第一次见到这个词，直接考拼写没有意义。 */
function isSpellingEligible(c: ReviewCard) {
  return c.state !== "new" && c.reps > 0
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * 把答案里的目标词挖空成完形填空。默认卡片模板的例句字段本来就包含目标词，
 * 直接显示等于把答案摆在眼前——挖空之后，拼写测验反而比孤立背单词多一层语境线索。
 */
function maskAnswer(back: string, front: string): string {
  const word = front.trim()
  if (!word) return back
  const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi")
  return back.replace(pattern, "▁".repeat(Math.max(word.length, 3)))
}

function normalize(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

function SpeakButton({ text }: { text: string }) {
  const ttsConfig = useAtomValue(configFieldsAtomMap.tts)
  const { play, stop, isFetching, isPlaying } = useTextToSpeech(ANALYTICS_SURFACE.FLASHCARD_REVIEW)

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (isFetching || isPlaying) { stop(); return }
    void play(text, ttsConfig)
  }, [isFetching, isPlaying, play, stop, text, ttsConfig])

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="朗读发音"
      className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
    >
      {isFetching
        ? <IconLoader2 className="size-4 animate-spin" />
        : isPlaying
          ? <IconPlayerStopFilled className="size-4" />
          : <IconVolume className="size-4" />}
    </button>
  )
}

export function ReviewPage() {
  const qc = useQueryClient()
  const [revealed, setRevealed] = useState(false)
  const [idx, setIdx] = useState(0)
  const [done, setDone] = useState(0)
  const shownAtRef = useRef<number>(Date.now())

  // 拼写模式状态
  const [typedAnswer, setTypedAnswer] = useState("")
  const [checked, setChecked] = useState(false)
  const [isCorrect, setIsCorrect] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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
  const spellingMode = current ? isSpellingEligible(current) : false
  const masked = useMemo(
    () => (current ? maskAnswer(current.back, current.front) : ""),
    [current],
  )

  useEffect(() => {
    shownAtRef.current = Date.now()
    setTypedAnswer("")
    setChecked(false)
    setIsCorrect(false)
    setRevealed(false)
    if (spellingMode) {
      // 下一帧再聚焦，避免和卡片切换的过渡动画抢焦点
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在换卡时重置
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
      setIdx((i) => i + 1)
    },
  })

  const finished = !isPending && queue.length > 0 && idx >= queue.length

  const handleRate = useCallback((r: Rating) => {
    if (!revealed || isSubmitting) return
    submit(r)
  }, [revealed, isSubmitting, submit])

  const checkSpelling = useCallback(() => {
    if (!current || checked) return
    const correct = normalize(typedAnswer) === normalize(current.front)
    setIsCorrect(correct)
    setChecked(true)
    setRevealed(true)
  }, [current, checked, typedAnswer])

  // 键盘操作：空格翻面（识记模式）/ 提交答案（拼写模式），1-4 评分。
  // 复习是高频重复动作，鼠标点太慢；正在打字时不拦截空格和数字。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement === inputRef.current

      if (e.code === "Space" && !typing) {
        e.preventDefault()
        if (!spellingMode && !revealed) setRevealed(true)
        return
      }
      if (typing) return // 打字时数字键交给输入框本身
      const m = RATING_META.find((x) => x.keyCap === e.key)
      if (m) { e.preventDefault(); handleRate(m.key) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [revealed, spellingMode, handleRate])

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

            {spellingMode
              ? (
                  <div className="flex min-h-64 flex-col justify-center gap-5 rounded-xl border bg-card p-8">
                    <div className="flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground">
                      <span className="rounded-full bg-muted px-2 py-0.5">拼写测验</span>
                      <span>看提示，打出这个词</span>
                    </div>

                    <div className="whitespace-pre-line text-center text-[15px] leading-relaxed">
                      {masked}
                    </div>

                    {!checked
                      ? (
                          <div className="flex justify-center gap-2">
                            <input
                              ref={inputRef}
                              value={typedAnswer}
                              onChange={(e) => setTypedAnswer(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") checkSpelling() }}
                              placeholder="输入单词…"
                              autoComplete="off"
                              autoCapitalize="off"
                              spellCheck={false}
                              className="w-64 rounded-lg border bg-background px-4 py-2.5
                                         text-center text-lg outline-none focus:ring-2 focus:ring-primary"
                            />
                            <Button onClick={checkSpelling} disabled={!typedAnswer.trim()}>
                              提交
                            </Button>
                          </div>
                        )
                      : (
                          <div className="flex flex-col items-center gap-3">
                            <div
                              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-lg font-semibold ${
                                isCorrect
                                  ? "bg-emerald-500/10 text-emerald-600"
                                  : "bg-red-500/10 text-red-600"
                              }`}
                            >
                              <span>{isCorrect ? "✓ 拼对了" : "✗ 拼错了"}</span>
                              <SpeakButton text={current.front} />
                            </div>
                            <div className="text-2xl font-semibold">{current.front}</div>
                            {!isCorrect && (
                              <div className="text-sm text-muted-foreground">
                                你输入的是「{typedAnswer}」
                              </div>
                            )}
                          </div>
                        )}
                  </div>
                )
              : (
                  <div
                    className="flex min-h-64 cursor-pointer flex-col items-center justify-center gap-5
                               rounded-xl border bg-card p-8 text-center"
                    onClick={() => !revealed && setRevealed(true)}
                  >
                    <div className="flex items-center gap-2 text-3xl font-semibold">
                      <span>{current.front}</span>
                      <SpeakButton text={current.front} />
                    </div>

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
                )}

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
