import type { SelectionCaptureDeps } from "../selection-capture"
import { describe, expect, it } from "vitest"
import { captureSelection, COPY_WAIT_MS, MODIFIER_WAIT_MS } from "../selection-capture"

interface Clip {
  text: string
}

interface FakeOptions {
  /** 用户多久之后才松开 Alt（毫秒）；不传 = 一开始就松开了 */
  modifierHeldFor?: number
  /** 用户一直按着 Alt 不放 */
  modifierStuck?: boolean
  /** 按下 Ctrl+C 之后多久剪贴板才变；null = 什么都没选中，剪贴板不会变 */
  copyDelay?: number | null
  copiedText?: string
  /** 剪贴板先变成空的，再过这么久才有文字（有的程序分几次写） */
  textDelay?: number
}

function createFake(options: FakeOptions = {}) {
  let clock = 0
  let sequence = 100
  let clipboard: Clip = { text: "用户原来复制的内容" }
  let released = false
  let copyAt: number | null = null
  let stage = 0
  const calls: string[] = []

  /** 按虚拟时钟推进"那个程序往剪贴板里写东西"的过程 */
  const tick = () => {
    if (copyAt === null || options.copyDelay === null) {
      return
    }
    const changeAt = copyAt + (options.copyDelay ?? 30)
    if (stage === 0 && clock >= changeAt) {
      stage = 1
      sequence += 1
      clipboard = { text: options.textDelay ? "" : (options.copiedText ?? "obtain") }
    }
    if (stage === 1 && options.textDelay && clock >= changeAt + options.textDelay) {
      stage = 2
      sequence += 1
      clipboard = { text: options.copiedText ?? "obtain" }
    }
  }

  const deps: SelectionCaptureDeps<Clip> = {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    },
    isModifierHeld: () =>
      options.modifierStuck ? !released : clock < (options.modifierHeldFor ?? 0),
    releaseModifiers: () => {
      calls.push(`release@${clock}`)
      released = true
    },
    snapshotClipboard: async () => ({ ...clipboard }),
    restoreClipboard: async (snapshot) => {
      calls.push("restore")
      clipboard = { ...snapshot }
    },
    clipboardSequence: () => {
      tick()
      return sequence
    },
    readClipboardText: async () => {
      tick()
      return clipboard.text
    },
    sendCopy: () => {
      calls.push(`copy@${clock}`)
      copyAt = clock
    },
  }
  return { deps, calls, clipboard: () => clipboard }
}

describe("取词", () => {
  it("拿到选中的文字，并把原来的剪贴板放回去", async () => {
    const fake = createFake({ copiedText: "  obtain \r\n" })
    await expect(captureSelection(fake.deps)).resolves.toMatchObject({ ok: true, text: "obtain" })
    expect(fake.calls).toEqual(["copy@0", "restore"])
    expect(fake.clipboard()).toEqual({ text: "用户原来复制的内容" })
  })

  it("多行文字的换行统一成 \\n", async () => {
    const fake = createFake({ copiedText: "line one\r\nline two" })
    await expect(captureSelection(fake.deps)).resolves.toMatchObject({
      ok: true,
      text: "line one\nline two",
    })
  })

  it("等用户松开 Alt 再复制，否则程序收到的是 Ctrl+Alt+C", async () => {
    const fake = createFake({ modifierHeldFor: 120 })
    await captureSelection(fake.deps)
    const copyTime = Number(fake.calls[0].split("@")[1])
    expect(copyTime).toBeGreaterThanOrEqual(120)
    expect(fake.calls.some((c) => c.startsWith("release"))).toBe(false)
  })

  it("用户一直按着不放，等到上限后替他松开，再复制", async () => {
    const fake = createFake({ modifierStuck: true })
    await expect(captureSelection(fake.deps)).resolves.toMatchObject({ ok: true })
    expect(fake.calls[0]).toBe(`release@${MODIFIER_WAIT_MS}`)
    expect(fake.calls[1]).toBe(`copy@${MODIFIER_WAIT_MS}`)
  })

  it("什么都没选中（剪贴板没变）：不拿旧内容去查，也不动剪贴板", async () => {
    const fake = createFake({ copyDelay: null })
    await expect(captureSelection(fake.deps)).resolves.toMatchObject({
      ok: false,
      reason: "no_selection",
    })
    expect(fake.calls).toEqual(["copy@0"])
    expect(fake.clipboard()).toEqual({ text: "用户原来复制的内容" })
  })

  it("程序复制得慢一点也能等到", async () => {
    const fake = createFake({ copyDelay: COPY_WAIT_MS - 100, copiedText: "slow" })
    await expect(captureSelection(fake.deps)).resolves.toMatchObject({ ok: true, text: "slow" })
  })

  it("文字比别的格式晚到，也能拿到", async () => {
    const fake = createFake({ textDelay: 100, copiedText: "late" })
    await expect(captureSelection(fake.deps)).resolves.toMatchObject({ ok: true, text: "late" })
    expect(fake.clipboard()).toEqual({ text: "用户原来复制的内容" })
  })

  it("复制出来只有空白（比如选中的是图片）：算没选中，但剪贴板照样放回去", async () => {
    const fake = createFake({ copiedText: "   " })
    await expect(captureSelection(fake.deps)).resolves.toMatchObject({
      ok: false,
      reason: "no_selection",
    })
    expect(fake.calls).toContain("restore")
    expect(fake.clipboard()).toEqual({ text: "用户原来复制的内容" })
  })
})
