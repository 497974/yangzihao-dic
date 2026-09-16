/**
 * 网页生词高亮要用的词表：从本地生词本里取出每个词和它的音标、释义，再拼成一个匹配用的正则。
 * 纯函数，方便测试；读存储、改网页在 highlighter.ts 和 vocab-highlight.content 里。
 */

import type { WordStatus } from "./status"
import type { LocalSrsDb } from "@/utils/local-notebase/srs-storage"
import type { LocalNotebaseDb } from "@/utils/local-notebase/storage"
import { cellToText } from "@/utils/notebase/cell-text"
import { normalizeNotebaseTerm } from "@/utils/notebase/duplicate"
import { wordProgress } from "./status"

export interface VocabEntry {
  /** 生词本里写的样子（保留大小写） */
  term: string
  phonetic: string
  meaning: string
  /** 学到什么程度（取自闪卡记录，见 status.ts） */
  status: WordStatus
  /** 下次复习时间；新词为 null */
  dueAt: string | null
}

/** key 是规范化后的词（小写、空白合一），和存词去重用的是同一套规则 */
export type Vocabulary = Map<string, VocabEntry>

/** 列名像这样的当作释义、音标；词典的列和用户自己改过名的列都认得出来 */
const MEANING_COLUMN = /释义|意思|中文|翻译|含义|meaning|definition|translation/i
const PHONETIC_COLUMN = /音标|发音|phonetic|pronunciation|ipa/i

/**
 * 只标英文单词和短语：字母开头结尾，中间只有字母、空格、连字符、撇号。
 * 中文、带标点的整句不标——前者网页上几乎不会原样出现，后者匹配不上还白费力气。
 */
const HIGHLIGHTABLE = /^[a-z][a-z' -]*[a-z]$/i
/** 太短的（is、to、an）会把整页标满，不标 */
export const MIN_TERM_LENGTH = 3
export const MAX_TERM_LENGTH = 40
/** 词再多，一个正则也就这么多；生词本真到这么大，先标前面这些 */
export const MAX_TERMS = 5_000

/**
 * @param srsDb 本地闪卡库。不传就当所有词都没复习过（全是新词）——
 *   只关心有哪些词、不关心进度的地方不必去读闪卡库。
 */
export function buildVocabulary(db: LocalNotebaseDb, srsDb?: LocalSrsDb): Vocabulary {
  const vocab: Vocabulary = new Map()
  // 生词本的一行 → 它的所有卡片（一个词可能有好几种题型的卡）
  const cardsByRow = new Map<string, LocalSrsDb["cards"][string][]>()
  for (const card of Object.values(srsDb?.cards ?? {})) {
    const list = cardsByRow.get(card.notebaseRowId)
    if (list) {
      list.push(card)
    } else {
      cardsByRow.set(card.notebaseRowId, [card])
    }
  }
  for (const notebase of Object.values(db.notebases)) {
    const columns = [...notebase.notebaseColumns].sort((a, b) => a.position - b.position)
    const primary = columns.find((column) => column.isPrimary) ?? columns[0]
    if (!primary) {
      continue
    }
    const others = columns.filter((column) => column.id !== primary.id)
    const phonetic = others.find((column) => PHONETIC_COLUMN.test(column.name))
    const meaning =
      others.find((column) => MEANING_COLUMN.test(column.name)) ??
      others.find((column) => column !== phonetic)

    for (const row of notebase.notebaseRows) {
      const term = cellToText(row.cells[primary.id]).trim().replace(/\s+/g, " ")
      if (
        term.length < MIN_TERM_LENGTH ||
        term.length > MAX_TERM_LENGTH ||
        !HIGHLIGHTABLE.test(term)
      ) {
        continue
      }
      const key = normalizeNotebaseTerm(term)
      if (vocab.has(key)) {
        continue
      }
      const progress = wordProgress(cardsByRow.get(row.id) ?? [])
      vocab.set(key, {
        term,
        phonetic: phonetic ? cellToText(row.cells[phonetic.id]).trim() : "",
        meaning: meaning ? cellToText(row.cells[meaning.id]).trim() : "",
        status: progress.status,
        dueAt: progress.dueAt,
      })
      if (vocab.size >= MAX_TERMS) {
        return vocab
      }
    }
  }
  return vocab
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * 词表 → 一个正则。长的排前面（短语 take off 先于单词 take），
 * 词和词之间的空格允许是任意空白（网页排版常把一个空格换成换行），
 * 还允许常见的词尾变化：obtains、obtained、obtaining 都算 obtain。
 */
export function buildMatcher(vocab: Vocabulary): RegExp | null {
  if (vocab.size === 0) {
    return null
  }
  const alternatives = [...vocab.keys()]
    .sort((a, b) => b.length - a.length)
    .map((key) => escapeRegExp(key).replace(/ /g, "\\s+"))
  return new RegExp(`\\b(${alternatives.join("|")})(?:s|es|ed|d|ing)?\\b`, "gi")
}

export interface VocabMatch {
  start: number
  end: number
  /** 命中的是词表里哪个词（规范化后的 key） */
  key: string
}

export function findVocabMatches(text: string, matcher: RegExp): VocabMatch[] {
  const matches: VocabMatch[] = []
  matcher.lastIndex = 0
  for (let match = matcher.exec(text); match; match = matcher.exec(text)) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      key: normalizeNotebaseTerm(match[1]),
    })
  }
  return matches
}
