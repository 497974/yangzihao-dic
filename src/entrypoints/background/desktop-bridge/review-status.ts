/**
 * 复习提醒（优化清单第 10 条）：桌面版问「今天有几个词该复习了」，托盘每天提醒一次；
 * 点提醒就打开扩展的闪卡复习页。
 *
 * 数法和闪卡复习页一样（srs.scheduleStatusStats：到期的学习中、复习卡，加上新卡），
 * 新卡按每个生词本「每天学几个新词」封顶——存了 200 个词就提醒「200 个该复习」只会把人吓跑。
 */

import { call } from "@orpc/server"
import { localSrsRouter } from "@/utils/local-notebase/srs-router"
import { readDb } from "@/utils/local-notebase/storage"
import { openOptionsPage } from "@/utils/navigation"

export interface DesktopReviewStatus {
  /** 今天该复习的总数（新卡已按每天上限封顶） */
  due: number
  newCount: number
  /** 到期的学习中 + 复习卡 */
  reviewCount: number
}

type ScheduleStats = Record<string, { new?: number; learning?: number; review?: number }>

interface ReviewStatusDeps {
  getStats: () => Promise<ScheduleStats>
  /** 每个生词本每天最多学几个新词 */
  getNewPerDay: () => Promise<Record<string, number>>
}

const defaultDeps: ReviewStatusDeps = {
  // 统计前会先给新存的词补上卡片，所以刚存的词也算在里面
  // 「今天」按用户所在的时区算，和闪卡复习页一致
  getStats: () =>
    call(localSrsRouter.srs.scheduleStatusStats, {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  getNewPerDay: async () =>
    Object.fromEntries(
      Object.values((await readDb()).notebases).map((notebase) => [
        notebase.id,
        notebase.srsNewPerDay,
      ]),
    ),
}

export async function getReviewStatusForDesktop(
  deps: ReviewStatusDeps = defaultDeps,
): Promise<DesktopReviewStatus> {
  const [stats, newPerDay] = await Promise.all([deps.getStats(), deps.getNewPerDay()])
  let newCount = 0
  let reviewCount = 0
  for (const [notebaseId, counts] of Object.entries(stats)) {
    const limit = newPerDay[notebaseId] ?? Number.POSITIVE_INFINITY
    newCount += Math.min(counts.new ?? 0, Math.max(0, limit))
    reviewCount += (counts.learning ?? 0) + (counts.review ?? 0)
  }
  return { due: newCount + reviewCount, newCount, reviewCount }
}

/** 桌面版点了复习提醒：在浏览器里打开闪卡复习页 */
export async function openReviewPageForDesktop(
  open: typeof openOptionsPage = openOptionsPage,
): Promise<{ opened: true }> {
  await open({ route: "/review" })
  return { opened: true }
}
