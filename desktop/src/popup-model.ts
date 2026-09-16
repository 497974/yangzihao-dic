/**
 * 把扩展回来的查词结果、各种错误，整理成弹窗要显示的内容。纯函数，方便测试。
 */

import type { OutputField } from "./protocol"
import type { PopupField, PopupState } from "./shared/popup-api"

type ErrorState = Extract<PopupState, { kind: "error" }>

export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ""
  }
  if (typeof value === "string") {
    return value.trim()
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.map(formatFieldValue).filter(Boolean).join("；")
  }
  try {
    return JSON.stringify(value)
  } catch {
    return ""
  }
}

/**
 * 和网页查词弹窗一样：按词典设置里的字段顺序一行一行显示。
 * 大模型还在写的时候，没写到的字段是"…"；写完了还是空的显示"—"（由界面处理）。
 * 结果里多出来、设置里没有的字段排在最后——只在写完后才加，写的过程中字段名可能还不完整。
 */
export function buildFieldRows(
  outputSchema: OutputField[],
  fields: Record<string, unknown>,
  streaming: boolean,
): PopupField[] {
  const rows: PopupField[] = outputSchema.map((field) => ({
    label: field.name,
    value: formatFieldValue(fields[field.name]),
    pending: streaming && fields[field.name] === undefined,
    speakable: !!field.speaking,
  }))
  if (!streaming) {
    const known = new Set(outputSchema.map((field) => field.name))
    for (const [label, raw] of Object.entries(fields)) {
      const value = formatFieldValue(raw)
      if (!known.has(label) && value) {
        rows.push({ label, value, pending: false, speakable: false })
      }
    }
  }
  return rows
}

const ERROR_TITLES: Record<string, string> = {
  not_connected: "还没连上浏览器扩展",
  timeout: "查词没有进展",
  disconnected: "浏览器扩展断开了",
  text_too_long: "选中的文字太长了",
  empty_selection: "没有要查的文字",
  provider_unavailable: "词典用的翻译服务不可用",
  config_unavailable: "读不到扩展的设置",
}

/** 重试也没用的错误，不显示「重试」按钮 */
const NO_RETRY_CODES = new Set(["text_too_long", "empty_selection"])

export function errorCodeOf(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code
  }
  return "internal_error"
}

export function buildErrorState(
  error: unknown,
  text: string | null,
  source: string | null,
): ErrorState {
  const code = errorCodeOf(error)
  const message = error instanceof Error ? error.message : String(error)
  return {
    kind: "error",
    text,
    source,
    title: ERROR_TITLES[code] ?? "查词失败",
    message,
    canRetry: !NO_RETRY_CODES.has(code),
  }
}

export function noSelectionState(hotkey: string, source: string | null): ErrorState {
  return {
    kind: "error",
    text: null,
    source,
    title: "没取到选中的文字",
    message:
      `先用鼠标选中要查的词或句子，再按 ${hotkey}。\n\n` +
      "要是明明选中了还取不到，可能是这个程序不让复制，" +
      "或者它是以管理员身份运行的（桌面版没有管理员权限，碰不到它）。",
    canRetry: false,
  }
}

type QueuedState = Extract<PopupState, { kind: "queued" }>

/** 浏览器没开时查词：词先记在本地（见 offline-queue.ts），告诉用户之后会发生什么 */
export function queuedState(
  outcome: "added" | "already_queued" | "full",
  text: string,
  source: string | null,
  queueSize: number,
): QueuedState {
  if (outcome === "full") {
    return {
      kind: "queued",
      text,
      source,
      title: "记不下了",
      message: `浏览器没开时已经记了 ${queueSize} 个词，先打开浏览器，让它们存进生词本再记新的。`,
    }
  }
  return {
    kind: "queued",
    text,
    source,
    title: outcome === "added" ? "已记下，打开浏览器后自动查" : "这个词已经记下了",
    message:
      "浏览器还没开（或者扩展没连上桌面版），这个词先记在本地。" +
      "打开浏览器后会自动查好、存进生词本。\n\n" +
      `现在一共记了 ${queueSize} 个词。`,
  }
}
