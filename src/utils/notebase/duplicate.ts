/**
 * 生词本存词去重：同一个词已经存过，就不再加一行。
 * 一个词在生词本里出现两遍，闪卡也会重复出两张，复习统计也跟着乱。
 *
 * 只看主列（第一列，内置词典就是「词条」）：释义、例句每次查都可能写得不一样，
 * 但词条相同就是同一个词。比较时去掉首尾空白、忽略大小写、连续空白算一个。
 */

import { cellToText } from "./cell-text"

export function normalizeNotebaseTerm(value: unknown): string {
  return cellToText(value).trim().replace(/\s+/g, " ").toLowerCase()
}

interface ColumnLike {
  id: string
  isPrimary?: boolean
  position?: number
}

interface RowLike {
  cells?: Record<string, unknown> | null
}

/** 找生词本里和要存的这一行是同一个词的行；主列没内容就不判重，返回 null 照常存 */
export function findDuplicateNotebaseRow<Row extends RowLike>(
  columns: readonly ColumnLike[],
  rows: readonly Row[],
  cells: Record<string, unknown> | null | undefined,
): Row | null {
  const primary =
    columns.find((column) => column.isPrimary) ??
    [...columns].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]
  if (!primary) {
    return null
  }
  const term = normalizeNotebaseTerm(cells?.[primary.id])
  if (!term) {
    return null
  }
  return rows.find((row) => normalizeNotebaseTerm(row.cells?.[primary.id]) === term) ?? null
}
