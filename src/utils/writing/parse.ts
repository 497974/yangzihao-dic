/**
 * 把模型返回的「错误清单」拆成一条条错题（写作纠错，功能路线图阶段四第 4 条）。
 *
 * 约定的格式是：原文片段 ||| 改成 ||| 类型 ||| 中文讲解，一行一条（见 prompt.ts）。
 * 但模型偶尔会自作主张加上序号、项目符号，或者少写一两段，所以这里拆得宽松一点：
 * 能认出「原文 → 改成」就算一条，剩下的缺了就留空，不要因为格式不完美就整条丢掉。
 */

import { FIELD_SEPARATOR } from "./prompt"

export interface WritingCorrection {
  /** 原文里错的片段 */
  original: string
  /** 改成什么 */
  corrected: string
  /** 错误类型：语法、时态、冠词…… */
  type: string
  /** 中文讲解 */
  explanation: string
}

/** 模型偶尔会带上的序号和项目符号 */
const LIST_PREFIX = /^\s*(?:[-*•]|\d+[.、)]|\(\d+\))\s*/

/** 没写类型时的兜底 */
export const DEFAULT_TYPE = "其他"

/**
 * 把模型按「一行一条、段与段之间用 ||| 隔开」写的清单拆成一行行的字段。
 * 去掉序号和项目符号、跳过没有分隔符的散文行和表头行。写作纠错的错误清单、
 * 对话练习的「值得记住的表达」都是这个格式。
 *
 * @param headerFirstCells 表头行第一格可能的写法（模型有时会先写一行表头）
 */
export function parseSeparatedLines(raw: string, headerFirstCells: RegExp): string[][] {
  const rows: string[][] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.replace(LIST_PREFIX, "").trim()
    if (!trimmed || !trimmed.includes(FIELD_SEPARATOR)) {
      continue
    }
    const parts = trimmed.split(FIELD_SEPARATOR).map((part) => part.trim())
    if (headerFirstCells.test(parts[0] ?? "")) {
      continue
    }
    rows.push(parts)
  }
  return rows
}

export function parseCorrections(raw: string): WritingCorrection[] {
  const corrections: WritingCorrection[] = []
  for (const [original, corrected, type, explanation] of parseSeparatedLines(
    raw,
    /^(?:原文|原句|错误)(?:片段)?$/,
  )) {
    if (!original || !corrected) {
      continue
    }
    corrections.push({
      original,
      corrected,
      type: type || DEFAULT_TYPE,
      explanation: explanation ?? "",
    })
  }
  return corrections
}

/** 比对重练的答案：忽略大小写、标点和多余空格——考的是改对了没有，不是抄得一模一样 */
export function isSameSentence(a: string, b: string): boolean {
  const normalize = (text: string) =>
    text
      .toLowerCase()
      .replace(/[.,!?;:'"()‘’“”]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  return normalize(a) === normalize(b)
}
