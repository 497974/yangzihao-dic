import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createAppSupportTracker,
  createSelectionContextReader,
  isReadable,
  MAX_CONTEXT_LENGTH,
  pickContext,
} from "../selection-context"

describe("挑上下文", () => {
  it("这一段里有选中的字，就把整段交给词典", () => {
    expect(pickContext("You must obtain a permit first.\r\n", "obtain")).toBe(
      "You must obtain a permit first.",
    )
  })

  it("焦点换了、读到的段落里没有选中的字，就不用", () => {
    expect(pickContext("Something else entirely.", "obtain")).toBeUndefined()
  })

  it("读不到、或者和选中的字一模一样，就不带上下文", () => {
    expect(pickContext(null, "obtain")).toBeUndefined()
    expect(pickContext(" obtain ", "obtain")).toBeUndefined()
  })

  it("太长只留选中处前后，而且不超过上限", () => {
    const paragraph = `${"a".repeat(3000)} obtain ${"b".repeat(3000)}`

    const context = pickContext(paragraph, "obtain")!

    expect(context.length).toBeLessThanOrEqual(MAX_CONTEXT_LENGTH)
    expect(context).toContain(" obtain ")
  })

  it("截的时候落在句子边界上，不留半句话", () => {
    const filler = "This sentence is only here to make the paragraph long. "
    const paragraph = `${filler.repeat(40)}You must obtain a permit first. ${filler.repeat(40)}`

    const context = pickContext(paragraph, "obtain")!

    expect(context).toContain("You must obtain a permit first.")
    expect(context.startsWith("This sentence")).toBe(true)
    expect(context.endsWith("long.")).toBe(true)
    expect(context.length).toBeLessThanOrEqual(MAX_CONTEXT_LENGTH)
  })

  it("中文句号也算句子边界", () => {
    const filler = "这句话只是用来把段落凑长的。"
    const paragraph = `${filler.repeat(80)}你必须先取得许可证obtain才行。${filler.repeat(80)}`

    const context = pickContext(paragraph, "obtain")!

    expect(context.startsWith("这句话")).toBe(true)
    expect(context.endsWith("。")).toBe(true)
  })
})

describe("记住读不到的程序", () => {
  it("连着三次读不到就不再问；读到过一次就清零；不分大小写", () => {
    const tracker = createAppSupportTracker(3)
    tracker.record("QQ.exe", false)
    tracker.record("qq.exe", false)
    expect(tracker.worthTrying("QQ.exe")).toBe(true)

    tracker.record("QQ.EXE", false)
    expect(tracker.worthTrying("qq.exe")).toBe(false)

    tracker.record("notepad.exe", false)
    tracker.record("notepad.exe", true)
    expect(tracker.worthTrying("notepad.exe")).toBe(true)
  })

  it("没选中东西也算这个程序支持；没有文字接口、超时才算不支持", () => {
    expect(isReadable({ selection: null, paragraph: null, error: "no_selection" })).toBe(true)
    expect(isReadable({ selection: "a", paragraph: "a b", error: null })).toBe(true)
    expect(isReadable({ selection: null, paragraph: null, error: "no_text_pattern" })).toBe(false)
    expect(isReadable(null)).toBe(false)
  })
})

describe("读文字的小进程", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  /** 用 node 跑一个假的小进程，协议和 selection-context.ps1 一样 */
  function fakeHelper(body: string, idleStopMs?: number) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yzh-context-"))
    dirs.push(dir)
    const script = path.join(dir, "helper.cjs")
    fs.writeFileSync(
      script,
      `const rl = require("node:readline").createInterface({ input: process.stdin })
rl.on("line", (line) => { const [id, hwnd] = line.trim().split(" "); ${body} })`,
    )
    return createSelectionContextReader({
      scriptPath: script,
      command: { file: process.execPath, args: [script] },
      ...(idleStopMs ? { idleStopMs } : {}),
    })
  }

  it("写一行、读一行，按 id 对上号，选中的字和整段都拿得到", async () => {
    const reader = fakeHelper(
      `process.stdout.write(JSON.stringify({ id, selection: "sel " + id, text: "para " + id + (hwnd ? " @" + hwnd : ""), error: null }) + "\\n")`,
    )

    await expect(reader.read(2_000)).resolves.toEqual({
      selection: "sel 1",
      paragraph: "para 1",
      error: null,
    })
    await expect(reader.read(2_000, 99n)).resolves.toMatchObject({ paragraph: "para 2 @99" })
    reader.stop()
  })

  it("读不到文字时带着原因", async () => {
    const reader = fakeHelper(
      `process.stdout.write(JSON.stringify({ id, selection: null, text: null, error: "no_text_pattern" }) + "\\n")`,
    )

    await expect(reader.read(2_000)).resolves.toEqual({
      selection: null,
      paragraph: null,
      error: "no_text_pattern",
    })
    reader.stop()
  })

  it("一直不回话就超时返回 null，不拖慢取词", async () => {
    const reader = fakeHelper("")

    await expect(reader.read(50)).resolves.toBeNull()
    reader.stop()
  })

  it("闲置够久自动关掉，下次用时再起", async () => {
    const reader = fakeHelper(
      `process.stdout.write(JSON.stringify({ id, selection: null, text: "p", error: null }) + "\\n")`,
      100,
    )
    reader.warmUp()
    expect(reader.isRunning()).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(reader.isRunning()).toBe(false)

    await expect(reader.read(2_000)).resolves.toMatchObject({ paragraph: "p" })
    reader.stop()
  })
})
