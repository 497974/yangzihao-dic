/**
 * 中文 → 英文的反查（中文网页混入英文词用）。纯函数，方便测试。
 *
 * 离线词表是英译中，这里把它倒过来：每个英文词的**第一个义项**作为它的中文说法。
 * 只取第一个义项，是因为后面的义项往往是引申义——「duration」的第一义是「持续时间」，
 * 要是连「时间」也算进去，网页上的「时间」就会被换成 duration，读着很别扭。
 *
 * 同一个中文词通常对应好几个英文词，挑选分三步：
 *   1. 去掉变形和派生词：「放弃」下面既有 abandon 也有 abandonment，留原形
 *   2. 不选「由更常用的词派生出来的名词」：importance 来自 important、selection 来自 select。
 *      中文里「重要」「选择」大多当形容词、动词用，换成名词就读不通（见 isDerivedNoun）
 *   3. 在用户选的难度范围内，挑最常用的那个（按词频排名）——越常用的说法越可能是地道的对应
 */

import type { ChineseCompound } from "./chinese-compounds"
import type { WordlistEntry } from "./ecdict"

export interface ChineseCandidate {
  en: string
  level: number
  phonetic: string
  /** 词频排名，越小越常用；0 表示没有数据 */
  rank: number
  /** 人工补充的合成词（见 chinese-compounds.ts） */
  curated?: boolean
  /** 由词表里更常用的词派生出的名词（importance ← important），默认不选 */
  derived?: boolean
}

/** 替换词的难度范围（相对「我的英语水平」） */
export type MixBand = "consolidate" | "improve" | "challenge" | "mixed"

export const MIX_BAND_OPTIONS: ReadonlyArray<{
  value: MixBand
  label: string
  description: string
}> = [
  { value: "consolidate", label: "巩固", description: "与我的水平相当" },
  { value: "improve", label: "提升", description: "比我的水平高一到两档" },
  { value: "challenge", label: "挑战", description: "比我的水平高两档及以上" },
  { value: "mixed", label: "综合", description: "从我的水平到最难的词都有" },
]

export const DEFAULT_MIX_BAND: MixBand = "improve"

const MAX_LEVEL = 7

/** 难度范围 → 难度档区间 [最低, 最高]；超出最高档时退回最高档，GRE 水平也有词可换 */
export function bandRange(userLevel: number, band: MixBand): [number, number] {
  const [low, high] =
    band === "consolidate"
      ? [userLevel, userLevel]
      : band === "improve"
        ? [userLevel + 1, userLevel + 2]
        : band === "challenge"
          ? [userLevel + 2, MAX_LEVEL]
          : [userLevel, MAX_LEVEL]
  return low > MAX_LEVEL ? [MAX_LEVEL, MAX_LEVEL] : [low, Math.min(high, MAX_LEVEL)]
}

/** 不值得换的中文词：虚词、代词，换了读着别扭，也学不到东西 */
const ZH_STOPWORDS = new Set([
  "可以",
  "这个",
  "那个",
  "什么",
  "怎么",
  "这样",
  "那样",
  "一个",
  "一些",
  "我们",
  "他们",
  "自己",
  "东西",
  "没有",
  "因为",
  "所以",
  "但是",
  "如果",
  "已经",
  "还是",
  "或者",
])

const CHINESE_TERM = /^[一-龥]{2,6}$/

/**
 * 一个英文词的第一个义项 → 可以拿来匹配网页的中文说法。
 *
 * 形容词释义带着「的」（显著的）就原样保留，不去掉「的」：网页上的「显著的」会被分词切成
 * 「显著 | 的」，匹配时相邻分词可以拼起来整体换掉，语法上也通顺。
 * 去掉「的」反而会错配——metabolic 的第一义是「变化的」，截成「变化」后，
 * 网页上所有的「变化」都会被换成 metabolic（新陈代谢的）。
 */
export function chineseKeys(gloss: string): string[] {
  const first = gloss.split("；")[0]?.trim() ?? ""
  return CHINESE_TERM.test(first) && !ZH_STOPWORDS.has(first) ? [first] : []
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i++
  }
  return i
}

/**
 * 去掉变形：同一个中文词下，如果有更短的词和它共用词根
 * （abandon / abandonment、opportunity / opportunities），只留短的。
 */
export function dropDerivedForms(candidates: readonly ChineseCandidate[]): ChineseCandidate[] {
  return candidates.filter(
    (word) =>
      !candidates.some(
        (base) =>
          base.en !== word.en &&
          !base.en.includes(" ") &&
          base.en.length >= 4 &&
          base.en.length < word.en.length &&
          commonPrefixLength(base.en, word.en) >= Math.min(base.en.length - 1, 6),
      ),
  )
}

/** 名词后缀 → 可能的原形写法 */
const NOUN_SUFFIX_BASES: ReadonlyArray<readonly [suffix: string, replacements: readonly string[]]> =
  [
    ["ification", ["ify"]],
    ["ation", ["ate", "e", ""]],
    ["ition", ["ite", "e"]],
    ["ion", ["", "e"]],
    ["ment", [""]],
    ["ness", ["", "y"]],
    ["ility", ["le"]],
    ["ity", ["e", ""]],
    ["ance", ["ant", "e", ""]],
    ["ence", ["ent", "e", ""]],
  ]

/**
 * 这个名词是不是由词表里一个更常用的词派生出来的（importance ← important、selection ← select、
 * notability ← notable）。「更常用」是关键：opportunity 虽然能拆出 opportune，但后者冷僻得多，
 * opportunity 本身才是基础词，不算派生。
 *
 * @param rankOf 词表里某个词的词频排名；不在词表里返回 undefined
 */
export function isDerivedNoun(
  en: string,
  rank: number,
  rankOf: (word: string) => number | undefined,
): boolean {
  if (en.includes(" ")) {
    return false
  }
  // 复数单独成条的（options）：中文不分单复数，换成复数读着别扭，原形又常常不在同一个中文词下
  if (en.endsWith("s") && !en.endsWith("ss")) {
    const singular = en.endsWith("ies") ? `${en.slice(0, -3)}y` : en.slice(0, -1)
    if (rankOf(singular) !== undefined) {
      return true
    }
  }
  for (const [suffix, replacements] of NOUN_SUFFIX_BASES) {
    if (!en.endsWith(suffix) || en.length - suffix.length < 3) {
      continue
    }
    const stem = en.slice(0, -suffix.length)
    for (const replacement of replacements) {
      const baseRank = rankOf(stem + replacement)
      if (baseRank !== undefined && baseRank > 0 && (rank === 0 || baseRank < rank)) {
        return true
      }
    }
  }
  return false
}

export function isMixBand(value: unknown): value is MixBand {
  return MIX_BAND_OPTIONS.some((option) => option.value === value)
}

/** 后台反查的结果：中文词 → 换上去的英文 */
export interface MixTermInfo {
  en: string
  level: number
  phonetic: string
}

export type ReverseIndex = Map<string, ChineseCandidate[]>

export function buildReverseIndex(
  entries: readonly WordlistEntry[],
  compounds: readonly ChineseCompound[],
): ReverseIndex {
  const ranks = new Map<string, number>()
  for (const [en, , , , rank = 0] of entries) {
    ranks.set(en, rank)
  }
  const rankOf = (word: string) => ranks.get(word)

  const index: ReverseIndex = new Map()
  const add = (key: string, candidate: ChineseCandidate) => {
    const list = index.get(key)
    if (list) {
      list.push(candidate)
    } else {
      index.set(key, [candidate])
    }
  }
  for (const [en, level, phonetic, gloss, rank = 0] of entries) {
    for (const key of chineseKeys(gloss)) {
      const derived = isDerivedNoun(en, rank, rankOf)
      add(key, { en, level, phonetic, rank, ...(derived ? { derived } : {}) })
    }
  }
  for (const [key, list] of index) {
    index.set(key, dropDerivedForms(list))
  }
  // 人工补充的合成词放在最后，且不参与去重：它们本来就是专门挑过的
  for (const { zh, en, level } of compounds) {
    add(zh, { en, level, phonetic: "", rank: 0, curated: true })
  }
  return index
}

/** 词频排名：没有数据的当作很冷僻 */
const effectiveRank = (candidate: ChineseCandidate) =>
  candidate.rank > 0 ? candidate.rank : Number.MAX_SAFE_INTEGER

/**
 * 在难度范围内挑最常用的英文说法；同样常用时挑难度低的。范围内没有返回 null（这个词就不换）。
 * 人工补充的合成词优先：对应关系是人工确认过的。派生名词不选。
 */
export function pickCandidate(
  candidates: readonly ChineseCandidate[],
  range: readonly [number, number],
): ChineseCandidate | null {
  const [low, high] = range
  // 有人工对照的中文词只认人工对照：自动反查出来的往往是错的（交换 → commute）
  if (candidates.some((item) => item.curated)) {
    return (
      candidates.find((item) => item.curated && item.level >= low && item.level <= high) ?? null
    )
  }
  const inRange = candidates.filter(
    (item) => item.level >= low && item.level <= high && !item.derived,
  )
  if (inRange.length === 0) {
    return null
  }
  return [...inRange].sort((a, b) => effectiveRank(a) - effectiveRank(b) || a.level - b.level)[0]!
}
