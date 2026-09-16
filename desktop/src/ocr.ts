/**
 * 截图识字（优化清单第 13 条）的「认字」部分：用 Windows 自带的文字识别（Windows.Media.Ocr）。
 *
 * 为什么用它：系统自带、离线、免费、快，不用 API Key，也不用下载几十 MB 的识别模型。
 * 调研实测（2026-09-15，本机只装了简体中文识别器）：
 * - 中文识别器也认英文：obtain、整句英文、中英混排都认得出
 * - 字太小（原图 9–16 像素高）一个字都认不出，放大 3 倍后几乎全对 → 截下来的图先放大再认（ocrUpscale）
 * - 认得很快：识别器起来以后，一张图几毫秒到二三十毫秒
 * - 中文识别器把每个汉字当成一个"词"，整行文字里汉字之间全是空格；偶尔还把英文单词拆成两截
 *   （"YO u"、"sta rt"）→ 不用它拼好的整行，按每个字块的位置自己重新拼（assembleLine）
 *
 * 认字在一个常驻的隐藏 PowerShell 小进程里做（assets/ocr.ps1），和读选中文字同一套一问一答。
 */

import type { HelperProcessOptions } from "./helper-process"
import { createHelperProcess } from "./helper-process"

export interface OcrWord {
  text: string
  x: number
  y: number
  w: number
  h: number
}

export interface OcrLine {
  words: OcrWord[]
}

export interface OcrResult {
  lines: OcrLine[]
  /** 用的哪个识别器，比如 zh-Hans-CN */
  language: string | null
  /** 认不了的原因（没有识别器、图片打不开……） */
  error: string | null
}

/** 第一次认字要加载系统的识别组件，给得宽一点 */
export const OCR_TIMEOUT_MS = 8_000
/**
 * 截下来的图放大几倍再认：实测 3 倍时 12–16 像素的字几乎全对。
 * 试过按选区高度放大到 4–6 倍，反而更差（整句英文末尾的 start 认成了「sta比」），所以固定 3 倍。
 * 9 像素这种特别小的字放大多少都认不准：先把网页、文档放大（Ctrl + 滚轮）再截。
 */
export const OCR_UPSCALE = 3
/** 系统识别器接受的图片最长边（OcrEngine.MaxImageDimension 是 10000，留点余量） */
export const OCR_MAX_DIMENSION = 9_000

/**
 * 两个字块之间的空隙小于字高的这个比例，就当成同一个词里被拆开的两截，拼起来不加空格。
 * 实测：被拆开的英文单词（"YO|u"、"sta|rt"）空隙是字高的 0.14–0.23，
 * 正常的词间空格是 0.36–0.63，取中间的 0.3。汉字之间的空隙只有 0–0.09，本来就不加空格。
 */
export const SAME_WORD_GAP_RATIO = 0.3

const CJK = /[　-〿㐀-鿿豈-﫿＀-￯]/

/** 按字块的实际位置把一行拼回来：汉字之间不加空格，被拆开的英文单词接回去，词和词之间一个空格 */
export function assembleLine(words: readonly OcrWord[]): string {
  let text = ""
  words.forEach((word, index) => {
    const previous = words[index - 1]
    if (!previous) {
      text = word.text
      return
    }
    const bothCjk = CJK.test(previous.text.slice(-1)) && CJK.test(word.text.charAt(0))
    const gap = word.x - (previous.x + previous.w)
    const height = Math.max(previous.h, word.h, 1)
    const sameWord = gap < height * SAME_WORD_GAP_RATIO
    text += bothCjk || sameWord ? word.text : ` ${word.text}`
  })
  return text
}

export function assembleText(result: Pick<OcrResult, "lines">): string {
  return result.lines
    .map((line) => assembleLine(line.words))
    .filter((line) => line.trim())
    .join("\n")
}

/** 放大几倍：放大到 OCR_UPSCALE 倍，但最长边不超过识别器的上限 */
export function ocrUpscale(width: number, height: number): number {
  const longest = Math.max(width, height, 1)
  return Math.max(1, Math.min(OCR_UPSCALE, OCR_MAX_DIMENSION / longest))
}

/** 查词时去掉两头的标点和引号（框选时常把旁边的句号、括号一起框进来） */
export function trimForLookup(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s"'“”‘’(（\[【《<「『,，.。:：;；!！?？]+/, "")
    .replace(/[\s"'“”‘’)）\]】》>」』,，.。:：;；!！?？]+$/, "")
}

/**
 * 认出来的字该怎么处理：
 * - lookup：一个词或短语（最多 4 个英文词、6 个汉字，中间没有句子标点）→ 查词典
 * - translate：一整句、一段话 → 划词翻译
 * - null：什么都没认出来
 */
export function chooseOcrAction(text: string): "lookup" | "translate" | null {
  const target = trimForLookup(text)
  if (!target) {
    return null
  }
  // 框了好几行：不管多短都是一段话，交给翻译（trimForLookup 会把换行并成空格，得先看）
  if (text.trim().includes("\n")) {
    return "translate"
  }
  const cjk = (target.match(/[㐀-鿿]/g) ?? []).length
  const latinWords = target.split(" ").filter((word) => /[a-z]/i.test(word)).length
  const hasSentencePunctuation = /[.!?。！？;；,，:：]/.test(target)
  const short = cjk <= 6 && latinWords <= 4 && target.length <= 40
  return short && !hasSentencePunctuation ? "lookup" : "translate"
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function toOcrResult(reply: Record<string, unknown>): OcrResult {
  const lines = Array.isArray(reply.lines) ? reply.lines : []
  return {
    language: typeof reply.language === "string" ? reply.language : null,
    error: typeof reply.error === "string" ? reply.error : null,
    lines: lines.map((line) => {
      const words = Array.isArray((line as { words?: unknown })?.words)
        ? ((line as { words: unknown[] }).words ?? [])
        : []
      return {
        words: words
          .map((word) => word as Record<string, unknown>)
          .filter((word) => typeof word.text === "string" && word.text)
          .map((word) => ({
            text: word.text as string,
            x: toNumber(word.x),
            y: toNumber(word.y),
            w: toNumber(word.w),
            h: toNumber(word.h),
          })),
      }
    }),
  }
}

export function createOcrReader(options: Omit<HelperProcessOptions, "label">) {
  const helper = createHelperProcess({ ...options, label: "认字" })
  return {
    warmUp: () => helper.warmUp(),
    /** 认一张 PNG 图里的字；超时、小进程没了返回 null */
    async recognize(pngPath: string, timeoutMs = OCR_TIMEOUT_MS): Promise<OcrResult | null> {
      const reply = await helper.request(pngPath, timeoutMs)
      return reply ? toOcrResult(reply) : null
    },
    isRunning: () => helper.isRunning(),
    stop: () => helper.stop(),
  }
}

export type OcrReader = ReturnType<typeof createOcrReader>
