import type { BridgeSocket } from "../bridge"
import type { DailyGoalResult } from "../daily-goal"
import type { DesktopLookupProgress, DesktopLookupResult } from "../dictionary-lookup"
import type { DesktopTranslateResult } from "../input-translate"
import type { DesktopReviewStatus } from "../review-status"
import type { DesktopSaveResult } from "../save-word"
import type {
  DesktopSelectionTranslateProgress,
  DesktopSelectionTranslateResult,
} from "../selection-translate"
import type { DesktopSpeakResult } from "../speak"
import type { DesktopToolbarInfo } from "../toolbar"
import type { DesktopBridgeStatus } from "@/utils/constants/desktop-bridge"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createDesktopBridge,
  PING_INTERVAL_MS,
  PROGRESS_INTERVAL_MS,
  RECONNECT_DELAYS_MS,
} from "../bridge"
import {
  MAX_LOOKUP_TEXT_LENGTH,
  MAX_SPEAK_TEXT_LENGTH,
  MAX_TRANSLATE_TEXT_LENGTH,
} from "../protocol"

/** 假的 socket：记录发出去的消息，由测试手动触发连上、收到消息、断开 */
class FakeSocket implements BridgeSocket {
  readyState = 0
  sent: Record<string, unknown>[] = []
  onopen: (() => void) | null = null
  onmessage: ((data: unknown) => void) | null = null
  onclose: (() => void) | null = null

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }

  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.onclose?.()
  }

  open() {
    this.readyState = 1
    this.onopen?.()
  }

  receive(message: unknown) {
    this.onmessage?.(typeof message === "string" ? message : JSON.stringify(message))
  }

  /** 对方没开或连接被切断 */
  drop() {
    this.readyState = 3
    this.onclose?.()
  }
}

const LOOKUP_RESULT: DesktopLookupResult = {
  fields: { 词条: "obtain", 释义: "获得" },
  outputSchema: [{ name: "词条", type: "string", speaking: true }],
  fast: true,
}

function progressOf(fields: Record<string, unknown>): DesktopLookupProgress {
  return { fields, outputSchema: LOOKUP_RESULT.outputSchema, thinking: null }
}
const SAVE_RESULT: DesktopSaveResult = {
  notebaseId: "nb-1",
  createdNotebase: false,
  duplicate: false,
}
const SPEAK_RESULT: DesktopSpeakResult = { audioBase64: "AQID", contentType: "audio/mpeg" }
const REVIEW_STATUS: DesktopReviewStatus = { due: 12, newCount: 5, reviewCount: 7 }
const TRANSLATE_RESULT: DesktopTranslateResult = { text: "Hello", from: "cmn", to: "eng" }
const TOOLBAR: DesktopToolbarInfo = {
  translate: true,
  speak: true,
  actions: [{ id: "dictionary", name: "词典", icon: "tabler:book-2", isDictionary: true }],
}

/** 查词存词是异步的，回复要等几轮微任务才发出去 */
async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

function setup() {
  const sockets: FakeSocket[] = []
  const statuses: DesktopBridgeStatus[] = []
  const lookup = vi.fn<(...args: any[]) => Promise<DesktopLookupResult>>(async () => LOOKUP_RESULT)
  const save = vi.fn<(...args: any[]) => Promise<DesktopSaveResult>>(async () => SAVE_RESULT)
  const translateSelection = vi.fn<(...args: any[]) => Promise<DesktopSelectionTranslateResult>>(
    async () => ({ text: "你好", fast: true }),
  )
  const getToolbar = vi.fn<() => Promise<DesktopToolbarInfo>>(async () => TOOLBAR)
  const translate = vi.fn<(...args: any[]) => Promise<DesktopTranslateResult>>(
    async () => TRANSLATE_RESULT,
  )
  const speak = vi.fn<(...args: any[]) => Promise<DesktopSpeakResult>>(async () => SPEAK_RESULT)
  const reviewStatus = vi.fn<() => Promise<DesktopReviewStatus>>(async () => REVIEW_STATUS)
  const openReview = vi.fn<() => Promise<{ opened: true }>>(async () => ({ opened: true }))
  const dailyGoal = vi.fn<(...args: any[]) => Promise<DailyGoalResult>>(async () => ({
    status: { doneToday: 3, available: 7 },
  }))
  const bridge = createDesktopBridge({
    url: "ws://127.0.0.1:1/test",
    version: "9.9.9",
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    lookup,
    save,
    translate,
    translateSelection,
    getToolbar,
    speak,
    reviewStatus,
    openReview,
    dailyGoal,
    setStatus: (status) => statuses.push(status),
    now: () => 1234,
  })
  const latest = () => sockets.at(-1)!
  /** 除掉握手的 hello 和保活的 ping，只看业务回复 */
  const replies = () => latest().sent.filter((m) => m.type !== "hello" && m.type !== "ping")
  return {
    bridge,
    sockets,
    statuses,
    lookup,
    save,
    translate,
    translateSelection,
    getToolbar,
    speak,
    reviewStatus,
    openReview,
    dailyGoal,
    latest,
    replies,
  }
}

describe("桌面版连接桥", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("握手", () => {
    it("连上后先自报家门，并把状态标成已连接", () => {
      const { bridge, latest, statuses } = setup()
      bridge.start()
      latest().open()

      expect(latest().sent[0]).toEqual({
        type: "hello",
        client: "yangzihao-dic-extension",
        version: "9.9.9",
        protocol: 1,
        features: [
          "lookup",
          "lookupProgress",
          "save",
          "translate",
          "toolbar",
          "selectionTranslate",
          "customActions",
          "speak",
          "reviewStatus",
          "dailyGoal",
        ],
      })
      expect(statuses.at(-1)).toEqual({ connected: true, lastConnectedAt: 1234 })
    })

    it("开关没打开时什么都不做（没装桌面版的人不会看到连接错误）", () => {
      const { bridge, sockets } = setup()
      bridge.ensureConnected()
      expect(sockets).toHaveLength(0)
    })
  })

  describe("查词", () => {
    it("把词、上下文、来源标题交给查词服务，回复带上同一个 id", async () => {
      const { bridge, latest, lookup, replies } = setup()
      bridge.start()
      latest().open()

      latest().receive({
        type: "lookup",
        id: "req-1",
        text: "obtain",
        context: "You must obtain a permit.",
        sourceTitle: "QQ",
      })
      await flush()

      expect(lookup).toHaveBeenCalledWith(
        {
          text: "obtain",
          context: "You must obtain a permit.",
          sourceTitle: "QQ",
        },
        { onProgress: expect.any(Function) },
      )
      expect(replies()).toEqual([
        { type: "lookupResult", id: "req-1", ok: true, result: LOOKUP_RESULT },
      ])
    })

    it("查词服务报的错原样转给桌面，桌面弹窗能直接显示原因", async () => {
      const { bridge, latest, lookup, replies } = setup()
      lookup.mockRejectedValueOnce(
        Object.assign(new Error("词典用的翻译服务不可用"), { code: "provider_unavailable" }),
      )
      bridge.start()
      latest().open()

      latest().receive({ type: "lookup", id: "req-2", text: "obtain" })
      await flush()

      expect(replies()).toEqual([
        {
          type: "lookupResult",
          id: "req-2",
          ok: false,
          error: { code: "provider_unavailable", message: "词典用的翻译服务不可用" },
        },
      ])
    })

    it("意外错误统一成 internal_error，原因前加上「查词失败」", async () => {
      const { bridge, latest, lookup, replies } = setup()
      lookup.mockRejectedValueOnce(new Error("网络断了"))
      bridge.start()
      latest().open()

      latest().receive({ type: "lookup", id: "req-3", text: "obtain" })
      await flush()

      expect(replies()[0]).toMatchObject({
        ok: false,
        error: { code: "internal_error", message: "查词失败：网络断了" },
      })
    })

    it("选中的文字太长就直接说明，不去浪费一次查词", async () => {
      const { bridge, latest, lookup, replies } = setup()
      bridge.start()
      latest().open()

      latest().receive({
        type: "lookup",
        id: "req-4",
        text: "a".repeat(MAX_LOOKUP_TEXT_LENGTH + 1),
      })
      await flush()

      expect(lookup).not.toHaveBeenCalled()
      expect(replies()[0]).toMatchObject({
        id: "req-4",
        ok: false,
        error: { code: "text_too_long" },
      })
    })
  })

  describe("重新生成", () => {
    it("带着 fresh 交给查词服务，这次就不用上次查过的结果", async () => {
      const { bridge, latest, lookup } = setup()
      bridge.start()
      latest().open()

      latest().receive({ type: "lookup", id: "req-f", text: "obtain", fresh: true })
      await flush()

      expect(lookup).toHaveBeenCalledWith(
        expect.objectContaining({ text: "obtain", fresh: true }),
        {
          onProgress: expect.any(Function),
        },
      )
    })
  })

  describe("朗读", () => {
    it("交给朗读服务，把合成好的音频回给桌面", async () => {
      const { bridge, latest, speak, replies } = setup()
      bridge.start()
      latest().open()

      latest().receive({ type: "speak", id: "req-s", text: "obtain" })
      await flush()

      expect(speak).toHaveBeenCalledWith({ text: "obtain" })
      expect(replies()).toEqual([
        { type: "speakResult", id: "req-s", ok: true, result: SPEAK_RESULT },
      ])
    })

    it("文字太长就直接说明，不去合成", async () => {
      const { bridge, latest, speak, replies } = setup()
      bridge.start()
      latest().open()

      latest().receive({ type: "speak", id: "req-l", text: "a".repeat(MAX_SPEAK_TEXT_LENGTH + 1) })
      await flush()

      expect(speak).not.toHaveBeenCalled()
      expect(replies()[0]).toMatchObject({ ok: false, error: { code: "text_too_long" } })
    })

    it("合成失败的原因原样转给桌面", async () => {
      const { bridge, latest, speak, replies } = setup()
      speak.mockRejectedValueOnce(
        Object.assign(new Error("朗读合成失败：断网"), { code: "synthesize_failed" }),
      )
      bridge.start()
      latest().open()

      latest().receive({ type: "speak", id: "req-e", text: "obtain" })
      await flush()

      expect(replies()[0]).toMatchObject({
        type: "speakResult",
        ok: false,
        error: { code: "synthesize_failed", message: "朗读合成失败：断网" },
      })
    })
  })

  describe("复习提醒", () => {
    it("问今天有几个词该复习，把数字回给桌面", async () => {
      const { bridge, latest, reviewStatus, replies } = setup()
      bridge.start()
      latest().open()

      latest().receive({ type: "reviewStatus", id: "req-r" })
      await flush()

      expect(reviewStatus).toHaveBeenCalledTimes(1)
      expect(replies()).toEqual([
        { type: "reviewStatusResult", id: "req-r", ok: true, result: REVIEW_STATUS },
      ])
    })

    it("点了提醒：打开复习页", async () => {
      const { bridge, latest, openReview, replies } = setup()
      bridge.start()
      latest().open()

      latest().receive({ type: "openReview", id: "req-o" })
      await flush()

      expect(openReview).toHaveBeenCalledTimes(1)
      expect(replies()).toEqual([
        { type: "openReviewResult", id: "req-o", ok: true, result: { opened: true } },
      ])
    })

    it("每日必学：把请求（不含 type 和 id）交给出题服务，结果带 id 回去", async () => {
      const { bridge, latest, dailyGoal, replies } = setup()
      bridge.start()
      latest().open()

      latest().receive({ type: "dailyGoal", id: "req-g", action: "next", exclude: ["c1"] })
      await flush()

      expect(dailyGoal).toHaveBeenCalledWith({ action: "next", exclude: ["c1"] })
      expect(replies()).toEqual([
        {
          type: "dailyGoalResult",
          id: "req-g",
          ok: true,
          result: { status: { doneToday: 3, available: 7 } },
        },
      ])
    })

    it("每日必学：答题消息格式不对就丢弃，不会交给出题服务", async () => {
      const { bridge, latest, dailyGoal, replies } = setup()
      bridge.start()
      latest().open()

      latest().receive({ type: "dailyGoal", id: "bad", action: "answer", cardId: "c1" })
      await flush()

      expect(dailyGoal).not.toHaveBeenCalled()
      expect(replies()).toEqual([])
    })

    it("读不到时把原因转给桌面", async () => {
      const { bridge, latest, reviewStatus, replies } = setup()
      reviewStatus.mockRejectedValueOnce(new Error("存储坏了"))
      bridge.start()
      latest().open()

      latest().receive({ type: "reviewStatus", id: "req-x" })
      await flush()

      expect(replies()[0]).toMatchObject({
        ok: false,
        error: { code: "internal_error", message: "读取复习进度失败：存储坏了" },
      })
    })
  })

  describe("查词进度", () => {
    function startSlowLookup() {
      const ctx = setup()
      let onProgress: (progress: DesktopLookupProgress) => void = () => {}
      let finish: (result: DesktopLookupResult) => void = () => {}
      ctx.lookup.mockImplementationOnce(
        (_request: unknown, options: { onProgress: typeof onProgress }) => {
          onProgress = options.onProgress
          return new Promise<DesktopLookupResult>((resolve) => {
            finish = resolve
          })
        },
      )
      ctx.bridge.start()
      ctx.latest().open()
      ctx.latest().receive({ type: "lookup", id: "req-p", text: "obtain" })
      return {
        ...ctx,
        progress: (fields: Record<string, unknown>) => onProgress(progressOf(fields)),
        finish: (result: DesktopLookupResult) => finish(result),
      }
    }

    it("大模型边生成边转给桌面，最后再发完整结果", async () => {
      const { progress, finish, replies } = startSlowLookup()
      await flush()

      progress({ 词条: "ob" })
      expect(replies()).toEqual([
        { type: "lookupProgress", id: "req-p", progress: progressOf({ 词条: "ob" }) },
      ])

      finish(LOOKUP_RESULT)
      await flush()
      expect(replies().at(-1)).toEqual({
        type: "lookupResult",
        id: "req-p",
        ok: true,
        result: LOOKUP_RESULT,
      })
    })

    it("进度太密时攒一下，只发最新的那份", async () => {
      const { progress, replies } = startSlowLookup()
      await flush()

      progress({ 词条: "o" })
      progress({ 词条: "ob" })
      progress({ 词条: "obt" })
      expect(replies()).toHaveLength(1)

      vi.advanceTimersByTime(PROGRESS_INTERVAL_MS)
      expect(replies()).toEqual([
        { type: "lookupProgress", id: "req-p", progress: progressOf({ 词条: "o" }) },
        { type: "lookupProgress", id: "req-p", progress: progressOf({ 词条: "obt" }) },
      ])
    })

    it("完整结果发出后，攒着没发的进度作废，不会跟在结果后面", async () => {
      const { progress, finish, replies } = startSlowLookup()
      await flush()

      progress({ 词条: "o" })
      progress({ 词条: "ob" })
      finish(LOOKUP_RESULT)
      await flush()
      vi.advanceTimersByTime(PROGRESS_INTERVAL_MS * 3)
      progress({ 词条: "late" })

      expect(replies().map((m) => m.type)).toEqual(["lookupProgress", "lookupResult"])
    })
  })

  describe("三下空格翻译", () => {
    it("把文字和来源交给翻译服务，回复带上同一个 id", async () => {
      const { bridge, latest, translate, replies } = setup()
      bridge.start()
      latest().open()

      latest().receive({ type: "translate", id: "t-1", text: "你好", sourceTitle: "QQ" })
      await flush()

      expect(translate).toHaveBeenCalledWith({ text: "你好", sourceTitle: "QQ" })
      expect(replies()).toEqual([
        { type: "translateResult", id: "t-1", ok: true, result: TRANSLATE_RESULT },
      ])
    })

    it("翻译失败时原因前加上「翻译失败」", async () => {
      const { bridge, latest, translate, replies } = setup()
      translate.mockRejectedValueOnce(new Error("网络断了"))
      bridge.start()
      latest().open()

      latest().receive({ type: "translate", id: "t-2", text: "你好" })
      await flush()

      expect(replies()[0]).toMatchObject({
        type: "translateResult",
        ok: false,
        error: { code: "internal_error", message: "翻译失败：网络断了" },
      })
    })

    it("文字太长就直接说明，不去翻", async () => {
      const { bridge, latest, translate, replies } = setup()
      bridge.start()
      latest().open()

      latest().receive({
        type: "translate",
        id: "t-3",
        text: "字".repeat(MAX_TRANSLATE_TEXT_LENGTH + 1),
      })
      await flush()

      expect(translate).not.toHaveBeenCalled()
      expect(replies()[0]).toMatchObject({ id: "t-3", ok: false, error: { code: "text_too_long" } })
    })
  })

  describe("划词工具栏", () => {
    it("回复工具栏该放哪些按钮", async () => {
      const { bridge, latest, replies } = setup()
      bridge.start()
      latest().open()

      latest().receive({ type: "toolbar", id: "tb-1" })
      await flush()

      expect(replies()).toEqual([{ type: "toolbarResult", id: "tb-1", ok: true, result: TOOLBAR }])
    })

    it("点了工具栏上的某个动作：查词、存词都带上这个动作的 id", async () => {
      const { bridge, latest, lookup, save } = setup()
      bridge.start()
      latest().open()

      latest().receive({ type: "lookup", id: "a-1", text: "hello", actionId: "polish" })
      latest().receive({ type: "save", id: "a-2", fields: { 结果: "Hello" }, actionId: "polish" })
      await flush()

      expect(lookup).toHaveBeenCalledWith(
        { text: "hello", actionId: "polish" },
        { onProgress: expect.any(Function) },
      )
      expect(save).toHaveBeenCalledWith({ 结果: "Hello" }, "polish")
    })

    it("划词翻译：不走三下空格那套设置，边写边转进度，最后发完整译文", async () => {
      const { bridge, latest, translate, translateSelection, replies } = setup()
      translateSelection.mockImplementationOnce(
        async (
          _request: unknown,
          options: { onProgress: (progress: DesktopSelectionTranslateProgress) => void },
        ) => {
          options.onProgress({ text: "你", thinking: null })
          return { text: "你好", fast: false }
        },
      )
      bridge.start()
      latest().open()

      latest().receive({ type: "translate", id: "s-1", text: "hello", mode: "selection" })
      await flush()

      expect(translate).not.toHaveBeenCalled()
      expect(translateSelection).toHaveBeenCalledWith(
        { text: "hello" },
        { onProgress: expect.any(Function) },
      )
      expect(replies()).toEqual([
        { type: "translateProgress", id: "s-1", progress: { text: "你", thinking: null } },
        { type: "translateResult", id: "s-1", ok: true, result: { text: "你好", fast: false } },
      ])
    })
  })

  describe("存词", () => {
    it("把字段交给存词服务，回复带上同一个 id", async () => {
      const { bridge, latest, save, replies } = setup()
      bridge.start()
      latest().open()

      latest().receive({ type: "save", id: "req-5", fields: { 词条: "obtain" } })
      await flush()

      // 没指定动作：第二个参数空着，由存词服务默认成内置词典
      expect(save).toHaveBeenCalledWith({ 词条: "obtain" }, undefined)
      expect(replies()).toEqual([
        { type: "saveResult", id: "req-5", ok: true, result: SAVE_RESULT },
      ])
    })

    it("存词失败时原因前加上「存词失败」", async () => {
      const { bridge, latest, save, replies } = setup()
      save.mockRejectedValueOnce(new Error("磁盘满了"))
      bridge.start()
      latest().open()

      latest().receive({ type: "save", id: "req-6", fields: { 词条: "obtain" } })
      await flush()

      expect(replies()[0]).toMatchObject({
        ok: false,
        error: { code: "internal_error", message: "存词失败：磁盘满了" },
      })
    })
  })

  describe("格式不对的消息直接丢弃", () => {
    it.each([
      ["不是 JSON", "hello world"],
      ["未知类型", { type: "delete-everything", id: "x" }],
      ["缺 id", { type: "lookup", text: "obtain" }],
      ["id 为空", { type: "lookup", id: "", text: "obtain" }],
      ["fields 不是对象", { type: "save", id: "x", fields: "obtain" }],
    ])("%s", async (_label, message) => {
      const { bridge, latest, lookup, save, replies } = setup()
      bridge.start()
      latest().open()

      expect(() => latest().receive(message)).not.toThrow()
      await flush()

      expect(lookup).not.toHaveBeenCalled()
      expect(save).not.toHaveBeenCalled()
      expect(replies()).toEqual([])
    })
  })

  describe("断线重连", () => {
    it("断开后标成未连接，并按 1、2 秒……的间隔重试", () => {
      const { bridge, sockets, latest, statuses } = setup()
      bridge.start()
      latest().drop()

      expect(statuses.at(-1)).toEqual({ connected: false, lastConnectedAt: null })
      expect(sockets).toHaveLength(1)

      vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0])
      expect(sockets).toHaveLength(2)

      latest().drop()
      vi.advanceTimersByTime(RECONNECT_DELAYS_MS[1] - 1)
      expect(sockets).toHaveLength(2)
      vi.advanceTimersByTime(1)
      expect(sockets).toHaveLength(3)
    })

    it("连上一次之后，退避重新从 1 秒算起", () => {
      const { bridge, sockets, latest } = setup()
      bridge.start()
      latest().drop()
      vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0])
      latest().drop()
      vi.advanceTimersByTime(RECONNECT_DELAYS_MS[1])

      latest().open()
      latest().drop()
      vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0])
      expect(sockets).toHaveLength(4)
    })

    it("已经连着时，唤醒定时器不会再建一条连接", () => {
      const { bridge, sockets, latest } = setup()
      bridge.start()
      latest().open()

      bridge.ensureConnected()
      expect(sockets).toHaveLength(1)
    })

    it("正在退避等待时，唤醒定时器会立刻重连", () => {
      const { bridge, sockets, latest } = setup()
      bridge.start()
      latest().drop()

      bridge.ensureConnected()
      expect(sockets).toHaveLength(2)
    })

    it("关掉开关后断开，且不再重连", () => {
      const { bridge, sockets, latest, statuses } = setup()
      bridge.start()
      latest().open()

      bridge.stop()
      expect(latest().readyState).toBe(3)
      expect(statuses.at(-1)).toMatchObject({ connected: false })

      vi.advanceTimersByTime(60_000)
      expect(sockets).toHaveLength(1)
    })
  })

  describe("保活", () => {
    it("连着时每 20 秒发一次 ping，断开后就停", () => {
      const { bridge, latest } = setup()
      bridge.start()
      const socket = latest()
      socket.open()

      vi.advanceTimersByTime(PING_INTERVAL_MS * 2)
      expect(socket.sent.filter((m) => m.type === "ping")).toHaveLength(2)

      socket.drop()
      vi.advanceTimersByTime(PING_INTERVAL_MS * 3)
      expect(socket.sent.filter((m) => m.type === "ping")).toHaveLength(2)
    })
  })
})
