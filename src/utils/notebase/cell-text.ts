/**
 * 笔记库单元格取文本。
 *
 * 行数据里的 cells 是 Record<string, unknown> —— 契约允许列值是数字、布尔、
 * 甚至对象。直接 String(value) 碰上对象会变成 "[object Object]" 显示给用户，
 * 所以这里只认能安全转成文本的类型，其余一律当空。
 */
export function cellToText(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }
  return ""
}
