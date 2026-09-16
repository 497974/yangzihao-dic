/**
 * 看鼠标动作猜"用户是不是刚选中了一段文字"：
 * - 按住左键拖了一段距离再松开（拖选）
 * - 双击、三击（选中一个词、一段）
 *
 * 猜对了就在旁边弹出划词工具栏。只是弹工具栏，不复制、不查词——
 * 真正去取文字（模拟 Ctrl+C）要等用户点了工具栏上的按钮。所以拖窗口、拖滚动条
 * 这类误判的代价只是多出一个会自己消失的小工具栏，不会乱查词、乱花钱。
 *
 * 纯逻辑，鼠标事件从鼠标钩子喂进来（mouse-hook.ts）。坐标是屏幕物理像素。
 */

export interface MouseButtonEvent {
  type: "down" | "up"
  x: number
  y: number
  /** 毫秒 */
  time: number
}

export interface SelectionGesture {
  kind: "drag" | "multi-click"
  /** 连着点了几下：2 = 双击（选中一个词），3 = 三击（选中一段）；拖选是 0 */
  clicks: number
  /** 松开鼠标的位置，工具栏放在这附近 */
  x: number
  y: number
}

/** 拖多远算"拖选"（物理像素；高分屏上 12 像素也就一个字的宽度） */
export const DRAG_THRESHOLD_PX = 12
/** 两次点击间隔多久以内、离多近算双击 */
export const MULTI_CLICK_MS = 500
export const MULTI_CLICK_DISTANCE_PX = 8

export function createSelectionGestureDetector(
  options: { dragThreshold?: number; multiClickMs?: number; multiClickDistance?: number } = {},
) {
  const dragThreshold = options.dragThreshold ?? DRAG_THRESHOLD_PX
  const multiClickMs = options.multiClickMs ?? MULTI_CLICK_MS
  const multiClickDistance = options.multiClickDistance ?? MULTI_CLICK_DISTANCE_PX

  let down: MouseButtonEvent | null = null
  let lastClick: MouseButtonEvent | null = null
  let clickCount = 0

  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y)

  return {
    /** 喂一个左键事件；返回非 null 表示刚完成一次"选中文字"的动作 */
    handle(event: MouseButtonEvent): SelectionGesture | null {
      if (event.type === "down") {
        const continuesClicks =
          lastClick !== null &&
          event.time - lastClick.time <= multiClickMs &&
          distance(event, lastClick) <= multiClickDistance
        clickCount = continuesClicks ? clickCount + 1 : 1
        down = event
        return null
      }

      if (!down) {
        return null
      }
      const start = down
      down = null

      if (distance(start, event) >= dragThreshold) {
        lastClick = null
        clickCount = 0
        return { kind: "drag", clicks: 0, x: event.x, y: event.y }
      }

      lastClick = event
      return clickCount >= 2
        ? { kind: "multi-click", clicks: clickCount, x: event.x, y: event.y }
        : null
    },
    reset() {
      down = null
      lastClick = null
      clickCount = 0
    },
  }
}

export type SelectionGestureDetector = ReturnType<typeof createSelectionGestureDetector>
