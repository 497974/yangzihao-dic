import type { OcrWord } from "../ocr"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  assembleLine,
  assembleText,
  chooseOcrAction,
  createOcrReader,
  OCR_MAX_DIMENSION,
  ocrUpscale,
  trimForLookup,
} from "../ocr"

/** 在一行上从左往右排字块：每项是 [文字, 和前一块之间的空隙]，字高 40 */
function row(items: Array<[string, number]>): OcrWord[] {
  let x = 0
  return items.map(([text, gap]) => {
    x += gap
    const word = { text, x, y: 0, w: text.length * 20, h: 40 }
    x += word.w
    return word
  })
}

describe("按位置把识别出的字拼回来", () => {
  it("汉字之间不加空格", () => {
    expect(
      assembleLine(
        row([
          ["你", 0],
          ["必", 6],
          ["须", 6],
          ["。", 4],
        ]),
      ),
    ).toBe("你必须。")
  })

  it("被拆开的英文单词接回去，词和词之间一个空格", () => {
    const words = row([
      ["YO", 0],
      ["u", 2],
      ["must", 14],
      ["sta", 14],
      ["rt.", 3],
    ])
    expect(assembleLine(words)).toBe("YOu must start.")
  })

  it("中英混排：汉字和英文之间隔得开就留空格", () => {
    expect(
      assembleLine(
        row([
          ["这", 0],
          ["个", 5],
          ["词", 5],
          ["obtain", 14],
          ["的", 14],
        ]),
      ),
    ).toBe("这个词 obtain 的")
  })

  it("多行用换行连起来，空行丢掉", () => {
    expect(
      assembleText({
        lines: [{ words: row([["hello", 0]]) }, { words: [] }, { words: row([["world", 0]]) }],
      }),
    ).toBe("hello\nworld")
  })
})

describe("认出来的字怎么处理", () => {
  it("一个词、一个短语：查词典", () => {
    expect(chooseOcrAction("obtain")).toBe("lookup")
    expect(chooseOcrAction(" take off. ")).toBe("lookup")
    expect(chooseOcrAction("获得")).toBe("lookup")
  })

  it("一整句、一段话：翻译", () => {
    expect(chooseOcrAction("You must obtain a permit before you start.")).toBe("translate")
    expect(chooseOcrAction("你必须先取得许可证才能开始")).toBe("translate")
    expect(chooseOcrAction("first line\nsecond")).toBe("translate")
  })

  it("什么都没认出来", () => {
    expect(chooseOcrAction("  ")).toBeNull()
    expect(chooseOcrAction("。，")).toBeNull()
  })

  it("查词前去掉两头框进来的标点和引号", () => {
    expect(trimForLookup("“obtain,”")).toBe("obtain")
    expect(trimForLookup("（获得）")).toBe("获得")
  })
})

describe("放大倍数", () => {
  // 按选区高度放大到 4–6 倍实测反而更差，所以不管框多大、多小，都是 3 倍
  it("一行字、几行字都放大 3 倍", () => {
    expect(ocrUpscale(300, 30)).toBe(3)
    expect(ocrUpscale(300, 120)).toBe(3)
  })

  it("大图放大后不能超过识别器的上限", () => {
    const scale = ocrUpscale(6000, 200)
    expect(6000 * scale).toBeLessThanOrEqual(OCR_MAX_DIMENSION)
    expect(scale).toBeGreaterThanOrEqual(1)
  })
})

describe("认字的小进程", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("把图片路径交过去，拿回整理好的字块；路径里有空格也行", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yzh-ocr-"))
    dirs.push(dir)
    const script = path.join(dir, "helper.cjs")
    fs.writeFileSync(
      script,
      `const rl = require("node:readline").createInterface({ input: process.stdin })
rl.on("line", (line) => {
  const space = line.indexOf(" ")
  const id = line.slice(0, space), file = line.slice(space + 1)
  process.stdout.write(JSON.stringify({ id, language: "zh-Hans-CN", error: null,
    lines: [{ words: [{ text: file, x: 1, y: 2, w: 3, h: 4 }, { text: "", x: 0 }, { oops: true }] }] }) + "\\n")
})`,
    )
    const reader = createOcrReader({
      scriptPath: script,
      command: { file: process.execPath, args: [script] },
    })

    await expect(reader.recognize("C:\\My Pictures\\shot.png", 2_000)).resolves.toEqual({
      language: "zh-Hans-CN",
      error: null,
      lines: [{ words: [{ text: "C:\\My Pictures\\shot.png", x: 1, y: 2, w: 3, h: 4 }] }],
    })
    reader.stop()
  })
})
