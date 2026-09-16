/**
 * 弹窗放在哪：默认在鼠标右下方；右边放不下就挪到鼠标左边，下面放不下就挪到鼠标上面，
 * 最后再整体限制在屏幕的可用区域里（不压任务栏）。多显示器时坐标可能是负数，照样适用。
 */

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect extends Point, Size {}

export const CURSOR_OFFSET: Point = { x: 12, y: 18 }

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

export function placePopup(cursor: Point, size: Size, workArea: Rect): Rect {
  const width = Math.min(size.width, workArea.width)
  const height = Math.min(size.height, workArea.height)
  const right = workArea.x + workArea.width
  const bottom = workArea.y + workArea.height

  let x = cursor.x + CURSOR_OFFSET.x
  if (x + width > right) {
    x = cursor.x - CURSOR_OFFSET.x - width
  }
  let y = cursor.y + CURSOR_OFFSET.y
  if (y + height > bottom) {
    y = cursor.y - CURSOR_OFFSET.y - height
  }

  return {
    x: Math.round(clamp(x, workArea.x, right - width)),
    y: Math.round(clamp(y, workArea.y, bottom - height)),
    width: Math.round(width),
    height: Math.round(height),
  }
}
