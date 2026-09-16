/**
 * 字幕听写的逐词比对（阶段五实现方案 · 步骤 3）。纯函数，方便测试。
 *
 * 用最长公共子序列（LCS）做逐词对齐，而不是按位置一一比较：
 * 漏听一个词时，后面的词整体错位，按位置比会把后面全判成错，LCS 能正确对上。
 *
 * 比较时忽略大小写和标点，撇号也去掉（don't 与 dont 算一致）——
 * 听写考的是听没听出来这个词，不是会不会打标点。
 */

export type DiffOp =
  /** 听对了 */
  | { type: "match"; word: string }
  /** 漏听（或听错）的词，显示原文里的正确写法 */
  | { type: "missing"; word: string }
  /** 多写的、写错的词，显示用户写的 */
  | { type: "extra"; word: string }

export interface DictationResult {
  ops: DiffOp[]
  /** 原句里听对的词占多少（0~1） */
  accuracy: number
  /** 原句一共几个词 */
  total: number
  /** 听对了几个 */
  matched: number
}

const WORD_PATTERN = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g

/** 一句话 → 词（保留原样，显示用） */
export function splitWords(text: string): string[] {
  return text.match(WORD_PATTERN) ?? []
}

/** 比较用的写法：小写、去撇号和连字符 */
export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/['’-]/g, "")
}

export function diffWords(expected: string, typed: string): DictationResult {
  const target = splitWords(expected)
  const input = splitWords(typed)
  const a = target.map(normalizeWord)
  const b = input.map(normalizeWord)

  // lcs[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: "match", word: target[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ type: "missing", word: target[i]! })
      i++
    } else {
      ops.push({ type: "extra", word: input[j]! })
      j++
    }
  }
  for (; i < a.length; i++) ops.push({ type: "missing", word: target[i]! })
  for (; j < b.length; j++) ops.push({ type: "extra", word: input[j]! })

  const matched = ops.filter((op) => op.type === "match").length
  return {
    ops,
    matched,
    total: target.length,
    accuracy: target.length === 0 ? 0 : matched / target.length,
  }
}

/** 没作答之前遮住原文：每个词显示成同样长度的下划线，只透露词数和长短 */
export function maskSentence(text: string): string {
  return splitWords(text)
    .map((word) => "_".repeat(Math.min(word.length, 12)))
    .join(" ")
}

export interface DictationStats {
  lines: number
  accuracySum: number
}

export function addToStats(stats: DictationStats, result: DictationResult): DictationStats {
  return { lines: stats.lines + 1, accuracySum: stats.accuracySum + result.accuracy }
}

export function averageAccuracy(stats: DictationStats): number {
  return stats.lines === 0 ? 0 : stats.accuracySum / stats.lines
}
