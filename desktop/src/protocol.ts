/**
 * 与浏览器扩展之间的通信协议（见项目根目录的 桌面版方案.md）。
 *
 * 必须和扩展里的这两个文件保持一致，改一边另一边也要改：
 *   src/utils/constants/desktop-bridge.ts                 端口、路径、协议版本
 *   src/entrypoints/background/desktop-bridge/protocol.ts 消息格式
 *
 * 桌面程序是服务端，扩展后台连过来。一条消息就是一个 JSON 对象，用 type 区分：
 *
 *   桌面 → 扩展   lookup  { id, text, context?, sourceTitle?, fresh? }   查一个词（fresh = 重新生成，不用缓存）
 *                 save    { id, fields }                        把查到的结果存进生词本
 *                 speak   { id, text }                          按扩展的朗读设置合成语音
 *                 pong    {}                                    回应保活
 *   扩展 → 桌面   hello   { client, version, protocol }         连上时先发，自报家门
 *                 lookupProgress { id, progress }               大模型边生成边发（字段逐个填上）
 *                 lookupResult / saveResult / speakResult { id, ok, result | error }
 *                 ping    {}                                    每 20 秒一次
 */

export const BRIDGE_HOST = "127.0.0.1"
export const BRIDGE_PORT = 47813
export const BRIDGE_PATH = "/yangzihao-dic"
export const PROTOCOL_VERSION = 1
export const EXTENSION_CLIENT_ID = "yangzihao-dic-extension"

/** 扩展回过来的错误，message 是给人看的，弹窗直接显示 */
export interface BridgeErrorPayload {
  code: string
  message: string
}

/** 词典的一个输出字段；按这个顺序显示，speaking = 这个字段旁边有朗读按钮 */
export interface OutputField {
  name: string
  type: string
  speaking?: boolean
}

/** 查词结果：字段名就是生词本的列名（词条、释义……），存词时原样交回去 */
export interface LookupResult {
  fields: Record<string, unknown>
  outputSchema: OutputField[]
  /** true = 走的是免费的机器翻译快速通道，没有调用大模型 */
  fast: boolean
  /** 这个词算上这一次查了几次（旧版扩展没有这一项） */
  lookupCount?: number
  /** 存过的词又查了一次，它的复习卡被提前到了今天 */
  reviewBumped?: boolean
}

/** 大模型查词的中途进度：字段写到哪就给到哪；thinking = 推理模型还在思考 */
export interface LookupProgress {
  fields: Record<string, unknown>
  outputSchema: OutputField[]
  thinking: { status: "thinking" | "complete"; text: string } | null
}

export interface SaveResult {
  notebaseId: string
  /** 这次是否新建了一个生词本（第一次存词时） */
  createdNotebase: boolean
  /** 生词本里已经有这个词了，没有再加一行（旧版扩展没有这一项） */
  duplicate?: boolean
}

/** 扩展按它的朗读设置合成好的音频 */
export interface SpeakResult {
  audioBase64: string
  contentType: string
}

/** 今天有几个词该复习（新卡已按每天上限封顶） */
export interface ReviewStatus {
  due: number
  newCount: number
  reviewCount: number
}

/** 三下空格翻译的结果 */
export interface TranslateResult {
  text: string
  from: string
  to: string
}

/** 划词翻译的结果；fast = 纯翻译引擎一次返回 */
export interface SelectionTranslateResult {
  text: string
  fast: boolean
}

/** 划词翻译的中途进度（大模型边写边出） */
export interface SelectionTranslateProgress {
  text: string
  thinking: { status: "thinking" | "complete"; text: string } | null
}

export interface ToolbarAction {
  id: string
  name: string
  /** Iconify 图标名，比如 tabler:book-2 */
  icon: string
  isDictionary: boolean
}

/** 划词工具栏上放哪些按钮（和扩展网页划词工具栏同一份设置） */
export interface ToolbarInfo {
  translate: boolean
  speak: boolean
  actions: ToolbarAction[]
}

export interface LookupRequest {
  text: string
  context?: string
  sourceTitle?: string
  /** 划词工具栏上的哪个动作；不传就是内置词典 */
  actionId?: string
  /** 「重新生成」：不用上次查过的结果，重新问大模型 */
  fresh?: boolean
}

export type DesktopOutgoingMessage =
  | ({ type: "lookup"; id: string } & LookupRequest)
  | { type: "save"; id: string; fields: Record<string, unknown>; actionId?: string }
  | {
      type: "translate"
      id: string
      text: string
      sourceTitle?: string
      /** input = 三下空格翻译；selection = 划词工具栏的翻译按钮 */
      mode?: "input" | "selection"
    }
  | { type: "toolbar"; id: string }
  | { type: "speak"; id: string; text: string }
  | { type: "reviewStatus"; id: string }
  | { type: "openReview"; id: string }
  | { type: "pong" }

export type ExtensionIncomingMessage =
  /** features：扩展能办哪些事（lookup、save、translate…）；旧版扩展没有这一项 */
  | { type: "hello"; client: string; version: string; protocol: number; features: string[] }
  | { type: "ping" }
  | { type: "lookupProgress"; id: string; progress: LookupProgress }
  | { type: "lookupResult"; id: string; ok: true; result: LookupResult }
  | { type: "lookupResult"; id: string; ok: false; error: BridgeErrorPayload }
  | { type: "saveResult"; id: string; ok: true; result: SaveResult }
  | { type: "saveResult"; id: string; ok: false; error: BridgeErrorPayload }
  | {
      type: "translateResult"
      id: string
      ok: true
      result: TranslateResult | SelectionTranslateResult
    }
  | { type: "translateResult"; id: string; ok: false; error: BridgeErrorPayload }
  | { type: "translateProgress"; id: string; progress: SelectionTranslateProgress }
  | { type: "toolbarResult"; id: string; ok: true; result: ToolbarInfo }
  | { type: "toolbarResult"; id: string; ok: false; error: BridgeErrorPayload }
  | { type: "speakResult"; id: string; ok: true; result: SpeakResult }
  | { type: "speakResult"; id: string; ok: false; error: BridgeErrorPayload }
  | { type: "reviewStatusResult"; id: string; ok: true; result: ReviewStatus }
  | { type: "reviewStatusResult"; id: string; ok: false; error: BridgeErrorPayload }
  | { type: "openReviewResult"; id: string; ok: true; result: { opened: true } }
  | { type: "openReviewResult"; id: string; ok: false; error: BridgeErrorPayload }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isBridgeError(value: unknown): value is BridgeErrorPayload {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string"
}

/**
 * 解析扩展发来的一条原始消息；不是合法 JSON、或格式不对，一律返回 null。
 *
 * 结果的内部结构（fields 里有什么）不在这里细查：它只会被显示和原样交回扩展。
 */
export function parseExtensionMessage(raw: string): ExtensionIncomingMessage | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(json)) {
    return null
  }

  if (json.type === "ping") {
    return { type: "ping" }
  }
  if (json.type === "hello") {
    if (
      typeof json.client === "string" &&
      typeof json.version === "string" &&
      typeof json.protocol === "number"
    ) {
      const features = Array.isArray(json.features)
        ? json.features.filter((feature): feature is string => typeof feature === "string")
        : []
      return {
        type: "hello",
        client: json.client,
        version: json.version,
        protocol: json.protocol,
        features,
      }
    }
    return null
  }
  if (typeof json.id !== "string" || !json.id) {
    return null
  }
  if (json.type === "lookupProgress") {
    const progress = json.progress
    if (isRecord(progress) && isRecord(progress.fields) && Array.isArray(progress.outputSchema)) {
      return json as ExtensionIncomingMessage
    }
    return null
  }
  if (json.type === "translateProgress") {
    const progress = json.progress
    return isRecord(progress) && typeof progress.text === "string"
      ? (json as ExtensionIncomingMessage)
      : null
  }
  if (
    json.type === "lookupResult" ||
    json.type === "saveResult" ||
    json.type === "translateResult" ||
    json.type === "toolbarResult" ||
    json.type === "speakResult" ||
    json.type === "reviewStatusResult" ||
    json.type === "openReviewResult"
  ) {
    if (json.ok === true && isRecord(json.result)) {
      return json as ExtensionIncomingMessage
    }
    if (json.ok === false && isBridgeError(json.error)) {
      return json as ExtensionIncomingMessage
    }
  }
  return null
}
