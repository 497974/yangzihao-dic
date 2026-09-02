/**
 * 学习统计页
 *
 * 消费 utils/local-notebase/srs-router.ts 的 stats.activity 接口——参考
 * 百词斩等背单词 App「今日已学/复习正确率」式的数据看板，让复习不是
 * 单纯打分，而是能看到坚持下来的量。
 */

import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { PageLayout } from "@/entrypoints/options/components/page-layout"
import { orpcClient } from "@/utils/orpc/client"

const WINDOW_DAYS = 30
const BAR_DAYS = 14

function dayKey(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d)
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000)
}

export function StatsPage() {
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const to = useMemo(() => dayKey(new Date(), timezone), [timezone])
  const from = useMemo(() => dayKey(daysAgo(WINDOW_DAYS - 1), timezone), [timezone])

  const { data, isPending } = useQuery({
    queryKey: ["stats-activity", from, to],
    queryFn: () => orpcClient.stats.activity({ from, to, timezone }),
  })

  const dailyMap = useMemo(() => {
    const m = new Map<string, { answers: number, durationMs: number }>()
    for (const d of data?.srs.daily ?? []) m.set(d.date, d)
    return m
  }, [data])

  const notesMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of data?.notebase.daily ?? []) m.set(d.date, d.notes)
    return m
  }, [data])

  // 连续学习天数：从今天往回数，中断即止。窗口内没数据视为未学。
  const streak = useMemo(() => {
    let n = 0
    for (let i = 0; i < WINDOW_DAYS; i++) {
      const k = dayKey(daysAgo(i), timezone)
      if ((dailyMap.get(k)?.answers ?? 0) > 0) n++
      else break
    }
    return n
  }, [dailyMap, timezone])

  const todayAnswers = dailyMap.get(to)?.answers ?? 0
  const todayMinutes = Math.round((dailyMap.get(to)?.durationMs ?? 0) / 60_000)
  const totalAnswers = [...dailyMap.values()].reduce((s, d) => s + d.answers, 0)
  const totalNewWords = [...notesMap.values()].reduce((s, n) => s + n, 0)
  const learnedCards = data?.srs.learnedCards ?? 0

  const bars = useMemo(() => {
    const out: { date: string, answers: number }[] = []
    for (let i = BAR_DAYS - 1; i >= 0; i--) {
      const k = dayKey(daysAgo(i), timezone)
      out.push({ date: k, answers: dailyMap.get(k)?.answers ?? 0 })
    }
    return out
  }, [dailyMap, timezone])
  const maxBar = Math.max(1, ...bars.map((b) => b.answers))

  return (
    <PageLayout title="学习统计" description="每天学了多少、复习了多少，全部记录在本机">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        {isPending
          ? <div className="py-16 text-center text-muted-foreground">加载中…</div>
          : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatCard label="今日复习" value={todayAnswers} unit="次" />
                  <StatCard label="今日用时" value={todayMinutes} unit="分钟" />
                  <StatCard label="连续学习" value={streak} unit="天" accent={streak > 0} />
                  <StatCard label="已学单词" value={learnedCards} unit="个" />
                </div>

                <section className="rounded-xl border bg-card p-5">
                  <h3 className="mb-4 text-sm font-medium text-muted-foreground">最近 14 天复习量</h3>
                  <div className="flex h-32 items-end gap-1.5">
                    {bars.map((b) => (
                      <div key={b.date} className="flex flex-1 flex-col items-center gap-1.5">
                        <div
                          className={`w-full rounded-t transition-all ${
                            b.answers > 0 ? "bg-primary" : "bg-muted"
                          }`}
                          style={{ height: `${Math.max((b.answers / maxBar) * 100, b.answers > 0 ? 6 : 2)}%` }}
                          title={`${b.date}：${b.answers} 次`}
                        />
                        <span className="text-[10px] text-muted-foreground">
                          {b.date.slice(5).replace("-", "/")}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border bg-card p-5">
                    <div className="text-2xl font-semibold">{totalAnswers}</div>
                    <div className="mt-1 text-sm text-muted-foreground">近 {WINDOW_DAYS} 天累计复习次数</div>
                  </div>
                  <div className="rounded-xl border bg-card p-5">
                    <div className="text-2xl font-semibold">{totalNewWords}</div>
                    <div className="mt-1 text-sm text-muted-foreground">近 {WINDOW_DAYS} 天新增生词</div>
                  </div>
                </section>

                {totalAnswers === 0 && (
                  <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                    还没有复习记录——去「闪卡复习」开始第一轮吧
                  </div>
                )}
              </>
            )}
      </div>
    </PageLayout>
  )
}

function StatCard({
  label, value, unit, accent,
}: { label: string, value: number, unit: string, accent?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className={`text-2xl font-semibold ${accent ? "text-primary" : ""}`}>
        {value}
        <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
