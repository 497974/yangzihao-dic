/**
 * 中文网页夹英文词（功能路线图阶段四第 6 条，Toucan 的玩法）要用的词对：
 * 中文词 → 换上去的英文词。
 *
 * 两个来源：
 *   1. 你自己的生词本——从「释义」里拆出中文词，配上生词本里的英文词条。
 *      换上去的都是你存过、正在背的词，读中文网页也在一次次遇见它们。
 *   2. 离线词表反查——按「我的英语水平」和选的难度范围挑英文说法（后台做，见 wordlist/reverse.ts），
 *      太简单的词（学生 → student）不换，换上去的是值得学的词。
 *
 * 匹配按分词来：中文词之间没有空格，直接按字符串找会把「留学生」里的「学生」换掉，
 * 变成「留students」。先用浏览器自带的分词器切开，只在分词边界上匹配。
 *
 * 纯逻辑，方便测试；改网页在 mixer.ts 里。
 */

import type { LocalNotebaseDb } from "@/utils/local-notebase/storage"
import { cellToText } from "@/utils/notebase/cell-text"

export interface MixPair {
  /** 网页上要换掉的中文词 */
  zh: string
  /** 换上去的英文词 */
  en: string
  phonetic: string
  /** 来自生词本还是离线词表（提示卡片里说明用） */
  source: "notebase" | "wordlist"
  /** 难度档（1 中考 … 7 GRE）；来自生词本的词没有 */
  level?: number
}

/** 中文词 → 词对。key 就是中文词 */
export type MixPairs = Map<string, MixPair>

const MEANING_COLUMN = /释义|意思|中文|翻译|含义|meaning|definition|translation/i
const PHONETIC_COLUMN = /音标|发音|phonetic|pronunciation|ipa/i

/** 只换这么长的中文词：一个字的（会、点、大）到处都是，换了满页乱码；太长的网页上撞不上 */
export const MIN_ZH_LENGTH = 2
export const MAX_ZH_LENGTH = 6

/** 英文词条长这样才用来换：字母开头结尾，中间可以有空格、连字符、撇号 */
const EN_TERM = /^[a-z][a-z' -]*[a-z]$/i

/** 纯汉字（一 到 龥 就是常用汉字那一段） */
const CHINESE_ONLY = /^[一-龥]+$/

/** 释义里常见的词性前缀，拆词时先去掉 */
const POS_PREFIX =
  /^(?:(?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|aux|abbr)\.\s*|名词|动词|形容词|副词|介词|连词|代词|数词|感叹词|及物动词|不及物动词)/i

/**
 * 这些中文词不换：在句子里多半是别的意思，或者是别的词的一部分，换了读着更别扭。
 * 例：「可以」「这个」当不了实词；「东西」既是 thing 也是方位。
 */
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
  "这些",
  "那些",
])

/**
 * 从一条释义里拆出可以拿来换的中文词。
 * 释义写法五花八门：「v. 获得；取得」「获得，得到（正式）」「〈动〉获得」，
 * 统一按标点拆开、去掉词性前缀，只留纯中文的短词。
 */
export function extractChineseWords(meaning: string): string[] {
  const words: string[] = []
  for (const rawPart of meaning.split(/[；;，,、。.！!？?/|｜\n\r\t ]+/)) {
    const part = rawPart
      .replace(/[（(][^）)]*[）)]/g, "")
      .replace(/[〈<「『【[][^〉>」』】\]]*[〉>」』】\]]/g, "")
      .replace(POS_PREFIX, "")
      .trim()
    if (
      part.length >= MIN_ZH_LENGTH &&
      part.length <= MAX_ZH_LENGTH &&
      CHINESE_ONLY.test(part) &&
      !ZH_STOPWORDS.has(part) &&
      !words.includes(part)
    ) {
      words.push(part)
    }
  }
  return words
}

/** 一个英文词最多贡献这么多个中文说法：一个词占满整页就没意思了 */
const MAX_WORDS_PER_TERM = 2

/** 从生词本里拆出词对：英文词条 + 释义里的中文词 */
export function buildMixPairsFromDb(db: LocalNotebaseDb): MixPairs {
  const pairs: MixPairs = new Map()
  for (const notebase of Object.values(db.notebases)) {
    const columns = [...notebase.notebaseColumns].sort((a, b) => a.position - b.position)
    const primary = columns.find((column) => column.isPrimary) ?? columns[0]
    if (!primary) {
      continue
    }
    const others = columns.filter((column) => column.id !== primary.id)
    const phoneticColumn = others.find((column) => PHONETIC_COLUMN.test(column.name))
    const meaningColumn =
      others.find((column) => MEANING_COLUMN.test(column.name)) ??
      others.find((column) => column !== phoneticColumn)
    if (!meaningColumn) {
      continue
    }

    for (const row of notebase.notebaseRows) {
      const en = cellToText(row.cells[primary.id]).trim().replace(/\s+/g, " ")
      if (!EN_TERM.test(en)) {
        continue
      }
      const phonetic = phoneticColumn ? cellToText(row.cells[phoneticColumn.id]).trim() : ""
      const words = extractChineseWords(cellToText(row.cells[meaningColumn.id]))
      for (const zh of words.slice(0, MAX_WORDS_PER_TERM)) {
        if (!pairs.has(zh)) {
          pairs.set(zh, { zh, en, phonetic, source: "notebase" })
        }
      }
    }
  }
  return pairs
}

/** 从生词本里拆出词对，同一个英文词只留一个中文说法，免得满页都是同一个词 */
export function buildNotebasePairs(db: LocalNotebaseDb): MixPairs {
  const pairs = buildMixPairsFromDb(db)
  const usedEnglish = new Set<string>()
  for (const [zh, pair] of pairs) {
    const key = pair.en.toLowerCase()
    if (usedEnglish.has(key)) {
      pairs.delete(zh)
    } else {
      usedEnglish.add(key)
    }
  }
  return pairs
}

/** 分词器：浏览器自带的中文分词（Intl.Segmenter），不用另外打包词典 */
export function createSegmenter(): Intl.Segmenter {
  return new Intl.Segmenter("zh-Hans", { granularity: "word" })
}

/** 最多把几个相邻的分词拼成一个词来查：「交换生」会被切成「交换 | 生」，「显著的」切成「显著 | 的」 */
export const MAX_SEGMENTS_PER_TERM = 3

const CHINESE_TERM = /^[一-龥]+$/

interface Span {
  index: number
  term: string
}

/**
 * 一段文字里所有可以拿来查的词：单个分词，或者相邻的两三个分词拼起来，
 * 纯汉字、长度在范围内。每个词都从分词边界开始、到分词边界结束——
 * 所以「留学生」（分词器认得这是一个词）里永远查不出「学生」，不会换成「留students」。
 */
function spansAt(segments: readonly Intl.SegmentData[], start: number): Span[] {
  const spans: Span[] = []
  const first = segments[start]!
  let term = ""
  for (let i = start; i < segments.length && i < start + MAX_SEGMENTS_PER_TERM; i++) {
    const segment = segments[i]!
    if (!CHINESE_TERM.test(segment.segment)) {
      break
    }
    term += segment.segment
    if (term.length > MAX_ZH_LENGTH) {
      break
    }
    if (term.length >= MIN_ZH_LENGTH && !ZH_STOPWORDS.has(term)) {
      spans.push({ index: first.index, term })
    }
  }
  return spans
}

/** 一段文字里所有候选词（去重），发给后台反查用 */
export function collectTerms(text: string, segmenter: Intl.Segmenter, into = new Set<string>()) {
  if (!/[一-龥]/.test(text)) {
    return into
  }
  const segments = [...segmenter.segment(text)]
  for (let i = 0; i < segments.length; i++) {
    for (const span of spansAt(segments, i)) {
      into.add(span.term)
    }
  }
  return into
}

export interface MixMatch {
  index: number
  pair: MixPair
}

/**
 * 在一段文字里找出要换的词：从左往右，每个位置先试最长的拼法，查到了就跳过这几个分词。
 * resolve 返回 undefined 表示这个词不换（没有合适的英文、超出难度范围、这一页已经换够了）。
 */
export function findMatches(
  text: string,
  segmenter: Intl.Segmenter,
  resolve: (term: string) => MixPair | undefined,
): MixMatch[] {
  if (!/[一-龥]/.test(text)) {
    return []
  }
  const segments = [...segmenter.segment(text)]
  const matches: MixMatch[] = []
  for (let i = 0; i < segments.length; i++) {
    const spans = spansAt(segments, i)
    for (let k = spans.length - 1; k >= 0; k--) {
      const span = spans[k]!
      const pair = resolve(span.term)
      if (pair) {
        matches.push({ index: span.index, pair })
        // 跳过拼进这个词的分词
        const end = span.index + span.term.length
        while (i + 1 < segments.length && segments[i + 1]!.index < end) {
          i++
        }
        break
      }
    }
  }
  return matches
}

/**
 * 这一页是不是中文网页。抽一段正文看汉字占多少——英文网页本来就在读英文，
 * 再夹英文词没有意义；中英夹杂的页面（很多技术博客）也照夹。
 */
export function isChinesePage(sampleText: string): boolean {
  const sample = sampleText.slice(0, 3_000)
  const chinese = sample.match(/[一-龥]/g)?.length ?? 0
  return chinese >= 50 && chinese / Math.max(sample.replace(/\s/g, "").length, 1) >= 0.2
}
