/**
 * 页面难度 / 掌握度（阶段五实现方案 · 步骤 2）。纯函数，方便测试。
 *
 * 「本页约 94% 的词在你的水平内」的算法：
 *   - 按词次数算（the 出现 50 次就算 50 个），这才是读的时候真实的感受
 *   - 词表里没有的词算「认识」：没进任何考试词表的，绝大多数是 the、of 这类最基础的词，
 *     剩下的是人名地名——不算生词
 *   - 难度档不高于我的水平的算认识；生词本里已掌握的也算认识
 */

import type { EnglishLevel } from "./level"
import type { WordInfo } from "@/utils/wordlist/lookup"

/** 英文单词：字母开头结尾，中间可以有撇号、连字符 */
const WORD_PATTERN = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g

/** 一段文字里每个英文词出现几次（按原样保留大小写，查词时后台会统一规整） */
export function countWords(text: string, counts: Map<string, number> = new Map()) {
  for (const match of text.matchAll(WORD_PATTERN)) {
    const word = match[0]
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return counts
}

/**
 * 是不是英文为主的页面：中文网页上算英文难度没有意义（那边有「中文网页混入英文词」）。
 * 抽一段正文，英文字母占非空白字符的一半以上，且汉字很少。
 */
export function isEnglishPage(sampleText: string): boolean {
  const sample = sampleText.slice(0, 5_000).replace(/\s/g, "")
  if (sample.length < 200) {
    return false
  }
  const letters = sample.match(/[A-Za-z]/g)?.length ?? 0
  const chinese = sample.match(/[一-龥]/g)?.length ?? 0
  return letters / sample.length >= 0.5 && chinese / sample.length < 0.05
}

export interface PageCoverage {
  /** 一共多少词次 */
  total: number
  /** 在水平内的比例（0~1） */
  coverage: number
  /** 超纲的不同词（按原形去重）有多少个 */
  hardWords: number
}

/** 词次太少算出来的比例没有意义（导航栏、按钮文字），这时返回 null */
export const MIN_WORDS_FOR_COVERAGE = 150

export function computeCoverage(
  counts: ReadonlyMap<string, number>,
  infos: Readonly<Record<string, WordInfo>>,
  userLevel: EnglishLevel,
  mastered: ReadonlySet<string>,
): PageCoverage | null {
  let total = 0
  let known = 0
  const hard = new Set<string>()
  for (const [word, count] of counts) {
    total += count
    const info = infos[word]
    const lemma = info?.lemma
    const isKnown =
      !info || info.level <= userLevel || mastered.has(word.toLowerCase()) || mastered.has(lemma!)
    if (isKnown) {
      known += count
    } else {
      hard.add(lemma!)
    }
  }
  if (total < MIN_WORDS_FOR_COVERAGE) {
    return null
  }
  return { total, coverage: known / total, hardWords: hard.size }
}

/** 覆盖率 → 一句话评价：95% 以上基本能流畅读，90% 左右需要查几个词，再低就吃力了 */
export function describeCoverage(coverage: number): string {
  if (coverage >= 0.98) return "非常轻松"
  if (coverage >= 0.95) return "可以流畅阅读"
  if (coverage >= 0.9) return "需要查少量生词"
  return "难度偏高"
}
