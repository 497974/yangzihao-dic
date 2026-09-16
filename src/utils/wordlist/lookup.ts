/**
 * 离线词表的查询（运行在后台，内容脚本通过消息来问，见 background/wordlist.ts）。
 *
 * 一个网页上的词大多是变形：obtained、studies、stopped……
 * 先查 ECDICT 自带的变形表，查不到再用常见后缀规则猜原形——
 * 但猜出来的原形必须在词表里真实存在才算，免得把 bus 当成 bu 的复数。
 */

import type { WordlistEntry, WordlistFile } from "./ecdict"

export interface WordInfo {
  /** 原形 */
  lemma: string
  /** 难度档，1 = 中考 … 7 = GRE */
  level: number
  phonetic: string
  gloss: string
}

/** 常见后缀 → 可能的原形写法，按顺序尝试 */
const SUFFIX_RULES: Array<[suffix: string, replacements: string[]]> = [
  ["ies", ["y"]],
  ["ied", ["y"]],
  ["ying", ["ie"]],
  ["ves", ["f", "fe"]],
  ["ing", ["", "e"]],
  ["ed", ["", "e"]],
  ["es", ["", "e"]],
  ["er", ["", "e"]],
  ["est", ["", "e"]],
  ["ly", [""]],
  ["s", [""]],
]

/** 把网页上的一个词规整成查询用的样子：小写、去掉首尾标点和所有格 */
export function normalizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^[^a-z]+|[^a-z]+$/g, "")
    .replace(/'s$/, "")
}

export class Wordlist {
  private readonly entries = new Map<string, WordlistEntry>()
  private readonly forms: Record<string, string>

  constructor(file: WordlistFile) {
    for (const entry of file.words) {
      this.entries.set(entry[0], entry)
    }
    this.forms = file.forms
  }

  get size(): number {
    return this.entries.size
  }

  /** 查一个词；词表里没有（包括太简单、没进任何考试词表的词）返回 null */
  lookup(raw: string): WordInfo | null {
    const token = normalizeToken(raw)
    if (!token) {
      return null
    }
    const entry = this.entries.get(token) ?? this.fromForms(token) ?? this.fromSuffixRules(token)
    return entry ? { lemma: entry[0], level: entry[1], phonetic: entry[2], gloss: entry[3] } : null
  }

  private fromForms(token: string): WordlistEntry | undefined {
    const lemma = this.forms[token]
    return lemma ? this.entries.get(lemma) : undefined
  }

  private fromSuffixRules(token: string): WordlistEntry | undefined {
    for (const [suffix, replacements] of SUFFIX_RULES) {
      if (!token.endsWith(suffix) || token.length - suffix.length < 2) {
        continue
      }
      const stem = token.slice(0, -suffix.length)
      for (const replacement of replacements) {
        const hit = this.entries.get(stem + replacement)
        if (hit) {
          return hit
        }
      }
      // 双写辅音：stopped → stop、running → run
      if (/([b-df-hj-np-tv-z])\1$/.test(stem)) {
        const hit = this.entries.get(stem.slice(0, -1))
        if (hit) {
          return hit
        }
      }
    }
    return undefined
  }
}
