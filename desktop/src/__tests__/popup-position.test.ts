import { describe, expect, it } from "vitest"
import { CURSOR_OFFSET, placePopup } from "../popup-position"

const SCREEN = { x: 0, y: 0, width: 1920, height: 1040 } // 1080 减去任务栏
const SIZE = { width: 380, height: 300 }

describe("弹窗位置", () => {
  it("默认放在鼠标右下方", () => {
    expect(placePopup({ x: 500, y: 400 }, SIZE, SCREEN)).toEqual({
      x: 500 + CURSOR_OFFSET.x,
      y: 400 + CURSOR_OFFSET.y,
      width: 380,
      height: 300,
    })
  })

  it("靠近右边缘时挪到鼠标左边", () => {
    const rect = placePopup({ x: 1800, y: 400 }, SIZE, SCREEN)
    expect(rect.x + rect.width).toBeLessThanOrEqual(1800)
  })

  it("靠近底部时挪到鼠标上方，不压任务栏", () => {
    const rect = placePopup({ x: 500, y: 1000 }, SIZE, SCREEN)
    expect(rect.y + rect.height).toBeLessThanOrEqual(1000)
  })

  it("副屏在主屏左边（坐标是负数）也放得对", () => {
    const leftScreen = { x: -1920, y: 0, width: 1920, height: 1040 }
    const rect = placePopup({ x: -100, y: 100 }, SIZE, leftScreen)
    expect(rect.x).toBeGreaterThanOrEqual(-1920)
    expect(rect.x + rect.width).toBeLessThanOrEqual(0)
  })

  it("比屏幕还高时压到屏幕高度", () => {
    const small = { x: 0, y: 0, width: 800, height: 200 }
    const rect = placePopup({ x: 100, y: 100 }, SIZE, small)
    expect(rect.height).toBe(200)
    expect(rect.y).toBe(0)
  })
})
