/**
 * 用 Windows 的 UI 自动化（给读屏软件用的辅助功能接口）读选中的字和它所在的那一段（优化清单第 8 条）。
 *
 * 两个用处：
 * - 取词：程序支持的话（记事本、Word……）直接读出选中的字，不碰剪贴板、不模拟 Ctrl+C，也更快
 * - 整句：选中文字所在的那一段交给词典当上下文，大模型能按句子挑对意思，例句也更贴切
 *
 * 读法：常驻一个隐藏的 PowerShell 小进程（assets/selection-context.ps1，见 helper-process.ts），
 * 小进程里用 C# 直接调 Windows 原生的 UI 自动化接口（.NET 自带的那层封装读不了经典输入框）。
 *
 * 读不到很常见：QQ、微信这类自己画界面的程序大多不提供文字接口。读不到就退回模拟 Ctrl+C，
 * 连着几次读不到的程序，这次运行里就不再去问它。
 */

import type { HelperProcessOptions } from "./helper-process"
import { createHelperProcess } from "./helper-process"

export { IDLE_STOP_MS } from "./helper-process"

/** 最多等这么久；等不到就当读不到，不能让取词因此变慢 */
export const CONTEXT_TIMEOUT_MS = 800
/** 交给词典的上下文最多这么长（扩展那边还会再截） */
export const MAX_CONTEXT_LENGTH = 1_500

/** 读一次的结果；selection = 选中的字，paragraph = 它所在的那一段，error = 读不到的原因 */
export interface SelectionRead {
  selection: string | null
  paragraph: string | null
  error: string | null
}

const normalize = (text: string) => text.replace(/\r\n?/g, "\n").trim()

/** 句子在哪结束：句号、问号、叹号（中英文）、换行 */
const SENTENCE_END = /[.!?。！？]\s|[。！？]|\n/g

/**
 * 读出来的这一段里确实包含选中的字才用（焦点可能已经换到别的控件上了）。
 * 和选中的字一模一样（比如只选了一整段）就不用带；太长就只留选中处前后，并且在句子边界上截，
 * 不把句子截成半句——截出来的半句话会误导大模型，还白花 token。
 */
export function pickContext(
  paragraph: string | null | undefined,
  selected: string,
): string | undefined {
  const text = normalize(paragraph ?? "")
  const target = normalize(selected)
  if (!text || !target || text === target) {
    return undefined
  }
  const index = text.indexOf(target)
  if (index === -1) {
    return undefined
  }
  if (text.length <= MAX_CONTEXT_LENGTH) {
    return text
  }
  const room = Math.max(0, MAX_CONTEXT_LENGTH - target.length)
  let start = Math.min(Math.max(0, index - Math.floor(room / 2)), text.length - MAX_CONTEXT_LENGTH)
  let end = start + MAX_CONTEXT_LENGTH

  // 开头挪到选中处之前第一个句子开头（窗口里第一个句末之后）；找不到就不动
  if (start > 0) {
    SENTENCE_END.lastIndex = start
    const boundary = SENTENCE_END.exec(text)
    if (boundary && boundary.index + boundary[0].length <= index) {
      start = boundary.index + boundary[0].length
    }
  }
  // 结尾退到选中处之后最后一个句末；找不到就不动
  if (end < text.length) {
    let lastEnd = -1
    SENTENCE_END.lastIndex = index + target.length
    for (
      let match = SENTENCE_END.exec(text);
      match && match.index < end;
      match = SENTENCE_END.exec(text)
    ) {
      lastEnd = match.index + match[0].trimEnd().length
    }
    if (lastEnd > index + target.length) {
      end = lastEnd
    }
  }
  return text.slice(start, end).trim()
}

/**
 * 记住哪些程序读不到（QQ、微信……）：连着 limit 次读不到，这次运行里就不再问它，
 * 直接用 Ctrl+C，省下每次问一遍的时间。读到过一次就清零。
 */
export function createAppSupportTracker(limit = 3) {
  const misses = new Map<string, number>()
  const keyOf = (exe: string) => exe.toLowerCase()
  return {
    worthTrying: (exe: string) => (misses.get(keyOf(exe)) ?? 0) < limit,
    record(exe: string, readable: boolean) {
      const key = keyOf(exe)
      if (readable) {
        misses.delete(key)
      } else {
        misses.set(key, (misses.get(key) ?? 0) + 1)
      }
    },
  }
}

/** 这个程序提供文字接口（哪怕这次没选中东西）；读不到文字接口或者超时才算不支持 */
export function isReadable(read: SelectionRead | null): boolean {
  return read !== null && (read.error === null || read.error === "no_selection")
}

function toRead(reply: Record<string, unknown>): SelectionRead {
  const text = (value: unknown) => (typeof value === "string" ? value : null)
  return {
    selection: text(reply.selection),
    paragraph: text(reply.text),
    error: text(reply.error),
  }
}

export function createSelectionContextReader(options: Omit<HelperProcessOptions, "label">) {
  const helper = createHelperProcess({ ...options, label: "读文字" })
  return {
    /** 提前把小进程拉起来：PowerShell 起来要零点几秒，别让取词去等它 */
    warmUp: () => helper.warmUp(),

    /** 读当前选中的字和它所在的那一段；超时、小进程没了都返回 null */
    async read(timeoutMs = CONTEXT_TIMEOUT_MS, hwnd?: bigint): Promise<SelectionRead | null> {
      const reply = await helper.request(hwnd === undefined ? undefined : String(hwnd), timeoutMs)
      return reply ? toRead(reply) : null
    },

    isRunning: () => helper.isRunning(),
    stop: () => helper.stop(),
  }
}

export type SelectionContextReader = ReturnType<typeof createSelectionContextReader>
