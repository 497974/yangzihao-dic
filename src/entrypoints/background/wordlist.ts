/**
 * 离线词表查询服务（阶段五实现方案 · 步骤 0）。
 *
 * 词表放在后台而不是内容脚本里：内容脚本各自打包、不共享代码，
 * 800 多 KB 的词表打进去，每个网页的每个脚本都要各背一份、各解析一次。
 * 这里第一次被问到时才读 public/data/wordlist.json，之后常驻内存；
 * service worker 被浏览器回收后再被问到，会重新读一次（几十毫秒）。
 */

import type { WordlistFile } from "@/utils/wordlist/ecdict"
import type { WordInfo } from "@/utils/wordlist/lookup"
import type { MixBand, MixTermInfo, ReverseIndex } from "@/utils/wordlist/reverse"
import { browser } from "#imports"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import { CHINESE_COMPOUNDS } from "@/utils/wordlist/chinese-compounds"
import { Wordlist } from "@/utils/wordlist/lookup"
import { bandRange, buildReverseIndex, pickCandidate } from "@/utils/wordlist/reverse"

/** 一次最多查这么多个词：一页正文去重后通常几百个，再多就是异常请求 */
export const MAX_WORDS_PER_LOOKUP = 3_000

interface LoadedWordlist {
  wordlist: Wordlist
  file: WordlistFile
  /** 中文 → 英文的反查表，第一次有人问中文词时才建（中文网页混入英文词用） */
  reverse: ReverseIndex | null
}

let loading: Promise<LoadedWordlist> | null = null

function loadWordlist(): Promise<LoadedWordlist> {
  loading ??= (async () => {
    const response = await fetch(browser.runtime.getURL("/data/wordlist.json"))
    if (!response.ok) {
      throw new Error(`读取离线词表失败：HTTP ${response.status}`)
    }
    const file = (await response.json()) as WordlistFile
    const wordlist = new Wordlist(file)
    logger.info(`[Wordlist] 已加载 ${wordlist.size} 个词`)
    return { wordlist, file, reverse: null }
  })().catch((error: unknown) => {
    // 失败了别把失败的 Promise 缓存住：下次再问还能重试
    loading = null
    throw error
  })
  return loading
}

/** 批量查词，只返回查到的：{ 网页上的原词: 词条信息 } */
export async function lookupWords(words: readonly string[]): Promise<Record<string, WordInfo>> {
  const { wordlist } = await loadWordlist()
  const result: Record<string, WordInfo> = {}
  for (const word of words.slice(0, MAX_WORDS_PER_LOOKUP)) {
    const info = wordlist.lookup(word)
    if (info) {
      result[word] = info
    }
  }
  return result
}

/**
 * 批量反查中文词，只返回在难度范围内有合适英文说法的：{ 中文词: 英文 }。
 * 怎么挑英文说法见 utils/wordlist/reverse.ts。
 */
export async function lookupChineseTerms(
  terms: readonly string[],
  level: number,
  band: MixBand,
): Promise<Record<string, MixTermInfo>> {
  const loaded = await loadWordlist()
  loaded.reverse ??= buildReverseIndex(loaded.file.words, CHINESE_COMPOUNDS)
  const range = bandRange(level, band)
  const result: Record<string, MixTermInfo> = {}
  for (const term of terms.slice(0, MAX_WORDS_PER_LOOKUP)) {
    const candidates = loaded.reverse.get(term)
    const picked = candidates && pickCandidate(candidates, range)
    if (picked) {
      result[term] = { en: picked.en, level: picked.level, phonetic: picked.phonetic }
    }
  }
  return result
}

export function setupWordlistMessageHandlers() {
  onMessage("lookupWords", async (message) => lookupWords(message.data.words))
  onMessage("lookupChineseTerms", async (message) =>
    lookupChineseTerms(message.data.terms, message.data.level, message.data.band),
  )
}
