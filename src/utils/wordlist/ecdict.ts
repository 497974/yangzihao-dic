/**
 * 把 ECDICT（https://github.com/skywind3000/ECDICT，MIT 授权）的原始词条
 * 精简成扩展里用的离线词表。只给 scripts/build-wordlist.ts 用，扩展运行时不加载这个文件。
 *
 * 纯函数、不引用路径别名：生成脚本用 node 直接跑（类型剥离），不经过 vite 的别名解析。
 */

/** 难度档：数字越大越难。取一个词出现过的最低档（中考就学过的词，GRE 词表里有也算中考词） */
export const LEVELS = ["中考", "高考", "四级", "六级", "考研", "雅思托福", "GRE"] as const
export type LevelName = (typeof LEVELS)[number]

/** ECDICT 的 tag 字段里各考试的代号 → 难度档（1 起算） */
const TAG_LEVEL: Record<string, number> = {
  zk: 1,
  gk: 2,
  cet4: 3,
  cet6: 4,
  ky: 5,
  ielts: 6,
  toefl: 6,
  gre: 7,
}

/** tag 字段（空格分隔，如 "cet4 cet6 ky toefl"）→ 最低难度档；没有考试标签返回 null */
export function levelFromTags(tags: string): number | null {
  let level: number | null = null
  for (const tag of tags.split(/\s+/)) {
    const value = TAG_LEVEL[tag]
    if (value !== undefined && (level === null || value < level)) {
      level = value
    }
  }
  return level
}

/** 只收纯英文单词和短语（abandon、give up、well-known）；前后缀、缩写、专名的奇怪写法不要 */
export function isPlainEntry(word: string): boolean {
  return /^[a-z]+(?:[ '-][a-z]+)*$/.test(word)
}

/** 释义最长多少个字：行内提示只有词上方那一点位置 */
export const MAX_GLOSS_LENGTH = 16

/**
 * 从 translation 字段挑出一条简短释义。
 *
 * 原始写法形如 `vt. 放弃, 抛弃, 遗弃\nn. 放任\n[网络] 放弃`（换行在文件里是字面的 \n）。
 * 取第一条正经义项，去掉词性前缀和「[网络]」「[计]」这类来源标注；
 * 义项之间 ECDICT 多数用英文逗号，少数用分号，统一切开后用中文分号重新拼，
 * 尽量多装几个近义说法，但不超过长度上限，也不把一个说法截成半截。
 */
export function pickGloss(translation: string): string {
  const lines = translation
    .split(/\\n|\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("[网络]"))
  const first = lines[0]
  if (!first) {
    return ""
  }
  const body = first
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/^(?:[a-z]+\.\s*)+/i, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .trim()

  let gloss = ""
  for (const part of body
    .split(/[；;,，]/)
    .map((item) => item.trim())
    .filter(Boolean)) {
    const next = gloss ? `${gloss}；${part}` : part
    if (next.length > MAX_GLOSS_LENGTH) {
      break
    }
    gloss = next
  }
  // 第一个义项本身就超长：硬截断，也比没有释义强
  return gloss || body.slice(0, MAX_GLOSS_LENGTH)
}

/**
 * exchange 字段 → 这个词的各种变形。
 * 形如 `p:abandoned/d:abandoned/i:abandoning/3:abandons`；
 * `0:` 是原形（出现在变形词自己的词条上）、`1:` 是变形类型说明，都不是变形，跳过。
 */
export function exchangeForms(exchange: string): string[] {
  const forms: string[] = []
  for (const item of exchange.split("/")) {
    const [kind, value] = item.split(":")
    if (!kind || !value || kind === "0" || kind === "1") {
      continue
    }
    const form = value.trim().toLowerCase()
    if (isPlainEntry(form) && !forms.includes(form)) {
      forms.push(form)
    }
  }
  return forms
}

/** 变形词条自己的 exchange 里用 `0:原形` 指回原形（如 countries 的 `0:country/1:s`）；没有返回 null */
export function lemmaOf(exchange: string): string | null {
  for (const item of exchange.split("/")) {
    const [kind, value] = item.split(":")
    if (kind === "0" && value) {
      const lemma = value.trim().toLowerCase()
      return isPlainEntry(lemma) ? lemma : null
    }
  }
  return null
}

/**
 * 变形词条的难度档不能比原形高。
 *
 * ECDICT 的雅思/托福词表把 countries、problems、cheaper 这类变形单独收成了词条，
 * 只挂着 ielts 标签——按标签算就成了「雅思托福」难度，而原形 country 是中考词。
 * 这里把变形的档位压到不高于原形；词条本身和释义保留，
 * 因为有些变形意思不一样（remains 是「剩余物；废墟」，不是 remain「保持」）。
 *
 * @param links 变形 → 原形
 * @returns 调整了几个词条
 */
export function harmonizeInflectionLevels(
  entries: Map<string, WordlistEntry>,
  links: Iterable<readonly [form: string, lemma: string]>,
): number {
  let adjusted = 0
  for (const [form, lemma] of links) {
    const formEntry = entries.get(form)
    const lemmaEntry = entries.get(lemma)
    if (formEntry && lemmaEntry && lemmaEntry[1] < formEntry[1]) {
      formEntry[1] = lemmaEntry[1]
      adjusted += 1
    }
  }
  return adjusted
}

/**
 * 解析一行 CSV：支持引号包裹、引号里的逗号、两个引号表示一个引号。
 * ECDICT 的释义里满是逗号，按逗号硬切会错位。
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ",") {
      fields.push(field)
      field = ""
    } else {
      field += char
    }
  }
  fields.push(field)
  return fields
}

/** 词表里的一条：[词, 难度档, 音标, 简短释义]。用数组而不是对象，几万条能省下不少体积 */
/**
 * 词表里的一条：[词, 难度档, 音标, 简短释义, 词频排名]。用数组而不是对象，几万条能省下不少体积。
 * 词频排名越小越常用，0 表示语料里没有；中文网页混入英文词时，同一个中文词有好几个英文说法，
 * 按它挑最常用的那个（旧版词表没有这一项，所以是可选的）。
 */
export type WordlistEntry = [
  word: string,
  level: number,
  phonetic: string,
  gloss: string,
  rank?: number,
]

export interface WordlistFile {
  version: 1
  source: string
  levels: readonly string[]
  words: WordlistEntry[]
  /** 变形 → 原形（abandoned → abandon） */
  forms: Record<string, string>
}

export interface EcdictRow {
  word: string
  phonetic: string
  translation: string
  tag: string
  exchange: string
  /** 当代语料库词频排名（越小越常用，0 = 没有） */
  frq?: string
  /** 英国国家语料库词频排名，frq 没有时用它 */
  bnc?: string
}

/** 词频排名：优先当代语料库，其次英国国家语料库；都没有返回 0 */
export function rankOf(row: Pick<EcdictRow, "frq" | "bnc">): number {
  const frq = Number(row.frq)
  if (Number.isFinite(frq) && frq > 0) {
    return frq
  }
  const bnc = Number(row.bnc)
  return Number.isFinite(bnc) && bnc > 0 ? bnc : 0
}

/** CSV 表头 → 各列位置 */
export function columnIndex(header: string[]): Record<keyof EcdictRow, number> {
  const find = (name: string) => {
    const index = header.indexOf(name)
    if (index === -1) {
      throw new Error(`ECDICT 表头里没有「${name}」列，数据格式可能变了`)
    }
    return index
  }
  return {
    word: find("word"),
    phonetic: find("phonetic"),
    translation: find("translation"),
    tag: find("tag"),
    exchange: find("exchange"),
    frq: find("frq"),
    bnc: find("bnc"),
  }
}

/** 一条原始词条 → 词表条目；不该收的返回 null */
export function toWordlistEntry(row: EcdictRow): WordlistEntry | null {
  const word = row.word.trim().toLowerCase()
  const level = levelFromTags(row.tag)
  if (level === null || !isPlainEntry(word)) {
    return null
  }
  const gloss = pickGloss(row.translation)
  if (!gloss) {
    return null
  }
  // ECDICT 音标里的 schwa 是西里尔字母 ә（U+04D9），不是国际音标 ə（U+0259）：
  // 长得一样，但换个字体就显示得很怪
  return [word, level, row.phonetic.trim().replaceAll("ә", "ə"), gloss, rankOf(row)]
}
