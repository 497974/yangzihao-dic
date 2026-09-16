/**
 * 中文网页夹英文词（功能路线图阶段四第 6 条）：中文网页里挑几个词换成英文，
 * 鼠标移上去看中文原文，点一下换回中文。
 *
 * 换哪些词：生词本里的词优先（英文词条 + 释义里的中文说法）；其余的中文词问后台的离线词表，
 * 按「我的英语水平」和设置里的难度范围挑英文说法——太简单的词不换。
 * 存了新词、改了设置都会马上跟着变，不用刷新网页。具体做法见 utils/chinese-mix/。
 */

import type { ChineseMixer, MixDensity } from "@/utils/chinese-mix/mixer"
import type { MixPair, MixPairs } from "@/utils/chinese-mix/pairs"
import type { MixBand } from "@/utils/wordlist/reverse"
import { defineContentScript, storage } from "#imports"
import { MIX_DENSITY_BUDGET, startChineseMixer } from "@/utils/chinese-mix/mixer"
import { buildNotebasePairs, isChinesePage } from "@/utils/chinese-mix/pairs"
import {
  CHINESE_MIX_BAND_KEY,
  CHINESE_MIX_DEFAULT_DENSITY,
  CHINESE_MIX_DEFAULT_ENABLED,
  CHINESE_MIX_DENSITY_KEY,
  CHINESE_MIX_ENABLED_KEY,
} from "@/utils/constants/chinese-mix"
import { VOCAB_TEST_RESULT_KEY } from "@/utils/constants/vocab-test"
import { ENGLISH_LEVEL_KEY } from "@/utils/constants/word-wise"
import { LOCAL_NOTEBASE_DB_KEY, readDb } from "@/utils/local-notebase/storage"
import { sendMessage } from "@/utils/message"
import { getEffectiveSiteControlUrl } from "@/utils/site-control"
import { isSiteEnabledBySnapshot, readSiteControl } from "@/utils/site-control-light"
import { readEnglishLevel } from "@/utils/word-wise/settings"
import { DEFAULT_MIX_BAND, isMixBand } from "@/utils/wordlist/reverse"

/** 和后台单次查词的上限一致 */
const LOOKUP_CHUNK = 3_000

export default defineContentScript({
  matches: ["*://*/*", "file:///*"],
  runAt: "document_idle",
  async main(ctx) {
    // 在网站设置里对这个网站关掉了扩展，就不动它的网页。
    // 用轻量读法而不是 getLocalConfig：后者会把整份配置的 zod schema 拖进这个脚本
    // （见 utils/site-control-light.ts）
    const siteControl = await readSiteControl()
    if (!isSiteEnabledBySnapshot(getEffectiveSiteControlUrl(window.location.href), siteControl)) {
      return
    }

    let mixer: ChineseMixer | null = null
    let refreshing: Promise<void> = Promise.resolve()

    const refresh = async () => {
      const enabled =
        (await storage.getItem<boolean>(CHINESE_MIX_ENABLED_KEY)) ?? CHINESE_MIX_DEFAULT_ENABLED
      // 英文网页本来就在读英文，再夹英文词没有意义
      if (!enabled || !isChinesePage(document.body?.innerText ?? "")) {
        mixer?.stop()
        mixer = null
        return
      }
      const [density, storedBand, { level }, db] = await Promise.all([
        storage.getItem<MixDensity>(CHINESE_MIX_DENSITY_KEY),
        storage.getItem<unknown>(CHINESE_MIX_BAND_KEY),
        readEnglishLevel(),
        readDb(),
      ])
      const band: MixBand = isMixBand(storedBand) ? storedBand : DEFAULT_MIX_BAND
      const notebasePairs = buildNotebasePairs(db)

      // 这一轮设置下查过的词记下来：页面后来加载的内容大多是同一批词，不用反复问后台
      const cache = new Map<string, MixPair | null>()
      const resolve = async (terms: string[]): Promise<MixPairs> => {
        const missing = terms.filter((term) => !notebasePairs.has(term) && !cache.has(term))
        for (let i = 0; i < missing.length; i += LOOKUP_CHUNK) {
          const chunk = missing.slice(i, i + LOOKUP_CHUNK)
          const found = await sendMessage("lookupChineseTerms", { terms: chunk, level, band })
          for (const zh of chunk) {
            const info = found[zh]
            cache.set(zh, info ? { zh, ...info, source: "wordlist" } : null)
          }
        }
        const pairs: MixPairs = new Map()
        for (const term of terms) {
          const pair = notebasePairs.get(term) ?? cache.get(term)
          if (pair) {
            pairs.set(term, pair)
          }
        }
        return pairs
      }

      mixer ??= startChineseMixer(document)
      await mixer.restart(
        resolve,
        MIX_DENSITY_BUDGET[density ?? CHINESE_MIX_DEFAULT_DENSITY] ?? MIX_DENSITY_BUDGET.medium,
      )
    }

    // 存词会连着写好几次存储；排队执行，前一次没做完不会并发改网页
    const scheduleRefresh = () => {
      refreshing = refreshing.then(refresh, refresh).catch(() => {
        // 后台暂时没响应（扩展刚更新）：这次不换，下次设置变化时再试
      })
    }

    scheduleRefresh()
    const watchedKeys = [
      LOCAL_NOTEBASE_DB_KEY,
      CHINESE_MIX_ENABLED_KEY,
      CHINESE_MIX_DENSITY_KEY,
      CHINESE_MIX_BAND_KEY,
      ENGLISH_LEVEL_KEY,
      VOCAB_TEST_RESULT_KEY,
    ] as const
    const unwatchers = watchedKeys.map((key) => storage.watch(key, scheduleRefresh))
    ctx.onInvalidated(() => {
      for (const unwatch of unwatchers) {
        unwatch()
      }
      mixer?.stop()
      mixer = null
    })
  },
})
