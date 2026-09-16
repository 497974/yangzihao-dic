/**
 * 本机 WebSocket 服务端：等浏览器扩展连上来，然后把查词、存词请求交给它办。
 *
 * 不依赖 Electron，方便单独测试；托盘、弹窗那些在 main.ts 里接上。
 *
 * 安全：
 * - 只监听 127.0.0.1，局域网和外网都连不进来
 * - 只接受来源（Origin）是浏览器扩展的连接。浏览器会给每个 WebSocket 连接带上
 *   发起方的来源，网页伪造不了——所以随便打开的网站连不上这里，
 *   也就没法冒充扩展、或者骗桌面程序去查词
 * - 连上后还得发 hello 自报家门，协议版本对得上才算数，否则断开
 *
 * 同时连着好几个（比如 Chrome 和 Edge 都开了），请求发给最近连上的那个。
 */

import type { IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import type {
  BridgeErrorPayload,
  DesktopOutgoingMessage,
  LookupProgress,
  LookupRequest,
  LookupResult,
  ReviewStatus,
  SaveResult,
  SelectionTranslateProgress,
  SelectionTranslateResult,
  SpeakResult,
  ToolbarInfo,
  TranslateResult,
} from "./protocol"
import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { WebSocket, WebSocketServer } from "ws"
import {
  BRIDGE_HOST,
  BRIDGE_PATH,
  BRIDGE_PORT,
  EXTENSION_CLIENT_ID,
  parseExtensionMessage,
  PROTOCOL_VERSION,
} from "./protocol"

/**
 * 这么久一点新内容都没有，才算扩展没回应。
 * 大模型查词会边写边发进度，每来一次进度都重新计时——慢归慢，只要还在写就一直等。
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
/** 不管有没有进度，一次请求最多等这么久 */
export const MAX_REQUEST_MS = 180_000
/** 连上后要在这么久之内发 hello，否则断开 */
export const HELLO_TIMEOUT_MS = 5_000
/** 扩展每 20 秒 ping 一次；这么久一点动静都没有，就当它已经没了 */
export const IDLE_TIMEOUT_MS = 70_000
/** 协议版本对不上时的关闭码（4000–4999 是留给应用自己用的） */
export const CLOSE_PROTOCOL_MISMATCH = 4001
export const CLOSE_BAD_HELLO = 4002

const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024

/** Chrome、Edge 是 chrome-extension://，Firefox 是 moz-extension:// */
const EXTENSION_ORIGIN = /^(?:chrome|moz)-extension:\/\/[\w-]+\/?$/i

export function isAllowedOrigin(origin: string | undefined): boolean {
  return !!origin && EXTENSION_ORIGIN.test(origin)
}

export interface BridgeStatus {
  connected: boolean
  /** 连上的扩展版本号（最近连上的那个） */
  extensionVersion: string | null
  /** 同时连着几个浏览器 */
  clientCount: number
  /** 最近一次拒绝连接的原因，比如版本不兼容；给托盘显示用 */
  lastError: string | null
}

export class BridgeRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "BridgeRequestError"
  }
}

export interface BridgeServerOptions {
  host?: string
  /** 0 = 让系统随便挑一个空闲端口，测试用 */
  port?: number
  onStatusChange?: (status: BridgeStatus) => void
  helloTimeoutMs?: number
  idleTimeoutMs?: number
}

export interface RequestOptions<Progress = LookupProgress> {
  /** 多久没有任何新内容就算超时 */
  timeoutMs?: number
  /** 总共最多等多久 */
  maxMs?: number
  onProgress?: (progress: Progress) => void
}

interface Client {
  socket: WebSocket
  version: string | null
  /** 握手时扩展说它能办的事；旧版扩展是空的 */
  features: string[]
  lastSeen: number
}

interface PendingRequest {
  client: Client
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  /** 查词进度或划词翻译进度，由发请求的一方决定是哪种 */
  onProgress?: (progress: never) => void
  /** 有新进度，重新开始计时 */
  touch: () => void
  /** 清掉所有计时器 */
  clear: () => void
}

function rejectUpgrade(socket: Duplex, status: number, reason: string) {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

export function createBridgeServer(options: BridgeServerOptions = {}) {
  const host = options.host ?? BRIDGE_HOST
  const helloTimeoutMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS
  const idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS

  /** 已经握过手的连接，按连上的先后排，最后一个最新 */
  const clients: Client[] = []
  const pending = new Map<string, PendingRequest>()
  let lastError: string | null = null
  let idleTimer: ReturnType<typeof setInterval> | null = null

  const getStatus = (): BridgeStatus => ({
    connected: clients.length > 0,
    extensionVersion: clients.at(-1)?.version ?? null,
    clientCount: clients.length,
    lastError,
  })
  const emitStatus = () => options.onStatusChange?.(getStatus())

  const send = (client: Client, message: DesktopOutgoingMessage) => {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify(message))
    }
  }

  const httpServer = createServer((_request, response) => {
    // 这里只做 WebSocket，普通的网页请求一律不理
    response.writeHead(404).end()
  })
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES })

  httpServer.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (request.url ?? "").split("?")[0]
    if (path !== BRIDGE_PATH) {
      rejectUpgrade(socket, 404, "Not Found")
      return
    }
    if (!isAllowedOrigin(request.headers.origin)) {
      rejectUpgrade(socket, 403, "Forbidden")
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => handleConnection(ws))
  })

  function removeClient(client: Client) {
    const index = clients.indexOf(client)
    if (index !== -1) {
      clients.splice(index, 1)
    }
    for (const [id, request] of pending) {
      if (request.client === client) {
        request.clear()
        pending.delete(id)
        request.reject(new BridgeRequestError("disconnected", "浏览器扩展断开了，请重试"))
      }
    }
  }

  function handleConnection(socket: WebSocket) {
    const client: Client = { socket, version: null, features: [], lastSeen: Date.now() }
    let ready = false

    const helloTimer = setTimeout(() => {
      if (!ready) {
        socket.close(CLOSE_BAD_HELLO, "hello timeout")
      }
    }, helloTimeoutMs)

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        return
      }
      client.lastSeen = Date.now()
      const message = parseExtensionMessage(data.toString())
      if (!message) {
        return
      }

      if (!ready) {
        if (message.type !== "hello" || message.client !== EXTENSION_CLIENT_ID) {
          socket.close(CLOSE_BAD_HELLO, "expected hello")
          return
        }
        if (message.protocol !== PROTOCOL_VERSION) {
          lastError =
            message.protocol > PROTOCOL_VERSION
              ? `浏览器扩展（v${message.version}）比桌面程序新，请更新桌面程序`
              : `浏览器扩展（v${message.version}）太旧了，请更新扩展`
          socket.close(CLOSE_PROTOCOL_MISMATCH, "protocol mismatch")
          emitStatus()
          return
        }
        clearTimeout(helloTimer)
        ready = true
        client.version = message.version
        client.features = message.features
        lastError = null
        clients.push(client)
        emitStatus()
        return
      }

      if (message.type === "ping") {
        send(client, { type: "pong" })
        return
      }
      if (message.type === "lookupProgress" || message.type === "translateProgress") {
        const request = pending.get(message.id)
        if (request && request.client === client) {
          request.touch()
          ;(request.onProgress as ((progress: unknown) => void) | undefined)?.(message.progress)
        }
        return
      }
      if (
        message.type === "lookupResult" ||
        message.type === "saveResult" ||
        message.type === "translateResult" ||
        message.type === "toolbarResult" ||
        message.type === "speakResult" ||
        message.type === "reviewStatusResult" ||
        message.type === "openReviewResult"
      ) {
        const request = pending.get(message.id)
        if (!request || request.client !== client) {
          return
        }
        request.clear()
        pending.delete(message.id)
        if (message.ok) {
          request.resolve(message.result)
        } else {
          request.reject(new BridgeRequestError(message.error.code, message.error.message))
        }
      }
    })

    socket.on("close", () => {
      clearTimeout(helloTimer)
      if (ready) {
        removeClient(client)
        emitStatus()
      }
    })
    // 出错之后一定会跟着 close，在 close 里统一收拾；这里只是别让异常冒出去
    socket.on("error", () => {})
  }

  function request<T, Progress = LookupProgress>(
    message: DesktopOutgoingMessage & { id: string },
    requestOptions: RequestOptions<Progress>,
  ): Promise<T> {
    const client = clients.at(-1)
    if (!client) {
      return Promise.reject(
        new BridgeRequestError(
          "not_connected",
          "还没连上浏览器扩展。请打开浏览器，并在扩展设置的「桌面版」里打开「连接桌面版」",
        ),
      )
    }
    const idleMs = requestOptions.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    const maxMs = requestOptions.maxMs ?? MAX_REQUEST_MS

    return new Promise<T>((resolve, reject) => {
      let idleTimer: ReturnType<typeof setTimeout> | undefined
      const fail = () => {
        entry.clear()
        pending.delete(message.id)
        reject(
          new BridgeRequestError(
            "timeout",
            `查词超过 ${Math.round(idleMs / 1000)} 秒没有任何进展，可能是网络或模型卡住了，请重试`,
          ),
        )
      }
      const maxTimer = setTimeout(fail, maxMs)
      const entry: PendingRequest = {
        client,
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress: requestOptions.onProgress as PendingRequest["onProgress"],
        touch: () => {
          clearTimeout(idleTimer)
          idleTimer = setTimeout(fail, idleMs)
        },
        clear: () => {
          clearTimeout(idleTimer)
          clearTimeout(maxTimer)
        },
      }
      entry.touch()
      pending.set(message.id, entry)
      send(client, message)
    })
  }

  return {
    /** 开始监听；端口被占用时会抛出带原因的 BridgeRequestError（code = port_in_use） */
    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => {
          httpServer.off("listening", onListening)
          if (error.code === "EADDRINUSE") {
            reject(
              new BridgeRequestError(
                "port_in_use",
                `端口 ${options.port ?? BRIDGE_PORT} 被别的程序占用了，桌面版没法和浏览器扩展通信。`,
              ),
            )
          } else {
            reject(error)
          }
        }
        const onListening = () => {
          httpServer.off("error", onError)
          idleTimer = setInterval(
            () => {
              const now = Date.now()
              for (const client of [...clients]) {
                if (now - client.lastSeen > idleTimeoutMs) {
                  client.socket.terminate()
                }
              }
            },
            Math.min(idleTimeoutMs, 30_000),
          )
          resolve()
        }
        httpServer.once("error", onError)
        httpServer.once("listening", onListening)
        httpServer.listen(options.port ?? BRIDGE_PORT, host)
      })
    },

    async stop(): Promise<void> {
      if (idleTimer) {
        clearInterval(idleTimer)
        idleTimer = null
      }
      for (const socket of wss.clients) {
        socket.terminate()
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },

    /** 实际监听的端口（port 传 0 时由系统分配） */
    port(): number {
      const address = httpServer.address()
      return typeof address === "object" && address ? address.port : 0
    },

    getStatus,

    /**
     * 三下空格翻译。旧版扩展不认识这种请求（发过去它会直接丢掉，只能干等到超时），
     * 所以先看它握手时说没说支持，不支持就马上告诉用户去更新扩展。
     */
    translate(
      text: string,
      sourceTitle?: string,
      requestOptions: RequestOptions = {},
    ): Promise<TranslateResult> {
      const client = clients.at(-1)
      if (client && !client.features.includes("translate")) {
        return Promise.reject(
          new BridgeRequestError(
            "unsupported",
            "浏览器扩展版本太旧，还不支持三下空格翻译。请在 chrome://extensions 里重新加载大傻豪词典扩展",
          ),
        )
      }
      return request<TranslateResult>(
        { type: "translate", id: randomUUID(), text, sourceTitle },
        requestOptions,
      )
    },

    lookup(input: LookupRequest, requestOptions: RequestOptions = {}): Promise<LookupResult> {
      return request<LookupResult>({ type: "lookup", id: randomUUID(), ...input }, requestOptions)
    },

    /** actionId：存哪个动作的结果（划词工具栏上的动作）；不传就是内置词典 */
    save(
      fields: Record<string, unknown>,
      requestOptions: RequestOptions & { actionId?: string } = {},
    ): Promise<SaveResult> {
      const { actionId, ...rest } = requestOptions
      return request<SaveResult>(
        { type: "save", id: randomUUID(), fields, ...(actionId ? { actionId } : {}) },
        rest,
      )
    },

    /** 最近连上的扩展握手时报的所有功能（记日志用）；旧版扩展是空的 */
    clientFeatures(): string[] {
      return [...(clients.at(-1)?.features ?? [])]
    },

    /** 扩展握手时有没有说支持某件事；旧版扩展说不出来 */
    supports(feature: string): boolean {
      return clients.at(-1)?.features.includes(feature) ?? false
    },

    /** 划词工具栏的翻译按钮：按扩展「划词翻译」的设置，大模型时边写边出 */
    translateSelection(
      text: string,
      sourceTitle?: string,
      requestOptions: RequestOptions<SelectionTranslateProgress> = {},
    ): Promise<SelectionTranslateResult> {
      return request<SelectionTranslateResult, SelectionTranslateProgress>(
        { type: "translate", id: randomUUID(), text, sourceTitle, mode: "selection" },
        requestOptions,
      )
    },

    /** 划词工具栏上该放哪些按钮；很快，超时给短一点 */
    getToolbar(): Promise<ToolbarInfo> {
      return request<ToolbarInfo>({ type: "toolbar", id: randomUUID() }, { timeoutMs: 5_000 })
    },

    /**
     * 朗读：请扩展按它的朗读设置合成语音，和网页上是同一个声音。
     * 旧版扩展不认识这种请求，直接拒绝，由调用方改用系统语音。
     */
    speak(text: string): Promise<SpeakResult> {
      if (!clients.at(-1)?.features.includes("speak")) {
        return Promise.reject(new BridgeRequestError("unsupported", "浏览器扩展还不支持朗读"))
      }
      return request<SpeakResult>({ type: "speak", id: randomUUID(), text }, { timeoutMs: 20_000 })
    },

    /** 今天有几个词该复习（托盘显示、每天提醒一次）；旧版扩展不支持时直接拒绝 */
    reviewStatus(): Promise<ReviewStatus> {
      if (!clients.at(-1)?.features.includes("reviewStatus")) {
        return Promise.reject(new BridgeRequestError("unsupported", "浏览器扩展还不支持复习提醒"))
      }
      return request<ReviewStatus>(
        { type: "reviewStatus", id: randomUUID() },
        { timeoutMs: 10_000 },
      )
    },

    /** 在浏览器里打开扩展的闪卡复习页 */
    openReview(): Promise<{ opened: true }> {
      if (!clients.at(-1)?.features.includes("reviewStatus")) {
        return Promise.reject(new BridgeRequestError("unsupported", "浏览器扩展还不支持复习提醒"))
      }
      return request<{ opened: true }>(
        { type: "openReview", id: randomUUID() },
        { timeoutMs: 10_000 },
      )
    },
  }
}

export type BridgeServer = ReturnType<typeof createBridgeServer>
export type { BridgeErrorPayload }
