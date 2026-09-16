/**
 * 网页生词高亮（优化清单第 9 条）：生词本里的词出现在网页上时标出来，鼠标移上去看音标和释义。
 *
 * 词表直接从本地生词本读（chrome.storage.local），存了新词、删了词、关了开关都会马上跟着变，
 * 不用刷新网页。标词、提示卡片的具体做法见 utils/vocab-highlight/highlighter.ts。
 */

import type { VocabHighlighter } from "@/utils/vocab-highlight/highlighter"
import { defineContentScript, storage } from "#imports"
import {
  VOCAB_HIGHLIGHT_DEFAULT_ENABLED,
  VOCAB_HIGHLIGHT_DEFAULT_SHOW_MASTERED,
  VOCAB_HIGHLIGHT_ENABLED_KEY,
  VOCAB_HIGHLIGHT_SHOW_MASTERED_KEY,
} from "@/utils/constants/vocab-highlight"
import { LOCAL_SRS_DB_KEY, readSrsDb } from "@/utils/local-notebase/srs-storage"
import { LOCAL_NOTEBASE_DB_KEY, readDb } from "@/utils/local-notebase/storage"
import { getEffectiveSiteControlUrl } from "@/utils/site-control"
import { isSiteEnabledBySnapshot, readSiteControl } from "@/utils/site-control-light"
import { startVocabHighlighter } from "@/utils/vocab-highlight/highlighter"
import { buildVocabulary } from "@/utils/vocab-highlight/vocabulary"

export default defineContentScript({
  matches: ["*://*/*", "file:///*"],
  runAt: "document_idle",
  async main(ctx) {
    // 在网站设置里对这个网站关掉了扩展，就不标。
    // 用轻量读法而不是 getLocalConfig：后者会把整份配置的 zod schema 拖进这个脚本
    // （见 utils/site-control-light.ts）
    const siteControl = await readSiteControl()
    if (!isSiteEnabledBySnapshot(getEffectiveSiteControlUrl(window.location.href), siteControl)) {
      return
    }

    let highlighter: VocabHighlighter | null = null
    let refreshing: Promise<void> = Promise.resolve()

    const refresh = async () => {
      const enabled =
        (await storage.getItem<boolean>(VOCAB_HIGHLIGHT_ENABLED_KEY)) ??
        VOCAB_HIGHLIGHT_DEFAULT_ENABLED
      // 词表带上每个词的学习状态（取自闪卡记录）：新词、学习中、已掌握各用各的样式
      const vocab = enabled ? buildVocabulary(await readDb(), await readSrsDb()) : new Map()
      if (vocab.size === 0) {
        highlighter?.stop()
        highlighter = null
        return
      }
      highlighter ??= startVocabHighlighter(document)
      highlighter.setShowMastered(
        (await storage.getItem<boolean>(VOCAB_HIGHLIGHT_SHOW_MASTERED_KEY)) ??
          VOCAB_HIGHLIGHT_DEFAULT_SHOW_MASTERED,
      )
      // 等整页标完再让下一次刷新开始：排队就是为了不并发改网页
      await highlighter.setVocabulary(vocab)
    }

    // 存词会连着写好几次存储；排队执行，前一次没做完不会并发改网页
    const scheduleRefresh = () => {
      refreshing = refreshing.then(refresh, refresh)
    }

    scheduleRefresh()
    const unwatchDb = storage.watch(LOCAL_NOTEBASE_DB_KEY, scheduleRefresh)
    const unwatchEnabled = storage.watch(VOCAB_HIGHLIGHT_ENABLED_KEY, scheduleRefresh)
    const unwatchShowMastered = storage.watch(VOCAB_HIGHLIGHT_SHOW_MASTERED_KEY, scheduleRefresh)
    // 复习一次闪卡库就写一次：状态变了只改标记上的属性，不会重扫整页（见 highlighter.setVocabulary）
    const unwatchSrs = storage.watch(LOCAL_SRS_DB_KEY, scheduleRefresh)
    ctx.onInvalidated(() => {
      unwatchDb()
      unwatchEnabled()
      unwatchShowMastered()
      unwatchSrs()
      highlighter?.stop()
      highlighter = null
    })
  },
})
