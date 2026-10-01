/**
 * 桌面版连接桥（桌面版方案第 3 步）——扩展后台这一侧的 WebSocket 客户端。
 *
 * 这里只是一个状态机：socket 怎么建、查词存词找谁办、状态写到哪，全从外面注入。
 * 真正接上浏览器 WebSocket 和后台服务的是 setup.ts；测试里换成假的 socket。
 *
 * 行为要点：
 * - 连上先发 hello，之后每 20 秒发一次 ping。Chrome 116 起，WebSocket 上有来往时
 *   后台不会被休眠，连接才能一直挂着
 * - 断开后按 1、2、5、10、30 秒依次重试；一旦连上，退避清零
 * - ensureConnected 给唤醒定时器用：没连着就马上连，不等退避
 * - 关掉开关（stop）后不再重连
 */

import type { DailyGoalRequest, DailyGoalResult } from "./daily-goal"
import type {
  DesktopLookupProgress,
  DesktopLookupRequest,
  DesktopLookupResult,
} from "./dictionary-lookup"
import type { DesktopTranslateRequest, DesktopTranslateResult } from "./input-translate"
import type { DesktopIncomingMessage, ExtensionOutgoingMessage } from "./protocol"
import type { DesktopReviewStatus } from "./review-status"
import type { DesktopSaveResult } from "./save-word"
import type {
  DesktopSelectionTranslateProgress,
  DesktopSelectionTranslateRequest,
  DesktopSelectionTranslateResult,
} from "./selection-translate"
import type { DesktopSpeakRequest, DesktopSpeakResult } from "./speak"
import type { DesktopToolbarInfo } from "./toolbar"
import type { DesktopBridgeStatus } from "@/utils/constants/desktop-bridge"
import {
  DESKTOP_BRIDGE_CLIENT_ID,
  DESKTOP_BRIDGE_FEATURES,
  DESKTOP_BRIDGE_PROTOCOL_VERSION,
} from "@/utils/constants/desktop-bridge"
import {
  MAX_LOOKUP_TEXT_LENGTH,
  MAX_SPEAK_TEXT_LENGTH,
  MAX_TRANSLATE_TEXT_LENGTH,
  parseDesktopMessage,
  toBridgeError,
} from "./protocol"

/** 连接桥只用到 WebSocket 的这几样；真实实现见 setup.ts 里的适配器 */
export interface BridgeSocket {
  readonly readyState: number
  send: (data: string) => void
  close: () => void
  onopen: (() => void) | null
  onmessage: ((data: unknown) => void) | null
  onclose: (() => void) | null
}

export interface DesktopBridgeDeps {
  url: string
  version: string
  createSocket: (url: string) => BridgeSocket
  lookup: (
    request: DesktopLookupRequest,
    options: { onProgress: (progress: DesktopLookupProgress) => void },
  ) => Promise<DesktopLookupResult>
  save: (fields: Record<string, unknown>, actionId?: string) => Promise<DesktopSaveResult>
  translate: (request: DesktopTranslateRequest) => Promise<DesktopTranslateResult>
  translateSelection: (
    request: DesktopSelectionTranslateRequest,
    options: { onProgress: (progress: DesktopSelectionTranslateProgress) => void },
  ) => Promise<DesktopSelectionTranslateResult>
  getToolbar: () => Promise<DesktopToolbarInfo>
  speak: (request: DesktopSpeakRequest) => Promise<DesktopSpeakResult>
  reviewStatus: () => Promise<DesktopReviewStatus>
  openReview: () => Promise<{ opened: true }>
  dailyGoal: (request: DailyGoalRequest) => Promise<DailyGoalResult>
  setStatus: (status: DesktopBridgeStatus) => void
  now: () => number
}

/** 与 WebSocket.readyState 的取值一致 */
const SOCKET_CONNECTING = 0
const SOCKET_OPEN = 1

export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const
export const PING_INTERVAL_MS = 20_000
/**
 * 查词进度最多这么久发一条。大模型每吐一个字都会来一次进度，全转过去太密；
 * 攒一下只发最新的那份，弹窗看起来照样是连续在长。
 */
export const PROGRESS_INTERVAL_MS = 150

/**
 * 把一连串进度攒着，最多每 PROGRESS_INTERVAL_MS 发一份最新的；
 * finish 之后（完整结果已经发出）还没发的进度作废，不会跟在结果后面。
 */
function createProgressThrottle<T>(now: () => number, emit: (progress: T) => void) {
  let finished = false
  let lastSentAt = Number.NEGATIVE_INFINITY
  let latest: { value: T } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    timer = null
    if (finished || !latest) {
      return
    }
    lastSentAt = now()
    const { value } = latest
    latest = null
    emit(value)
  }

  return {
    push(progress: T) {
      if (finished) {
        return
      }
      latest = { value: progress }
      if (timer) {
        return
      }
      const wait = PROGRESS_INTERVAL_MS - (now() - lastSentAt)
      if (wait <= 0) {
        flush()
      } else {
        timer = setTimeout(flush, wait)
      }
    },
    finish() {
      finished = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}

export function createDesktopBridge(deps: DesktopBridgeDeps) {
  let socket: BridgeSocket | null = null
  let running = false
  let attempt = 0
  let lastConnectedAt: number | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null

  const send = (message: ExtensionOutgoingMessage) => {
    if (socket?.readyState === SOCKET_OPEN) {
      socket.send(JSON.stringify(message))
    }
  }

  const stopPing = () => {
    if (pingTimer) {
      clearInterval(pingTimer)
      pingTimer = null
    }
  }

  const clearReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const scheduleReconnect = () => {
    if (!running || reconnectTimer) {
      return
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]
    attempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  const handleLookup = async (message: Extract<DesktopIncomingMessage, { type: "lookup" }>) => {
    if (message.text.length > MAX_LOOKUP_TEXT_LENGTH) {
      send({
        type: "lookupResult",
        id: message.id,
        ok: false,
        error: {
          code: "text_too_long",
          message: `选中的文字太长了（超过 ${MAX_LOOKUP_TEXT_LENGTH} 个字），请只选要查的词或那一句话`,
        },
      })
      return
    }
    const progress = createProgressThrottle<DesktopLookupProgress>(deps.now, (value) => {
      send({ type: "lookupProgress", id: message.id, progress: value })
    })
    try {
      const result = await deps.lookup(
        {
          text: message.text,
          context: message.context,
          sourceTitle: message.sourceTitle,
          ...(message.actionId ? { actionId: message.actionId } : {}),
          ...(message.fresh ? { fresh: true } : {}),
        },
        { onProgress: (value) => progress.push(value) },
      )
      progress.finish()
      send({ type: "lookupResult", id: message.id, ok: true, result })
    } catch (error) {
      progress.finish()
      send({
        type: "lookupResult",
        id: message.id,
        ok: false,
        error: toBridgeError(error, "查词失败"),
      })
    }
  }

  const handleSave = async (message: Extract<DesktopIncomingMessage, { type: "save" }>) => {
    try {
      const result = await deps.save(message.fields, message.actionId)
      send({ type: "saveResult", id: message.id, ok: true, result })
    } catch (error) {
      send({
        type: "saveResult",
        id: message.id,
        ok: false,
        error: toBridgeError(error, "存词失败"),
      })
    }
  }

  const handleTranslate = async (
    message: Extract<DesktopIncomingMessage, { type: "translate" }>,
  ) => {
    if (message.text.length > MAX_TRANSLATE_TEXT_LENGTH) {
      send({
        type: "translateResult",
        id: message.id,
        ok: false,
        error: {
          code: "text_too_long",
          message: `要翻译的文字太长了（超过 ${MAX_TRANSLATE_TEXT_LENGTH} 个字），请分几段翻`,
        },
      })
      return
    }
    const request = { text: message.text, sourceTitle: message.sourceTitle }
    // 划词翻译用大模型时边写边出，和查词一样把进度转过去
    const progress = createProgressThrottle<DesktopSelectionTranslateProgress>(deps.now, (value) =>
      send({ type: "translateProgress", id: message.id, progress: value }),
    )
    try {
      const result =
        message.mode === "selection"
          ? await deps.translateSelection(request, { onProgress: (value) => progress.push(value) })
          : await deps.translate(request)
      progress.finish()
      send({ type: "translateResult", id: message.id, ok: true, result })
    } catch (error) {
      progress.finish()
      send({
        type: "translateResult",
        id: message.id,
        ok: false,
        error: toBridgeError(error, "翻译失败"),
      })
    }
  }

  const handleToolbar = async (message: Extract<DesktopIncomingMessage, { type: "toolbar" }>) => {
    try {
      const result = await deps.getToolbar()
      send({ type: "toolbarResult", id: message.id, ok: true, result })
    } catch (error) {
      send({
        type: "toolbarResult",
        id: message.id,
        ok: false,
        error: toBridgeError(error, "读取划词工具栏设置失败"),
      })
    }
  }

  const handleSpeak = async (message: Extract<DesktopIncomingMessage, { type: "speak" }>) => {
    if (message.text.length > MAX_SPEAK_TEXT_LENGTH) {
      send({
        type: "speakResult",
        id: message.id,
        ok: false,
        error: {
          code: "text_too_long",
          message: `要朗读的文字太长了（超过 ${MAX_SPEAK_TEXT_LENGTH} 个字），请只选一句或一小段`,
        },
      })
      return
    }
    try {
      const result = await deps.speak({ text: message.text })
      send({ type: "speakResult", id: message.id, ok: true, result })
    } catch (error) {
      send({
        type: "speakResult",
        id: message.id,
        ok: false,
        error: toBridgeError(error, "朗读失败"),
      })
    }
  }

  const handleReviewStatus = async (id: string) => {
    try {
      const result = await deps.reviewStatus()
      send({ type: "reviewStatusResult", id, ok: true, result })
    } catch (error) {
      send({
        type: "reviewStatusResult",
        id,
        ok: false,
        error: toBridgeError(error, "读取复习进度失败"),
      })
    }
  }

  const handleOpenReview = async (id: string) => {
    try {
      const result = await deps.openReview()
      send({ type: "openReviewResult", id, ok: true, result })
    } catch (error) {
      send({
        type: "openReviewResult",
        id,
        ok: false,
        error: toBridgeError(error, "打开复习页失败"),
      })
    }
  }

  const handleDailyGoal = async (
    message: Extract<DesktopIncomingMessage, { type: "dailyGoal" }>,
  ) => {
    const { id, type: _type, ...request } = message
    try {
      const result = await deps.dailyGoal(request)
      send({ type: "dailyGoalResult", id, ok: true, result })
    } catch (error) {
      send({
        type: "dailyGoalResult",
        id,
        ok: false,
        error: toBridgeError(error, "每日必学出题失败"),
      })
    }
  }

  const handleMessage = async (message: DesktopIncomingMessage) => {
    if (message.type === "lookup") {
      await handleLookup(message)
    } else if (message.type === "save") {
      await handleSave(message)
    } else if (message.type === "translate") {
      await handleTranslate(message)
    } else if (message.type === "toolbar") {
      await handleToolbar(message)
    } else if (message.type === "speak") {
      await handleSpeak(message)
    } else if (message.type === "reviewStatus") {
      await handleReviewStatus(message.id)
    } else if (message.type === "openReview") {
      await handleOpenReview(message.id)
    } else if (message.type === "dailyGoal") {
      await handleDailyGoal(message)
    }
    // 剩下的只有 pong：保活的回应，不用处理
  }

  function connect() {
    if (!running) {
      return
    }
    // 正在连或已连上就不重复建——唤醒定时器和开关可能同时触发
    if (socket && (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN)) {
      return
    }
    clearReconnect()

    let next: BridgeSocket
    try {
      next = deps.createSocket(deps.url)
    } catch {
      scheduleReconnect()
      return
    }
    socket = next

    next.onopen = () => {
      if (socket !== next) {
        return
      }
      attempt = 0
      lastConnectedAt = deps.now()
      send({
        type: "hello",
        client: DESKTOP_BRIDGE_CLIENT_ID,
        version: deps.version,
        protocol: DESKTOP_BRIDGE_PROTOCOL_VERSION,
        features: [...DESKTOP_BRIDGE_FEATURES],
      })
      deps.setStatus({ connected: true, lastConnectedAt })
      stopPing()
      pingTimer = setInterval(() => send({ type: "ping" }), PING_INTERVAL_MS)
    }

    next.onmessage = (data) => {
      const message = parseDesktopMessage(data)
      if (message) {
        void handleMessage(message)
      }
    }

    next.onclose = () => {
      // 已经换了新 socket（或主动 stop 了），旧连接的关闭事件不再管
      if (socket !== next) {
        return
      }
      socket = null
      stopPing()
      deps.setStatus({ connected: false, lastConnectedAt })
      scheduleReconnect()
    }
  }

  return {
    /** 打开开关：开始连接，断了自动重连 */
    start() {
      if (running) {
        return
      }
      running = true
      attempt = 0
      connect()
    },
    /** 关掉开关：断开并不再重连 */
    stop() {
      running = false
      clearReconnect()
      stopPing()
      const current = socket
      socket = null
      current?.close()
      deps.setStatus({ connected: false, lastConnectedAt })
    },
    /** 唤醒定时器用：开关开着但没连上时立刻连，不等退避 */
    ensureConnected() {
      if (!running) {
        return
      }
      attempt = 0
      clearReconnect()
      connect()
    },
    isConnected: () => socket?.readyState === SOCKET_OPEN,
  }
}

export type DesktopBridge = ReturnType<typeof createDesktopBridge>
