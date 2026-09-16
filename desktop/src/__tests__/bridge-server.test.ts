import type { BridgeServer, BridgeStatus } from "../bridge-server"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import {
  BridgeRequestError,
  CLOSE_BAD_HELLO,
  CLOSE_PROTOCOL_MISMATCH,
  createBridgeServer,
  isAllowedOrigin,
} from "../bridge-server"
import { BRIDGE_PATH, EXTENSION_CLIENT_ID, PROTOCOL_VERSION } from "../protocol"

const EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
const HELLO = {
  type: "hello",
  client: EXTENSION_CLIENT_ID,
  version: "1.0.3",
  protocol: PROTOCOL_VERSION,
  features: ["lookup", "lookupProgress", "save", "translate"],
}

let server: BridgeServer | null = null
const openSockets: WebSocket[] = []

afterEach(async () => {
  for (const socket of openSockets.splice(0)) {
    socket.terminate()
  }
  await server?.stop()
  server = null
})

async function startServer(options: Parameters<typeof createBridgeServer>[0] = {}) {
  const statuses: BridgeStatus[] = []
  server = createBridgeServer({
    port: 0,
    onStatusChange: (status) => statuses.push(status),
    ...options,
  })
  await server.start()
  return { server, statuses }
}

/** 假扩展：用给定的来源连上来，把收到的消息记下来 */
function connect(
  origin: string | undefined = EXTENSION_ORIGIN,
  path = BRIDGE_PATH,
): Promise<{ socket: WebSocket; received: Record<string, unknown>[] }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${server!.port()}${path}`, { origin })
    openSockets.push(socket)
    const received: Record<string, unknown>[] = []
    socket.on("message", (data) => received.push(JSON.parse(data.toString())))
    socket.once("open", () => resolve({ socket, received }))
    socket.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)))
    socket.once("error", reject)
  })
}

function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) {
        resolve()
      } else if (Date.now() - started > timeoutMs) {
        reject(new Error("waitFor timed out"))
      } else {
        setTimeout(tick, 5)
      }
    }
    tick()
  })
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once("close", (code) => resolve(code)))
}

/** 连上并完成握手，等服务端把它登记为已连接 */
async function connectReady() {
  const connection = await connect()
  connection.socket.send(JSON.stringify(HELLO))
  await waitFor(() => server!.getStatus().connected)
  return connection
}

describe("来源校验", () => {
  it.each([
    ["Chrome / Edge 扩展", "chrome-extension://abcdefghijklmnopabcdefghijklmnop", true],
    ["Firefox 扩展", "moz-extension://1b2c3d4e-0000-4000-8000-123456789abc", true],
    ["普通网站", "https://evil.example", false],
    ["本机网页", "http://127.0.0.1:3000", false],
    ["null 来源", "null", false],
    ["没有来源", undefined, false],
    ["伪装成扩展前缀的网址", "https://chrome-extension.example.com", false],
  ])("%s", (_label, origin, allowed) => {
    expect(isAllowedOrigin(origin)).toBe(allowed)
  })

  it("网页发起的连接在握手前就被拒绝（403）", async () => {
    await startServer()
    await expect(connect("https://evil.example")).rejects.toThrow("HTTP 403")
  })

  it("路径不对也拒绝（404）", async () => {
    await startServer()
    await expect(connect(EXTENSION_ORIGIN, "/other")).rejects.toThrow("HTTP 404")
  })
})

describe("握手", () => {
  it("发了 hello 才算连上，状态里带着扩展版本", async () => {
    const { statuses } = await startServer()
    const { socket } = await connect()
    expect(server!.getStatus().connected).toBe(false)

    socket.send(JSON.stringify(HELLO))
    await waitFor(() => statuses.length > 0)

    expect(statuses.at(-1)).toEqual({
      connected: true,
      extensionVersion: "1.0.3",
      clientCount: 1,
      lastError: null,
    })
  })

  it("第一条消息不是 hello，直接断开", async () => {
    await startServer()
    const { socket } = await connect()
    const closed = waitForClose(socket)
    socket.send(JSON.stringify({ type: "ping" }))
    expect(await closed).toBe(CLOSE_BAD_HELLO)
  })

  it("自报的身份不对，直接断开", async () => {
    await startServer()
    const { socket } = await connect()
    const closed = waitForClose(socket)
    socket.send(JSON.stringify({ ...HELLO, client: "someone-else" }))
    expect(await closed).toBe(CLOSE_BAD_HELLO)
  })

  it("一直不发 hello，超时断开", async () => {
    await startServer({ helloTimeoutMs: 50 })
    const { socket } = await connect()
    expect(await waitForClose(socket)).toBe(CLOSE_BAD_HELLO)
  })

  it("协议版本对不上：断开，并在状态里说明该更新哪一边", async () => {
    const { statuses } = await startServer()
    const { socket } = await connect()
    const closed = waitForClose(socket)
    socket.send(JSON.stringify({ ...HELLO, version: "2.0.0", protocol: PROTOCOL_VERSION + 1 }))

    expect(await closed).toBe(CLOSE_PROTOCOL_MISMATCH)
    expect(statuses.at(-1)).toMatchObject({ connected: false })
    expect(statuses.at(-1)?.lastError).toContain("请更新桌面程序")
  })

  it("断开后状态回到未连接", async () => {
    const { statuses } = await startServer()
    const { socket } = await connectReady()
    socket.close()
    await waitFor(() => statuses.at(-1)?.connected === false)
    expect(server!.getStatus().clientCount).toBe(0)
  })
})

describe("保活", () => {
  it("收到 ping 回 pong", async () => {
    await startServer()
    const { socket, received } = await connectReady()
    socket.send(JSON.stringify({ type: "ping" }))
    await waitFor(() => received.length > 0)
    expect(received).toEqual([{ type: "pong" }])
  })

  it("太久没动静的连接会被清掉", async () => {
    await startServer({ idleTimeoutMs: 60 })
    const { socket } = await connectReady()
    await waitForClose(socket)
    // 客户端先看到断开，服务端稍后才处理完，所以要等一下
    await waitFor(() => !server!.getStatus().connected)
  })
})

describe("查词和存词", () => {
  it("查词：请求带着 id 发给扩展，扩展回同一个 id 就拿到结果", async () => {
    await startServer()
    const { socket, received } = await connectReady()
    const result = { fields: { 词条: "obtain" }, outputSchema: [], fast: true }

    const pending = server!.lookup({
      text: "obtain",
      context: "You must obtain it.",
      sourceTitle: "QQ",
    })
    await waitFor(() => received.length > 0)
    const request = received[0]
    expect(request).toMatchObject({
      type: "lookup",
      text: "obtain",
      context: "You must obtain it.",
      sourceTitle: "QQ",
    })
    socket.send(JSON.stringify({ type: "lookupResult", id: request.id, ok: true, result }))

    await expect(pending).resolves.toEqual(result)
  })

  it("存词：扩展报的错原样变成 BridgeRequestError", async () => {
    await startServer()
    const { socket, received } = await connectReady()

    const pending = server!.save({ 词条: "obtain" })
    await waitFor(() => received.length > 0)
    expect(received[0]).toMatchObject({ type: "save", fields: { 词条: "obtain" } })
    socket.send(
      JSON.stringify({
        type: "saveResult",
        id: received[0].id,
        ok: false,
        error: { code: "mapping_invalid", message: "生词本的列对不上" },
      }),
    )

    const error = await pending.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BridgeRequestError)
    expect(error).toMatchObject({ code: "mapping_invalid", message: "生词本的列对不上" })
  })

  it("没连上扩展时立刻失败，并告诉用户怎么连", async () => {
    await startServer()
    await expect(server!.lookup({ text: "obtain" })).rejects.toMatchObject({
      code: "not_connected",
    })
  })

  it("扩展一直不回，超时失败", async () => {
    await startServer()
    await connectReady()
    await expect(server!.lookup({ text: "obtain" }, { timeoutMs: 50 })).rejects.toMatchObject({
      code: "timeout",
    })
  })

  it("大模型边写边发进度：进度交给调用方，每来一次都重新计时，慢也不会中途超时", async () => {
    await startServer()
    const { socket, received } = await connectReady()
    const progresses: unknown[] = []
    const pending = server!.lookup(
      { text: "obtain" },
      { timeoutMs: 120, onProgress: (progress) => progresses.push(progress) },
    )
    await waitFor(() => received.length > 0)
    const id = received[0].id
    const progress = {
      fields: { 词条: "ob" },
      outputSchema: [{ name: "词条", type: "string", speaking: true }],
      thinking: null,
    }
    // 一共拖了 300 毫秒，远超 120 毫秒的空闲上限，但一直在来进度
    for (let i = 0; i < 5; i++) {
      await sleep(60)
      socket.send(JSON.stringify({ type: "lookupProgress", id, progress }))
    }
    const result = { fields: { 词条: "obtain" }, outputSchema: [], fast: false }
    socket.send(JSON.stringify({ type: "lookupResult", id, ok: true, result }))

    await expect(pending).resolves.toEqual(result)
    expect(progresses).toHaveLength(5)
    expect(progresses[0]).toEqual(progress)
  })

  it("一直有进度也有总时长上限，不会无限等下去", async () => {
    await startServer()
    const { socket, received } = await connectReady()
    const pending = server!.lookup({ text: "obtain" }, { timeoutMs: 100, maxMs: 200 })
    await waitFor(() => received.length > 0)
    const id = received[0].id
    const progress = { fields: {}, outputSchema: [], thinking: null }
    const timer = setInterval(
      () => socket.send(JSON.stringify({ type: "lookupProgress", id, progress })),
      40,
    )
    await expect(pending).rejects.toMatchObject({ code: "timeout" })
    clearInterval(timer)
  })

  it("别的请求的进度不算数", async () => {
    await startServer()
    const { socket, received } = await connectReady()
    const progresses: unknown[] = []
    const pending = server!.lookup(
      { text: "obtain" },
      { timeoutMs: 100, onProgress: (progress) => progresses.push(progress) },
    )
    await waitFor(() => received.length > 0)
    const progress = { fields: {}, outputSchema: [], thinking: null }
    socket.send(JSON.stringify({ type: "lookupProgress", id: "someone-else", progress }))
    await expect(pending).rejects.toMatchObject({ code: "timeout" })
    expect(progresses).toEqual([])
  })

  it("等回复时扩展断了，马上失败而不是干等到超时", async () => {
    await startServer()
    const { socket, received } = await connectReady()
    const pending = server!.lookup({ text: "obtain" })
    await waitFor(() => received.length > 0)
    socket.close()
    await expect(pending).rejects.toMatchObject({ code: "disconnected" })
  })

  it("对不上号的回复、乱七八糟的消息都忽略，不影响后面的请求", async () => {
    await startServer()
    const { socket, received } = await connectReady()
    const pending = server!.lookup({ text: "obtain" })
    await waitFor(() => received.length > 0)

    socket.send("not json")
    socket.send(JSON.stringify({ type: "lookupResult", id: "someone-else", ok: true, result: {} }))
    socket.send(JSON.stringify({ type: "delete-everything" }))
    const result = { fields: {}, outputSchema: [], fast: false }
    socket.send(JSON.stringify({ type: "lookupResult", id: received[0].id, ok: true, result }))

    await expect(pending).resolves.toEqual(result)
  })

  it("两个浏览器都连着时，请求发给最近连上的那个", async () => {
    await startServer()
    const first = await connectReady()
    const second = await connect()
    second.socket.send(JSON.stringify({ ...HELLO, version: "1.0.4" }))
    await waitFor(() => server!.getStatus().clientCount === 2)
    expect(server!.getStatus().extensionVersion).toBe("1.0.4")

    void server!.lookup({ text: "obtain" }, { timeoutMs: 50 }).catch(() => {})
    await waitFor(() => second.received.length > 0)
    expect(first.received).toEqual([])
  })
})

describe("三下空格翻译", () => {
  it("文字和来源发给扩展，扩展回同一个 id 就拿到译文", async () => {
    await startServer()
    const { socket, received } = await connectReady()
    const result = { text: "Hello world", from: "cmn", to: "eng" }

    const pending = server!.translate("你好世界", "QQ")
    await waitFor(() => received.length > 0)
    expect(received[0]).toMatchObject({ type: "translate", text: "你好世界", sourceTitle: "QQ" })
    socket.send(JSON.stringify({ type: "translateResult", id: received[0].id, ok: true, result }))

    await expect(pending).resolves.toEqual(result)
  })

  it("扩展报的错原样变成 BridgeRequestError", async () => {
    await startServer()
    const { socket, received } = await connectReady()
    const pending = server!.translate("你好")
    await waitFor(() => received.length > 0)
    socket.send(
      JSON.stringify({
        type: "translateResult",
        id: received[0].id,
        ok: false,
        error: { code: "same_language", message: "原文和译文语言一样" },
      }),
    )
    await expect(pending).rejects.toMatchObject({ code: "same_language" })
  })

  it("旧版扩展（握手时没说支持翻译）：不发过去干等，直接提示更新扩展", async () => {
    await startServer()
    const { socket, received } = await connect()
    const { features: _features, ...oldHello } = HELLO
    socket.send(JSON.stringify(oldHello))
    await waitFor(() => server!.getStatus().connected)

    await expect(server!.translate("你好")).rejects.toMatchObject({ code: "unsupported" })
    expect(received).toEqual([])
  })
})

describe("朗读", () => {
  it("扩展支持朗读时，把文字交过去、拿回合成好的音频", async () => {
    await startServer()
    const { socket, received } = await connect()
    socket.send(JSON.stringify({ ...HELLO, features: [...HELLO.features, "speak"] }))
    await waitFor(() => server!.getStatus().connected)
    const audio = { audioBase64: "AQID", contentType: "audio/mpeg" }

    const pending = server!.speak("obtain")
    await waitFor(() => received.length > 0)
    expect(received[0]).toMatchObject({ type: "speak", text: "obtain" })
    socket.send(
      JSON.stringify({ type: "speakResult", id: received[0]!.id, ok: true, result: audio }),
    )

    await expect(pending).resolves.toEqual(audio)
  })

  it("旧版扩展不会朗读：直接拒绝（改用系统语音），不发过去干等", async () => {
    await startServer()
    const { received } = await connectReady()

    await expect(server!.speak("obtain")).rejects.toMatchObject({ code: "unsupported" })
    await sleep(50)
    expect(received).toHaveLength(0)
  })
})

describe("复习提醒", () => {
  it("问扩展今天有几个词该复习；点提醒时请它打开复习页", async () => {
    await startServer()
    const { socket, received } = await connect()
    socket.send(JSON.stringify({ ...HELLO, features: [...HELLO.features, "reviewStatus"] }))
    await waitFor(() => server!.getStatus().connected)
    const status = { due: 12, newCount: 5, reviewCount: 7 }

    const pendingStatus = server!.reviewStatus()
    await waitFor(() => received.length > 0)
    expect(received[0]).toMatchObject({ type: "reviewStatus" })
    socket.send(
      JSON.stringify({ type: "reviewStatusResult", id: received[0]!.id, ok: true, result: status }),
    )
    await expect(pendingStatus).resolves.toEqual(status)

    const pendingOpen = server!.openReview()
    await waitFor(() => received.length > 1)
    expect(received[1]).toMatchObject({ type: "openReview" })
    socket.send(
      JSON.stringify({
        type: "openReviewResult",
        id: received[1]!.id,
        ok: true,
        result: { opened: true },
      }),
    )
    await expect(pendingOpen).resolves.toEqual({ opened: true })
  })

  it("旧版扩展不会：直接拒绝，不发过去干等", async () => {
    await startServer()
    const { received } = await connectReady()

    await expect(server!.reviewStatus()).rejects.toMatchObject({ code: "unsupported" })
    await expect(server!.openReview()).rejects.toMatchObject({ code: "unsupported" })
    await sleep(50)
    expect(received).toHaveLength(0)
  })
})

describe("划词工具栏", () => {
  it("问扩展工具栏上该放哪些按钮", async () => {
    await startServer()
    const { socket, received } = await connectReady()
    const toolbar = {
      translate: true,
      speak: false,
      actions: [{ id: "dictionary", name: "词典", icon: "tabler:book-2", isDictionary: true }],
    }

    const pending = server!.getToolbar()
    await waitFor(() => received.length > 0)
    expect(received[0]).toMatchObject({ type: "toolbar" })
    socket.send(
      JSON.stringify({ type: "toolbarResult", id: received[0].id, ok: true, result: toolbar }),
    )

    await expect(pending).resolves.toEqual(toolbar)
  })

  it("划词翻译：请求带 selection 模式，进度转给调用方，最后拿到译文", async () => {
    await startServer()
    const { socket, received } = await connectReady()
    const progresses: unknown[] = []

    const pending = server!.translateSelection("hello", "QQ", {
      onProgress: (progress) => progresses.push(progress),
    })
    await waitFor(() => received.length > 0)
    const id = received[0].id
    expect(received[0]).toMatchObject({ type: "translate", text: "hello", mode: "selection" })
    socket.send(
      JSON.stringify({ type: "translateProgress", id, progress: { text: "你", thinking: null } }),
    )
    socket.send(
      JSON.stringify({
        type: "translateResult",
        id,
        ok: true,
        result: { text: "你好", fast: false },
      }),
    )

    await expect(pending).resolves.toEqual({ text: "你好", fast: false })
    expect(progresses).toEqual([{ text: "你", thinking: null }])
  })

  it("存某个动作的结果：请求里带上动作 id；不带就是内置词典", async () => {
    await startServer()
    const { received } = await connectReady()
    void server!.save({ 结果: "Hello" }, { actionId: "polish", timeoutMs: 50 }).catch(() => {})
    void server!.save({ 词条: "obtain" }, { timeoutMs: 50 }).catch(() => {})
    await waitFor(() => received.length >= 2)
    expect(received[0]).toMatchObject({ type: "save", actionId: "polish" })
    expect(received[1]).not.toHaveProperty("actionId")
  })

  it("supports：看扩展握手时说了能办哪些事", async () => {
    await startServer()
    await connectReady()
    expect(server!.supports("translate")).toBe(true)
    expect(server!.supports("toolbar")).toBe(false)
    expect(server!.clientFeatures()).toEqual(HELLO.features)
  })
})

describe("端口", () => {
  it("端口被占用时给出能看懂的原因", async () => {
    const { server: first } = await startServer()
    const second = createBridgeServer({ port: first.port() })
    await expect(second.start()).rejects.toMatchObject({ code: "port_in_use" })
  })
})
