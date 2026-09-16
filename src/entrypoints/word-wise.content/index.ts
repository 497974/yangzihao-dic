/**
 * 行内中文释义提示 + 页面难度角标（阶段五实现方案 · 步骤 2）。
 *
 * 只在英文为主的页面上工作；两个功能默认都关，在设置页「阅读辅助」里开启。
 * 查词走后台的离线词表（见 background/wordlist.ts）——词表不打进这个脚本。
 *
 * 生词本里的词交给生词高亮负责（它有学习状态和更完整的释义），这里不重复提示。
 */

import type { WordWise } from "@/utils/word-wise/annotator"
import type { WordInfo } from "@/utils/wordlist/lookup"
import { defineContentScript, storage } from "#imports"
import { VOCAB_TEST_RESULT_KEY } from "@/utils/constants/vocab-test"
import {
  ENGLISH_LEVEL_KEY,
  PAGE_DIFFICULTY_BADGE_DEFAULT,
  PAGE_DIFFICULTY_BADGE_KEY,
  WORD_WISE_DEFAULT_ENABLED,
  WORD_WISE_ENABLED_KEY,
  WORD_WISE_RANGE_KEY,
} from "@/utils/constants/word-wise"
import { readSrsDb } from "@/utils/local-notebase/srs-storage"
import { LOCAL_NOTEBASE_DB_KEY, readDb } from "@/utils/local-notebase/storage"
import { sendMessage } from "@/utils/message"
import { getEffectiveSiteControlUrl } from "@/utils/site-control"
import { isSiteEnabledBySnapshot, readSiteControl } from "@/utils/site-control-light"
import { buildVocabulary } from "@/utils/vocab-highlight/vocabulary"
import { collectTextNodes, startWordWise } from "@/utils/word-wise/annotator"
import { showDifficultyBadge } from "@/utils/word-wise/badge"
import { computeCoverage, countWords, isEnglishPage } from "@/utils/word-wise/coverage"
import { ENGLISH_LEVEL_OPTIONS, needsHint } from "@/utils/word-wise/level"
import { readEnglishLevel, readHintRange } from "@/utils/word-wise/settings"

/** 和后台单次查词的上限一致 */
const LOOKUP_CHUNK = 3_000

export default defineContentScript({
  matches: ["*://*/*", "file:///*"],
  runAt: "document_idle",
  async main(ctx) {
    const siteControl = await readSiteControl()
    if (!isSiteEnabledBySnapshot(getEffectiveSiteControlUrl(window.location.href), siteControl)) {
      return
    }

    // 这一页查过的词记下来：页面后来加载的内容大多是同一批词，不用反复问后台
    const cache = new Map<string, WordInfo | null>()
    async function lookup(words: readonly string[]): Promise<Record<string, WordInfo>> {
      const missing = words.filter((word) => !cache.has(word))
      for (let i = 0; i < missing.length; i += LOOKUP_CHUNK) {
        const chunk = missing.slice(i, i + LOOKUP_CHUNK)
        const found = await sendMessage("lookupWords", { words: chunk })
        for (const word of chunk) {
          cache.set(word, found[word] ?? null)
        }
      }
      const result: Record<string, WordInfo> = {}
      for (const word of words) {
        const info = cache.get(word)
        if (info) {
          result[word] = info
        }
      }
      return result
    }

    let wordWise: WordWise | null = null
    let removeBadge: (() => void) | null = null

    const stopAll = () => {
      wordWise?.stop()
      wordWise = null
      removeBadge?.()
      removeBadge = null
    }

    const refresh = async () => {
      stopAll()
      const [hintsOn, badgeOn] = await Promise.all([
        storage.getItem<boolean>(WORD_WISE_ENABLED_KEY),
        storage.getItem<boolean>(PAGE_DIFFICULTY_BADGE_KEY),
      ])
      const showHints = hintsOn ?? WORD_WISE_DEFAULT_ENABLED
      const showBadge = badgeOn ?? PAGE_DIFFICULTY_BADGE_DEFAULT
      if ((!showHints && !showBadge) || !isEnglishPage(document.body?.innerText ?? "")) {
        return
      }

      const [{ level }, range, vocab] = await Promise.all([
        readEnglishLevel(),
        readHintRange(),
        readDb().then(async (db) => buildVocabulary(db, await readSrsDb())),
      ])
      const notebook = new Set(vocab.keys())
      const mastered = new Set(
        [...vocab].filter(([, entry]) => entry.status === "mastered").map(([key]) => key),
      )

      if (showHints) {
        wordWise = startWordWise(document, {
          decideFor: async (words) => {
            const infos = await lookup(words)
            return (word) => {
              const info = infos[word]
              if (!info || notebook.has(word.toLowerCase()) || notebook.has(info.lemma)) {
                return null
              }
              return needsHint(info.level, level, range)
                ? { lemma: info.lemma, gloss: info.gloss }
                : null
            }
          },
        })
        await wordWise.ready
      }

      if (showBadge) {
        const root = document.body ?? document.documentElement
        const counts = new Map<string, number>()
        for (const node of collectTextNodes(root)) {
          countWords(node.nodeValue ?? "", counts)
        }
        const infos = await lookup([...counts.keys()])
        const coverage = computeCoverage(counts, infos, level, mastered)
        if (coverage) {
          const label = ENGLISH_LEVEL_OPTIONS.find((option) => option.value === level)?.label ?? ""
          removeBadge = showDifficultyBadge(document, coverage, label)
        }
      }
    }

    let refreshing: Promise<void> = Promise.resolve()
    const scheduleRefresh = () => {
      refreshing = refreshing.then(refresh, refresh)
    }

    scheduleRefresh()
    const unwatch = [
      WORD_WISE_ENABLED_KEY,
      WORD_WISE_RANGE_KEY,
      PAGE_DIFFICULTY_BADGE_KEY,
      ENGLISH_LEVEL_KEY,
      VOCAB_TEST_RESULT_KEY,
      // 存了新词：它从「提示」转给生词高亮负责
      LOCAL_NOTEBASE_DB_KEY,
    ].map((key) => storage.watch(key as `local:${string}`, scheduleRefresh))

    ctx.onInvalidated(() => {
      for (const stop of unwatch) {
        stop()
      }
      stopAll()
    })
  },
})
