import { describe, expect, it } from "vitest"
import { VK_SPACE_CODE } from "../key-codes"
import { createTripleSpaceDetector } from "../triple-space"

const VK_A = 0x41

/** 按一下再松开；返回按下那一刻是否触发 */
function tap(detector: ReturnType<typeof createTripleSpaceDetector>, vk: number, time: number) {
  const fired = detector.handle({ vk, down: true, time })
  detector.handle({ vk, down: false, time: time + 40 })
  return fired
}

describe("数三下空格", () => {
  it("300 毫秒内连按三下：第三下触发", () => {
    const d = createTripleSpaceDetector()
    expect(tap(d, VK_SPACE_CODE, 0)).toBe(false)
    expect(tap(d, VK_SPACE_CODE, 200)).toBe(false)
    expect(tap(d, VK_SPACE_CODE, 400)).toBe(true)
  })

  it("中间停顿太久就重新数", () => {
    const d = createTripleSpaceDetector()
    tap(d, VK_SPACE_CODE, 0)
    tap(d, VK_SPACE_CODE, 200)
    expect(tap(d, VK_SPACE_CODE, 900)).toBe(false)
    expect(tap(d, VK_SPACE_CODE, 1000)).toBe(false)
    expect(tap(d, VK_SPACE_CODE, 1100)).toBe(true)
  })

  it("中间按了别的键就重新数（正常打字 a b c 不会触发）", () => {
    const d = createTripleSpaceDetector()
    tap(d, VK_SPACE_CODE, 0)
    tap(d, VK_A, 100)
    tap(d, VK_SPACE_CODE, 200)
    expect(tap(d, VK_SPACE_CODE, 300)).toBe(false)
  })

  it("别的键松开得晚一点不影响（打字快时字母键常在空格按下后才松开）", () => {
    const d = createTripleSpaceDetector()
    d.handle({ vk: VK_A, down: true, time: 0 })
    d.handle({ vk: VK_SPACE_CODE, down: true, time: 50 })
    d.handle({ vk: VK_A, down: false, time: 60 })
    d.handle({ vk: VK_SPACE_CODE, down: false, time: 90 })
    tap(d, VK_SPACE_CODE, 200)
    expect(tap(d, VK_SPACE_CODE, 350)).toBe(true)
  })

  it("按住空格不放（自动连发）不算", () => {
    const d = createTripleSpaceDetector()
    const fired = [0, 30, 60, 90, 120, 150].map((time) =>
      d.handle({ vk: VK_SPACE_CODE, down: true, time }),
    )
    expect(fired).not.toContain(true)
  })

  it("触发之后要重新按满三下才会再触发", () => {
    const d = createTripleSpaceDetector()
    tap(d, VK_SPACE_CODE, 0)
    tap(d, VK_SPACE_CODE, 100)
    expect(tap(d, VK_SPACE_CODE, 200)).toBe(true)
    expect(tap(d, VK_SPACE_CODE, 300)).toBe(false)
    expect(tap(d, VK_SPACE_CODE, 400)).toBe(false)
    expect(tap(d, VK_SPACE_CODE, 500)).toBe(true)
  })
})
