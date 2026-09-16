/**
 * 截图查词：把框选的区域（屏幕逻辑坐标）换算成截图里的像素区域。纯函数，方便测试。
 *
 * 截图的大小不一定正好是屏幕的物理分辨率（缩放 150% 的屏幕截出来是逻辑尺寸的 1.5 倍，
 * 多块屏幕时系统还可能按比例缩放），所以不假设比例，按截图实际大小换算。
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/** 框得太小（手一抖、只是点了一下）不算选区 */
export const MIN_SELECTION_DIP = 4

/**
 * 选区 → 截图里的像素区域：往外取整（宁可多框半个像素，不把字切掉），超出截图的部分裁掉。
 * 小到不像是在框字就返回 null。
 */
export function toImageRect(region: Rect, displaySize: Size, imageSize: Size): Rect | null {
  if (
    region.width < MIN_SELECTION_DIP ||
    region.height < MIN_SELECTION_DIP ||
    displaySize.width <= 0 ||
    displaySize.height <= 0
  ) {
    return null
  }
  const scaleX = imageSize.width / displaySize.width
  const scaleY = imageSize.height / displaySize.height
  const left = Math.max(0, Math.floor(region.x * scaleX))
  const top = Math.max(0, Math.floor(region.y * scaleY))
  const right = Math.min(imageSize.width, Math.ceil((region.x + region.width) * scaleX))
  const bottom = Math.min(imageSize.height, Math.ceil((region.y + region.height) * scaleY))
  if (right - left < 2 || bottom - top < 2) {
    return null
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function isRect(value: unknown): value is Rect {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const rect = value as Record<string, unknown>
  return ["x", "y", "width", "height"].every(
    (key) => typeof rect[key] === "number" && Number.isFinite(rect[key]),
  )
}
