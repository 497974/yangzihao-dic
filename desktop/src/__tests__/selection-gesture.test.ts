import { describe, expect, it } from "vitest"
import { createSelectionGestureDetector } from "../selection-gesture"

type Detector = ReturnType<typeof createSelectionGestureDetector>

function click(d: Detector, x: number, y: number, time: number) {
  d.handle({ type: "down", x, y, time })
  return d.handle({ type: "up", x, y, time: time + 60 })
}

describe("猜用户是不是刚选中了文字", () => {
  it("按住拖一段再松开：拖选，工具栏放在松开的地方", () => {
    const d = createSelectionGestureDetector()
    d.handle({ type: "down", x: 100, y: 100, time: 0 })
    expect(d.handle({ type: "up", x: 260, y: 104, time: 400 })).toEqual({
      kind: "drag",
      clicks: 0,
      x: 260,
      y: 104,
    })
  })

  it("只是点一下（没怎么动）：不算", () => {
    const d = createSelectionGestureDetector()
    expect(click(d, 100, 100, 0)).toBeNull()
  })

  it("抖了几个像素的单击：不算拖选", () => {
    const d = createSelectionGestureDetector()
    d.handle({ type: "down", x: 100, y: 100, time: 0 })
    expect(d.handle({ type: "up", x: 104, y: 103, time: 80 })).toBeNull()
  })

  it("双击选中一个词：第二下松开时算", () => {
    const d = createSelectionGestureDetector()
    expect(click(d, 100, 100, 0)).toBeNull()
    expect(click(d, 101, 100, 200)).toEqual({ kind: "multi-click", clicks: 2, x: 101, y: 100 })
  })

  it("三击选中一段：第三下也算，并且记着是三击（双击查词只认双击）", () => {
    const d = createSelectionGestureDetector()
    click(d, 100, 100, 0)
    click(d, 100, 100, 200)
    expect(click(d, 100, 100, 400)).toMatchObject({ kind: "multi-click", clicks: 3 })
  })

  it("两下点得太慢或离得太远：不是双击", () => {
    const slow = createSelectionGestureDetector()
    click(slow, 100, 100, 0)
    expect(click(slow, 100, 100, 900)).toBeNull()

    const far = createSelectionGestureDetector()
    click(far, 100, 100, 0)
    expect(click(far, 300, 100, 200)).toBeNull()
  })

  it("只看到松开、没看到按下（钩子刚装上）：不算", () => {
    const d = createSelectionGestureDetector()
    expect(d.handle({ type: "up", x: 500, y: 500, time: 0 })).toBeNull()
  })
})
