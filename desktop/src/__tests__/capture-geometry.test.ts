import { describe, expect, it } from "vitest"
import { isRect, toImageRect } from "../capture-geometry"

describe("框选区域 → 截图里的像素", () => {
  it("缩放 100%：原样", () => {
    expect(
      toImageRect(
        { x: 10, y: 20, width: 100, height: 30 },
        { width: 1920, height: 1080 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ x: 10, y: 20, width: 100, height: 30 })
  })

  it("缩放 150%：按截图实际大小放大，往外取整不把字切掉", () => {
    expect(
      toImageRect(
        { x: 10.5, y: 20, width: 100.2, height: 30 },
        { width: 1280, height: 720 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ x: 15, y: 30, width: 152, height: 45 })
  })

  it("超出屏幕的部分裁掉", () => {
    expect(
      toImageRect(
        { x: 1900, y: 1070, width: 100, height: 100 },
        { width: 1920, height: 1080 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ x: 1900, y: 1070, width: 20, height: 10 })
  })

  it("框得太小不算", () => {
    expect(
      toImageRect(
        { x: 5, y: 5, width: 3, height: 40 },
        { width: 100, height: 100 },
        { width: 100, height: 100 },
      ),
    ).toBeNull()
  })
})

describe("页面传回来的选区要像个矩形", () => {
  it("四个有限的数字才算", () => {
    expect(isRect({ x: 1, y: 2, width: 3, height: 4 })).toBe(true)
    expect(isRect({ x: 1, y: 2, width: 3 })).toBe(false)
    expect(isRect({ x: 1, y: 2, width: Number.NaN, height: 4 })).toBe(false)
    expect(isRect("1,2,3,4")).toBe(false)
  })
})
