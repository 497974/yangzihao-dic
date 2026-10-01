/**
 * 大傻豪词典桌面版的主进程。
 *
 * - 托盘图标：彩色 = 已连上浏览器扩展，灰色 = 没连上；右键菜单里有开机自启和退出
 * - 只允许开一个：再双击一次只会提示"已经在运行了"
 * - 取词：在任何程序里选中文字，按 Ctrl+Alt+D（见 selection-capture.ts）
 * - 查词弹窗：鼠标旁边弹出，查词、存词都交给浏览器扩展（见 popup-window.ts）；
 *   大模型边写边显示，和网页里一样
 * - 本机 WebSocket 服务端，等扩展连上来（见 bridge-server.ts）
 */

import type { MenuItemConstructorOptions, NativeImage } from "electron"
import type { BridgeStatus } from "./bridge-server"
import type { ClipboardSnapshot } from "./clipboard-snapshot"
import type { InputTranslateDeps } from "./input-translate-flow"
import type { KeyboardHook } from "./keyboard-hook"
import type { MouseHook } from "./mouse-hook"
import type { QueuedWord, QueuedWordOutcome } from "./offline-queue"
import type { LookupResult, OutputField } from "./protocol"
import type { ToolbarInfo } from "./protocol"
import type { SelectionCaptureDeps } from "./selection-capture"
import type { SelectionRead } from "./selection-context"
import type { SelectionGesture } from "./selection-gesture"
import type { SaveOutcome } from "./shared/popup-api"
import type { PopupHeader, PopupState, ToolbarButton } from "./shared/popup-api"
import path from "node:path"
import {
  app,
  clipboard,
  dialog,
  globalShortcut,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  shell,
  Tray,
} from "electron"
import { BridgeRequestError, createBridgeServer } from "./bridge-server"
import { restoreClipboard, snapshotClipboard } from "./clipboard-snapshot"
import { createDailyGoalController } from "./daily-goal-controller"
import { runInputTranslate } from "./input-translate-flow"
import { skipReason } from "./input-translate-flow"
import { startKeyboardHook } from "./keyboard-hook"
import { createLockWindow } from "./lock-window"
import { log, logFilePath } from "./logger"
import { startMouseHook } from "./mouse-hook"
import { assembleText, chooseOcrAction, createOcrReader, trimForLookup } from "./ocr"
import { createFileQueueStore, createOfflineQueue } from "./offline-queue"
import {
  buildErrorState,
  buildFieldRows,
  errorCodeOf,
  noSelectionState,
  queuedState,
} from "./popup-model"
import { createPopupWindow } from "./popup-window"
import { createRegionSelector, removeTempFile, writeRegionPng } from "./screen-capture"
import { captureSelection } from "./selection-capture"
import {
  createAppSupportTracker,
  createSelectionContextReader,
  isReadable,
  pickContext,
} from "./selection-context"
import { createSelectionGestureDetector } from "./selection-gesture"
import { loadSettings, saveSettings } from "./settings"
import { createToastWindow } from "./toast-window"
import { createToolbarWindow } from "./toolbar-window"
import { createTripleSpaceDetector } from "./triple-space"
import {
  clipboardSequence,
  getForegroundApp,
  isForegroundFullscreen,
  isKeyDown,
  isModifierHeld,
  isTextCursor,
  releaseModifiers,
  sendCollapseToEnd,
  sendCopy,
  sendPaste,
  sendSelectAll,
  sendSelectToLineStart,
  VK_SPACE,
} from "./windows-input"

const APP_NAME = "大傻豪词典"
/** 取词快捷键，按顺序试，第一个被别的程序占了就用下一个 */
const HOTKEY_CANDIDATES = ["Ctrl+Alt+D", "Ctrl+Shift+Alt+D"] as const
/** 截图查词快捷键（框选屏幕上的字，认出来再查），同样按顺序试 */
const SCREENSHOT_HOTKEY_CANDIDATES = ["Ctrl+Alt+S", "Ctrl+Shift+Alt+S"] as const
/**
 * 强制弹出划词工具栏的快捷键。
 *
 * 鼠标钩子只认「拖动超过一段距离」和「双击三击」两种动作（见 selection-gesture.ts），
 * 选一大段文字的其他做法——Shift+点击、Ctrl+A、键盘选中、拖到一半页面自动滚动——
 * 都可能认不出来。按这个键则不看鼠标动作，直接在光标旁边弹工具栏。
 */
const TOOLBAR_HOTKEY_CANDIDATES = [
  "Ctrl+Alt+T",
  "Ctrl+Alt+G",
  "Ctrl+Alt+R",
  "Ctrl+Shift+Alt+T",
] as const
/** 截图查词弹窗的来源、标题 */
const SCREENSHOT_SOURCE = "截图"
const SCREENSHOT_HEADER: PopupHeader = { title: "截图识别翻译", icon: "dictionary" }
/** 开机自启时带上这个参数，这样开机时不弹"已在托盘运行"的提示 */
const AUTOSTART_ARG = "--autostart"
/** 命令行带上它就完全不锁屏：每日必学万一出问题时的后路 */
const NO_LOCK_ARG = "--no-lock"
/** 打包版 exe 和桌面快捷方式的名字（见 scripts/package.cjs） */
const PRODUCT_NAME = "大傻豪词典桌面版"
/** 连着扩展时，隔这么久把离线记下、上次没查成的词再试一遍 */
const QUEUE_RETRY_MS = 5 * 60_000
/** 隔这么久问一次今天有几个词该复习（托盘上的数字、跨过零点后的提醒） */
const REVIEW_CHECK_MS = 30 * 60_000

/** 本地日期 YYYY-MM-DD：复习提醒一天只弹一次 */
const localToday = () => new Date().toLocaleDateString("sv")

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 查词用哪个动作：不带 actionId 就是内置词典 */
interface LookupAction {
  name: string
  actionId?: string
}

const DICTIONARY: LookupAction = { name: "词典" }
const DICTIONARY_HEADER: PopupHeader = { title: "词典", icon: "dictionary" }
const TRANSLATE_HEADER: PopupHeader = { title: "翻译", icon: "translate" }
const OUTDATED_EXTENSION = {
  title: "浏览器扩展版本太旧",
  message: "这个功能要新版扩展。请在 chrome://extensions 里重新加载大傻豪词典扩展，再试一次。",
  canRetry: false,
}

/** 划词工具栏上的一个按钮：显示的样子 + 点了做什么 */
interface ToolbarEntry extends ToolbarButton {
  action: LookupAction
}

function loadTrayIcon(): NativeImage {
  // tray.png 是 16×16，同目录的 tray@2x.png 会在高分屏上自动换用
  return nativeImage.createFromPath(path.join(__dirname, "..", "assets", "tray.png"))
}

/** 没连上时用灰色图标，一眼就能看出状态；万一转换失败就还用彩色的，托盘不能因此起不来 */
function toGrayscale(image: NativeImage): NativeImage {
  try {
    return convertToGrayscale(image)
  } catch (error) {
    console.error("生成灰色托盘图标失败，改用彩色图标", error)
    return image
  }
}

function convertToGrayscale(image: NativeImage): NativeImage {
  const gray = nativeImage.createEmpty()
  for (const scaleFactor of image.getScaleFactors()) {
    // Windows 上的位图是 BGRA 顺序
    const bitmap = Buffer.from(image.toBitmap({ scaleFactor }))
    // getSize 给的是逻辑尺寸（2x 图也报 16×16），实际像素数要从位图大小反推
    const logical = image.getSize(scaleFactor)
    const pixelScale = Math.sqrt(bitmap.length / 4 / (logical.width * logical.height))
    const width = Math.round(logical.width * pixelScale)
    const height = Math.round(logical.height * pixelScale)
    for (let i = 0; i < bitmap.length; i += 4) {
      const luminance = Math.round(
        bitmap[i] * 0.114 + bitmap[i + 1] * 0.587 + bitmap[i + 2] * 0.299,
      )
      bitmap[i] = luminance
      bitmap[i + 1] = luminance
      bitmap[i + 2] = luminance
    }
    const png = nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor }).toPNG()
    gray.addRepresentation({ scaleFactor, width, height, buffer: png })
  }
  return gray
}

/**
 * 开机自启。没打包时（开发阶段）程序本体是 electron.exe，得把项目目录作为参数带上，
 * 否则开机启动的是一个空的 Electron。
 */
function loginItemOptions() {
  return app.isPackaged
    ? { args: [AUTOSTART_ARG] }
    : { path: process.execPath, args: [app.getAppPath(), AUTOSTART_ARG] }
}

function isOpenAtLogin() {
  return app.getLoginItemSettings(loginItemOptions()).openAtLogin
}

function setOpenAtLogin(openAtLogin: boolean) {
  app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin })
}

function showHowToConnect() {
  void dialog.showMessageBox({
    type: "info",
    title: APP_NAME,
    message: "怎么连上浏览器扩展",
    detail: [
      "1. 打开装了大傻豪词典扩展的浏览器（Chrome 或 Edge）",
      "2. 点扩展图标 → 设置，左边找到「桌面版」",
      "3. 打开「连接桌面版」开关",
      "",
      "连上后托盘图标会从灰色变成彩色。浏览器需要一直开着，桌面版才能查词。",
    ].join("\n"),
  })
}

/** 打包版：在桌面放一个快捷方式（免安装版解压后没有别的入口） */
function createDesktopShortcut() {
  const link = path.join(app.getPath("desktop"), `${PRODUCT_NAME}.lnk`)
  const ok = shell.writeShortcutLink(link, "create", {
    target: process.execPath,
    cwd: path.dirname(process.execPath),
    icon: process.execPath,
    iconIndex: 0,
    description: "在 QQ、微信、Word 等任何程序里选词查词",
  })
  void dialog.showMessageBox({
    type: ok ? "info" : "error",
    title: APP_NAME,
    message: ok ? "已在桌面创建快捷方式" : "没能在桌面创建快捷方式",
    detail: ok ? "以后双击桌面上的「大傻豪词典桌面版」就能打开。" : link,
  })
}

function statusLabel(status: BridgeStatus): string {
  if (status.connected) {
    const version = status.extensionVersion ? `（扩展 v${status.extensionVersion}）` : ""
    const extra = status.clientCount > 1 ? `，共 ${status.clientCount} 个浏览器` : ""
    return `● 已连接浏览器扩展${version}${extra}`
  }
  return "○ 未连接浏览器扩展"
}

const captureDeps: SelectionCaptureDeps<ClipboardSnapshot> = {
  snapshotClipboard,
  restoreClipboard,
  readClipboardText: () => clipboard.readText(),
  clipboardSequence,
  isModifierHeld,
  releaseModifiers,
  sendCopy,
  sleep,
  now: () => Date.now(),
}

function startApp() {
  let tray: Tray | null = null
  let hotkey: string | null = null
  const colorIcon = loadTrayIcon()
  const grayIcon = toGrayscale(colorIcon)

  /** 当前弹窗里在查的词；每次新查词加一，晚到的旧结果、旧进度直接丢掉 */
  let generation = 0
  let current: {
    /** lookup = 词典或自定义动作；translate = 划词翻译 */
    mode: "lookup" | "translate"
    text: string
    source: string | null
    action: LookupAction
    /** 选中文字所在的那一段（读得到的话）；重新生成时接着用 */
    context?: string
    result: LookupResult | null
  } | null = null
  /** 弹窗标题栏现在显示的（词典、翻译、某个动作） */
  let currentHeader: PopupHeader = DICTIONARY_HEADER
  /** lastOutputSchema 是哪个动作的：换了动作，字段就不一样了 */
  let lastSchemaKey = ""
  /** 上次查词用到的字段列表：下次一按快捷键就能先摆出空字段，不用等扩展回话 */
  let lastOutputSchema: OutputField[] | null = null
  /** 上次查词是因为没连上扩展而失败的：扩展一连上就自动重查 */
  let retryWhenConnected = false
  /** 正在取词或做三下空格翻译：这两件事都要借剪贴板、模拟按键，不能同时进行 */
  let capturing = false

  const settings = loadSettings()
  const selfExe = path.basename(process.execPath)
  const gestures = createSelectionGestureDetector()
  /** 这次按下左键时，光标是不是选文字的 I 形光标（不是的话，拖完也不弹工具栏） */
  let downOnText = false
  /** 上次状态是不是已连接：只在刚连上时记一次日志 */
  let wasConnected = false
  /** 今天有几个词该复习；没连上、旧版扩展时是 null */
  let reviewDue: number | null = null
  /** 最近一条托盘气泡被点了要做什么（只有复习提醒可以点） */
  let balloonAction: "review" | null = null
  let mouseHook: MouseHook | null = null
  const toolbarWindow = createToolbarWindow({ onClick: (index) => void onToolbarClick(index) })
  const toast = createToastWindow()
  /** 浏览器没开时记下的词，连上扩展后自动查好、存进生词本（桌面版方案第 7 步） */
  const offlineQueue = createOfflineQueue(
    createFileQueueStore(path.join(app.getPath("userData"), "offline-queue.json")),
  )
  /** 读选中文字所在的那一段，查词时一起交给词典（优化清单第 8 条） */
  const contextReader = createSelectionContextReader({
    scriptPath: path.join(__dirname, "..", "assets", "selection-context.ps1"),
    log: (message) => log("整句", message),
  })
  /** 哪些程序读不到选中的字（QQ、微信……），连着几次读不到就不再问它 */
  const uiaSupport = createAppSupportTracker()
  /** 截图查词：框选屏幕（screen-capture.ts）+ Windows 自带的文字识别（ocr.ts） */
  const ocrReader = createOcrReader({
    scriptPath: path.join(__dirname, "..", "assets", "ocr.ps1"),
    log: (message) => log("截图查词", message),
  })
  const regionSelector = createRegionSelector()
  let screenshotHotkey: string | null = null
  let toolbarHotkey: string | null = null
  const tripleSpace = createTripleSpaceDetector()
  let keyboardHook: KeyboardHook | null = null

  const server = createBridgeServer({
    // 只给自动化测试用：换个端口、换个数据目录，不去碰正在用的那份
    port: process.env.DIC_BRIDGE_PORT ? Number(process.env.DIC_BRIDGE_PORT) : undefined,
    onStatusChange: (status) => {
      refreshTray(status)
      void dailyGoal.evaluate()
      if (status.connected && !wasConnected) {
        const features = server.clientFeatures()
        log(
          "连接",
          `扩展 v${status.extensionVersion ?? "?"}，功能：${features.length > 0 ? features.join("、") : "没报告（旧版扩展）"}`,
        )
      }
      // 刚连上：先把浏览器没开时记下的词查好、存进生词本，再看今天有几个词该复习
      if (status.connected && !wasConnected) {
        void drainOfflineQueue().finally(() => void refreshReviewStatus(true))
      }
      if (!status.connected) {
        reviewDue = null
      }
      wasConnected = status.connected
      // 一连上就问好工具栏有哪些按钮，第一次划词就能用上
      if (status.connected) {
        void refreshToolbarInfo()
      }
      if (status.connected && retryWhenConnected && current && popup.isVisible()) {
        rerun()
      }
    },
  })

  const popup = createPopupWindow({
    onSave: saveCurrent,
    // 弹窗里点「重新生成」或「重试」：用户就是想要一份新的，不用上次查过的结果
    onRetry: () => {
      if (current) {
        rerun(true)
      }
    },
    onSpeak: (text) => void speakText(text),
  })

  /** 每日必学（强制）：目标没完成就锁屏答题；题目和判分在扩展里，这里管窗口和开关 */
  const lockWindow = createLockWindow({
    getInit: () => dailyGoal.getInit(),
    next: (exclude) => dailyGoal.next(exclude),
    submit: (cardId, typed, durationMs) => dailyGoal.submit(cardId, typed, durationMs),
    speak: (text) => dailyGoal.speak(text),
    openBrowser: () => void shell.openExternal("https://www.bing.com"),
    emergency: (phrase) => dailyGoal.emergency(phrase),
  })
  const dailyGoal = createDailyGoalController({
    server,
    settings,
    save: () => saveSettings(settings),
    lock: lockWindow,
    now: () => new Date(),
    log,
    errorCode: errorCodeOf,
    openBrowser: () => void shell.openExternal("https://www.bing.com"),
    disabledByFlag: process.argv.includes(NO_LOCK_ARG),
    onChange: () => refreshTray(server.getStatus()),
    confirmEnable: async () => {
      const { response } = await dialog.showMessageBox({
        type: "warning",
        title: `${APP_NAME} · 每日必学`,
        message: `开启后，每天没答完 ${settings.dailyGoal.target} 个单词，屏幕会被锁住`,
        detail:
          "· 锁屏时只能答题，答够数才放开；答的是生词本里到期的词，和闪卡复习同一份进度。\n" +
          "· 一天只用完成一次，完成后当天不再锁。\n" +
          "· 浏览器没开、扩展没连上时也会锁，点锁屏上的「启动浏览器」即可。\n" +
          "· 真有急事：锁屏右下角「紧急解锁」，手敲一句话，当天不再锁。\n" +
          "· 彻底出问题：Ctrl+Shift+Esc 打开任务管理器，结束「大傻豪词典桌面版」。\n" +
          "· 随时可以在托盘菜单里关掉。",
        buttons: ["开启每日必学", "取消"],
        defaultId: 1,
        cancelId: 1,
      })
      return response === 0
    },
  })

  function setPopupState(state: PopupState) {
    popup.setState({ ...state, header: state.header ?? currentHeader })
  }

  /** fresh：用户点了「重新生成」，不用上次查过的结果；连上扩展后自动补查时照常用 */
  function rerun(fresh = false) {
    if (!current) {
      return
    }
    if (current.mode === "translate") {
      void translateSelectionText(current.text, current.source)
    } else {
      void lookup(current.text, current.source, current.action, {
        fresh,
        context: current.context,
      })
    }
  }

  async function lookup(
    text: string,
    source: string | null,
    action: LookupAction = DICTIONARY,
    options: { fresh?: boolean; context?: string } = {},
  ) {
    generation += 1
    const mine = generation
    current = { mode: "lookup", text, source, action, context: options.context, result: null }
    currentHeader = { title: action.name, icon: action.actionId ? "action" : "dictionary" }
    // 浏览器没开：先记下来，连上后自动查好、存进生词本
    if (!server.getStatus().connected) {
      retryWhenConnected = false
      queueForLater({ text, context: options.context, source, action })
      return
    }
    const schemaKey = action.actionId ?? "dictionary"
    if (schemaKey !== lastSchemaKey) {
      lastOutputSchema = null
      lastSchemaKey = schemaKey
    }
    retryWhenConnected = false
    // 旧版扩展只会查内置词典：点了别的动作要直接说明，而不是发过去干等
    if (action.actionId && server.getStatus().connected && !server.supports("customActions")) {
      setPopupState({ kind: "error", text, source, ...OUTDATED_EXTENSION })
      return
    }
    const started = Date.now()
    let progressCount = 0
    log("查词", `开始：来源=${source ?? "未知"}，${text.length} 个字`)
    setPopupState(
      lastOutputSchema
        ? {
            kind: "result",
            text,
            source,
            fields: buildFieldRows(lastOutputSchema, {}, true),
            streaming: true,
            thinking: false,
            fast: false,
          }
        : { kind: "loading", text, source, thinking: false },
    )
    try {
      const result = await server.lookup(
        {
          text,
          sourceTitle: source ?? undefined,
          ...(action.actionId ? { actionId: action.actionId } : {}),
          ...(options.context ? { context: options.context } : {}),
          ...(options.fresh ? { fresh: true } : {}),
        },
        {
          onProgress: (progress) => {
            if (mine !== generation) {
              return
            }
            progressCount += 1
            if (progressCount === 1) {
              log("查词", `第一份进度：${Date.now() - started}ms`)
            }
            lastOutputSchema = progress.outputSchema
            const fields = buildFieldRows(progress.outputSchema, progress.fields, true)
            setPopupState({
              kind: "result",
              text,
              source,
              fields,
              streaming: true,
              thinking:
                progress.thinking?.status === "thinking" && fields.every((field) => field.pending),
              fast: false,
            })
          },
        },
      )
      if (mine !== generation) {
        return
      }
      current.result = result
      lastOutputSchema = result.outputSchema
      log(
        "查词",
        `完成：${Date.now() - started}ms，进度 ${progressCount} 次，${result.fast ? "快速词典" : "大模型"}`,
      )
      setPopupState({
        kind: "result",
        text,
        source,
        fields: buildFieldRows(result.outputSchema, result.fields, false),
        streaming: false,
        thinking: false,
        fast: result.fast,
        lookupCount: result.lookupCount,
        reviewBumped: result.reviewBumped,
      })
    } catch (error) {
      if (mine !== generation) {
        return
      }
      log(
        "查词",
        `失败：${errorCodeOf(error)}，${Date.now() - started}ms，进度 ${progressCount} 次`,
      )
      retryWhenConnected = errorCodeOf(error) === "not_connected"
      setPopupState(buildErrorState(error, text, source))
    }
  }

  async function saveCurrent(): Promise<SaveOutcome> {
    const result = current?.result
    if (!result) {
      return { ok: false, message: "还没查完，查完才能保存" }
    }
    try {
      const saved = await server.save(result.fields, { actionId: current?.action.actionId })
      if (saved.duplicate) {
        return { ok: true, message: "已在生词本里，没有重复添加" }
      }
      return {
        ok: true,
        message: saved.createdNotebase
          ? "已保存到生词本（第一次保存，自动建好了生词本）"
          : "已保存到生词本",
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * 朗读：优先请扩展按它的朗读设置合成（和网页上同一个声音），音频交给工具栏窗口去放；
   * 扩展是旧版、没连上或合成失败，就用 Windows 自带的语音读。
   */
  async function speakText(text: string) {
    if (server.supports("speak")) {
      try {
        const audio = await server.speak(text)
        toolbarWindow.playAudio(audio, text)
        return
      } catch (error) {
        log("朗读", `扩展合成失败，改用系统语音：${errorCodeOf(error)}`)
      }
    }
    toolbarWindow.speak(text)
  }

  /**
   * 取选中的字，顺便取它所在的那一段（整句）。
   * 程序提供文字接口时（记事本、Word……）直接读：不碰剪贴板、不模拟按键，也更快；
   * 读不到（QQ、微信……）再用老办法模拟 Ctrl+C。useUia = false 时（在查词弹窗里）只用 Ctrl+C。
   * 日志只记长度和走的哪条路，不记内容。
   */
  async function grabSelection(
    exe: string | null,
    useUia: boolean,
  ): Promise<{ text: string; context?: string } | null> {
    const started = Date.now()
    let read: SelectionRead | null = null
    if (useUia && (!exe || uiaSupport.worthTrying(exe))) {
      read = await contextReader.read()
      if (exe) {
        uiaSupport.record(exe, isReadable(read))
      }
    }
    const describe = (text: string, context: string | undefined) =>
      `${text.length} 个字，整句${context ? ` ${context.length} 个字` : "没有"}，${Date.now() - started}ms`

    const selected = read?.selection?.trim()
    if (selected) {
      const context = pickContext(read?.paragraph, selected)
      log("取词", `直接读：${describe(selected, context)}`)
      return { text: selected, context }
    }
    const captured = await captureSelection(captureDeps)
    if (!captured.ok) {
      return null
    }
    const context = pickContext(read?.paragraph, captured.text)
    log("取词", `复制：${describe(captured.text, context)}`)
    return { text: captured.text, context }
  }

  /** 截图查词出错时的弹窗（没认出字、识别器没装、截不了屏幕……） */
  function showScreenshotError(title: string, message: string) {
    generation += 1
    current = null
    currentHeader = SCREENSHOT_HEADER
    setPopupState({
      kind: "error",
      text: null,
      source: SCREENSHOT_SOURCE,
      title,
      message,
      canRetry: false,
    })
    popup.showAt(screen.getCursorScreenPoint())
  }

  /**
   * 截图查词（优化清单第 13 条）：冻住屏幕 → 框选 → 裁图放大 → Windows 自带的文字识别 →
   * 认出来是一个词或短语就查词典（整段识别结果当上下文），一整句、一段话就翻译。
   * 游戏画面、图片、扫描版 PDF 里复制不出来的字，用这个查。
   */
  async function onScreenshotLookup() {
    if (capturing || regionSelector.isActive()) {
      return
    }
    capturing = true
    let png: string | null = null
    try {
      toolbarWindow.hide()
      // 用户框选的这几秒里，先把认字的小进程拉起来
      ocrReader.warmUp()
      let region
      try {
        region = await regionSelector.select()
      } catch (error) {
        log("截图查词", `截不了屏幕：${error instanceof Error ? error.message : String(error)}`)
        showScreenshotError("截不了屏幕", "系统没有给出屏幕画面，再试一次。")
        return
      }
      if (!region) {
        log("截图查词", "取消了")
        return
      }
      png = writeRegionPng(region)
      if (!png) {
        return
      }
      const started = Date.now()
      const result = await ocrReader.recognize(png)
      const text = result ? assembleText(result) : ""
      log(
        "截图查词",
        `认出 ${text.length} 个字，${Date.now() - started}ms，识别器 ${result?.language ?? "无"}${result?.error ? `，出错：${result.error}` : ""}`,
      )
      if (!result) {
        showScreenshotError("认字超时", "Windows 的文字识别没有回应，再框一次试试。")
        return
      }
      if (result.error?.includes("no_ocr_engine")) {
        showScreenshotError(
          "这台电脑还没装文字识别",
          "打开 Windows 设置 → 时间和语言 → 语言和区域，在「中文(简体)」或「英语」的语言选项里装上「光学字符识别」，再试一次。",
        )
        return
      }
      const action = chooseOcrAction(text)
      if (!action) {
        showScreenshotError(
          "没认出字",
          result.error
            ? `文字识别出错：${result.error}`
            : "把要查的字完整框进去再试。手写体、艺术字、很花的背景可能认不出来。",
        )
        return
      }
      if (action === "lookup") {
        const target = trimForLookup(text)
        void lookup(target, SCREENSHOT_SOURCE, DICTIONARY, {
          context: text.trim() !== target ? text : undefined,
        })
      } else {
        void translateSelectionText(text, SCREENSHOT_SOURCE)
      }
      popup.showAt(screen.getCursorScreenPoint())
    } catch (error) {
      log("截图查词", `出错：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      removeTempFile(png)
      capturing = false
    }
  }

  function registerScreenshotHotkey(): string | null {
    for (const candidate of SCREENSHOT_HOTKEY_CANDIDATES) {
      try {
        if (globalShortcut.register(candidate, () => void onScreenshotLookup())) {
          return candidate
        }
      } catch (error) {
        console.error(`注册快捷键 ${candidate} 失败`, error)
      }
    }
    return null
  }

  /** 双击选中一个词后直接查词典（优化清单第 12 条），和按快捷键查词一样，只是不用按键 */
  async function lookupDoubleClicked(exe: string | null, source: string | null) {
    if (capturing) {
      return
    }
    capturing = true
    try {
      // 等双击选中的词在那个程序里定下来
      await sleep(80)
      const cursor = screen.getCursorScreenPoint()
      const grabbed = await grabSelection(exe, true)
      // 双击在空白处、没选中东西：什么都不做，不弹"没取到"打扰人
      if (!grabbed) {
        return
      }
      log("双击查词", `${grabbed.text.length} 个字`)
      void lookup(grabbed.text, source, DICTIONARY, { context: grabbed.context })
      popup.showAt(cursor)
    } catch (error) {
      log("双击查词", `出错：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      capturing = false
    }
  }

  function queueForLater(word: {
    text: string
    context?: string
    source: string | null
    action: LookupAction
  }) {
    const outcome = offlineQueue.add({
      text: word.text,
      ...(word.context ? { context: word.context } : {}),
      source: word.source,
      ...(word.action.actionId ? { actionId: word.action.actionId } : {}),
      actionName: word.action.name,
    })
    log("离线收词", `${outcome}，队列里 ${offlineQueue.size()} 个`)
    setPopupState(queuedState(outcome, word.text, word.source, offlineQueue.size()))
    refreshTray(server.getStatus())
  }

  /** 这些错误说明扩展又断了或卡住了：这个词先留着，下次连上再查 */
  const RETRY_LATER_CODES = new Set(["not_connected", "disconnected", "timeout"])

  async function processQueuedWord(word: QueuedWord): Promise<QueuedWordOutcome> {
    if (!server.getStatus().connected) {
      return "retry_later"
    }
    try {
      const result = await server.lookup({
        text: word.text,
        ...(word.context ? { context: word.context } : {}),
        ...(word.source ? { sourceTitle: word.source } : {}),
        ...(word.actionId ? { actionId: word.actionId } : {}),
      })
      const saved = await server.save(result.fields, { actionId: word.actionId })
      return saved.duplicate ? "duplicate" : "saved"
    } catch (error) {
      const code = errorCodeOf(error)
      log("离线收词", `补查失败：${code}`)
      return RETRY_LATER_CODES.has(code) ? "retry_later" : "failed"
    }
  }

  /** 扩展连上了：把浏览器没开时记下的词依次查好、存进生词本，完了在托盘上说一声 */
  async function drainOfflineQueue() {
    if (offlineQueue.size() === 0) {
      return
    }
    log("离线收词", `开始补查 ${offlineQueue.size()} 个`)
    const summary = await offlineQueue.drain(processQueuedWord)
    if (!summary) {
      return
    }
    log(
      "离线收词",
      `补查完：存好 ${summary.saved}，本来就有 ${summary.duplicate}，放弃 ${summary.dropped}，还剩 ${summary.remaining}`,
    )
    refreshTray(server.getStatus())
    const done = summary.saved + summary.duplicate
    if (done === 0 && summary.dropped === 0) {
      return
    }
    const parts = [`浏览器没开时记下的 ${done} 个词已经存进生词本`]
    if (summary.dropped > 0) {
      parts.push(`${summary.dropped} 个查不了，已放弃（原因见日志）`)
    }
    if (summary.remaining > 0) {
      parts.push(`还有 ${summary.remaining} 个下次再查`)
    }
    balloonAction = null
    tray?.displayBalloon({ iconType: "info", title: APP_NAME, content: parts.join("；") })
  }

  /**
   * 问扩展今天有几个词该复习，数字显示在托盘菜单里。
   * notify = 这次可以提醒：有到期的词、托盘里没关提醒、今天还没提醒过，就弹一条，点它打开复习页。
   */
  async function refreshReviewStatus(notify: boolean) {
    if (!server.getStatus().connected || !server.supports("reviewStatus")) {
      reviewDue = null
      return
    }
    try {
      const status = await server.reviewStatus()
      reviewDue = status.due
      refreshTray(server.getStatus())
      const today = localToday()
      if (
        notify &&
        status.due > 0 &&
        settings.reviewReminder &&
        settings.lastReviewReminderDate !== today
      ) {
        settings.lastReviewReminderDate = today
        saveSettings(settings)
        balloonAction = "review"
        tray?.displayBalloon({
          iconType: "info",
          title: `今天有 ${status.due} 个词该复习了`,
          content: "点这里打开闪卡复习。每天复习几分钟，存下的词才记得住。",
        })
        log("复习提醒", `提醒了：${status.due} 个到期`)
      }
    } catch (error) {
      log("复习提醒", `读不到：${errorCodeOf(error)}`)
    }
  }

  /** 在浏览器里打开扩展的闪卡复习页 */
  async function openReview() {
    try {
      await server.openReview()
      log("复习提醒", "打开了复习页")
    } catch (error) {
      void dialog.showMessageBox({
        type: "info",
        title: APP_NAME,
        message: "没能打开复习页",
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** 托盘里点了「清空」：删掉的词不会再存进生词本，先问一句 */
  async function confirmClearQueue() {
    const count = offlineQueue.size()
    const { response } = await dialog.showMessageBox({
      type: "question",
      title: APP_NAME,
      message: `清空离线记下的 ${count} 个词？`,
      detail: "清空后这些词不会再存进生词本。",
      buttons: ["清空", "取消"],
      defaultId: 1,
      cancelId: 1,
    })
    if (response === 0) {
      offlineQueue.clear()
      log("离线收词", `清空了 ${count} 个`)
      refreshTray(server.getStatus())
    }
  }

  async function onHotkey() {
    if (capturing) {
      return
    }
    capturing = true
    try {
      // 在弹窗里选了字再按快捷键，就查弹窗里选中的那段；来源还算原来的程序
      const inPopup = popup.isFocused()
      // 在弹窗里选的字就出自查词结果：只用 Ctrl+C，也没有更大的上下文可读
      const foreground = inPopup ? null : getForegroundApp()
      const source = inPopup ? (current?.source ?? null) : (foreground?.name ?? null)
      const cursor = screen.getCursorScreenPoint()
      const grabbed = await grabSelection(foreground?.exe ?? null, !inPopup)
      if (grabbed) {
        void lookup(grabbed.text, source, DICTIONARY, { context: grabbed.context })
      } else {
        generation += 1
        current = null
        setPopupState(noSelectionState(hotkey ?? "快捷键", source))
      }
      popup.showAt(cursor)
    } catch (error) {
      console.error("取词失败", error)
      generation += 1
      current = null
      setPopupState({
        kind: "error",
        text: null,
        source: null,
        title: "取词失败",
        message: error instanceof Error ? error.message : String(error),
        canRetry: false,
      })
      popup.showAt(screen.getCursorScreenPoint())
    } finally {
      capturing = false
    }
  }

  /** 复制当前选中的字，返回剪贴板里的原样（三下空格翻译要看结尾的空格）；复制完剪贴板会还原 */
  async function copySelectionRaw(): Promise<string | null> {
    const captured = await captureSelection(captureDeps)
    return captured.ok ? captured.raw : null
  }

  /** 把译文粘贴进去替换选中的字；等程序读完剪贴板，再把用户原来的剪贴板放回去 */
  async function pasteText(text: string) {
    const snapshot = await snapshotClipboard()
    await clipboard.writeText(text)
    const written = clipboardSequence()
    sendPaste()
    await sleep(600)
    // 这期间用户自己又复制了东西，就别覆盖它
    if (clipboardSequence() === written) {
      await restoreClipboard(snapshot)
    }
  }

  const inputTranslateDeps: InputTranslateDeps = {
    foreground: getForegroundApp,
    isFullscreen: isForegroundFullscreen,
    selfExe: path.basename(process.execPath),
    waitForSpaceRelease: async () => {
      // 钩子在第三下空格"按下"时就触发了，这时空格还没打进输入框
      const started = Date.now()
      while (isKeyDown(VK_SPACE) && Date.now() - started < 1000) {
        await sleep(10)
      }
      await sleep(40)
    },
    select: (kind) => (kind === "all" ? sendSelectAll() : sendSelectToLineStart()),
    collapse: sendCollapseToEnd,
    copySelection: copySelectionRaw,
    translate: async (text, source) => (await server.translate(text, source ?? undefined)).text,
    paste: pasteText,
    notify: (state) => {
      if (state) {
        void toast.show(state, state.kind === "error" ? 5000 : undefined)
      } else {
        toast.hide()
      }
    },
    log,
  }

  async function onTripleSpace() {
    if (capturing) {
      return
    }
    capturing = true
    const started = Date.now()
    try {
      const outcome = await runInputTranslate(inputTranslateDeps)
      log("输入翻译", `${outcome}，${Date.now() - started}ms`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log("输入翻译", `出错：${message}`)
      void toast.show({ kind: "error", title: "输入翻译没成功", message }, 5000)
    } finally {
      capturing = false
    }
  }

  /**
   * 按设置装上或摘掉键盘钩子。两个功能都要用它：三下空格翻译数空格，划词工具栏一打字就收起。
   * 只要有一个开着就装着（之前只跟三下空格走，关掉三下空格后打字收不起工具栏）。
   */
  function applyKeyboardHook() {
    if (!settings.tripleSpaceTranslate) {
      tripleSpace.reset()
    }
    const wanted = settings.tripleSpaceTranslate || settings.selectionToolbar
    if (wanted && !keyboardHook) {
      try {
        keyboardHook = startKeyboardHook((event) => {
          // 一打字就收起划词工具栏
          if (event.down && toolbarWindow.isVisible()) {
            setImmediate(() => toolbarWindow.hide())
          }
          if (settings.tripleSpaceTranslate && tripleSpace.handle(event)) {
            // 钩子回调里不能做耗时的事，挪到下一轮再处理
            setImmediate(() => void onTripleSpace())
          }
        })
        log("键盘钩子", "已装上")
      } catch (error) {
        log("键盘钩子", `装不上：${error instanceof Error ? error.message : String(error)}`)
      }
    } else if (!wanted && keyboardHook) {
      keyboardHook.stop()
      keyboardHook = null
      log("键盘钩子", "已摘掉")
    }
  }

  /** 划词工具栏的「翻译」：按扩展「划词翻译」的设置，大模型时边写边显示 */
  async function translateSelectionText(text: string, source: string | null) {
    generation += 1
    const mine = generation
    current = { mode: "translate", text, source, action: DICTIONARY, result: null }
    currentHeader = TRANSLATE_HEADER
    retryWhenConnected = false
    const started = Date.now()
    log("划词翻译", `开始：来源=${source ?? "未知"}，${text.length} 个字`)
    const base = { kind: "translation" as const, text, source }
    setPopupState({ ...base, translated: "", streaming: true, thinking: false, fast: false })
    if (server.getStatus().connected && !server.supports("selectionTranslate")) {
      setPopupState({ kind: "error", text, source, ...OUTDATED_EXTENSION })
      return
    }
    try {
      const result = await server.translateSelection(text, source ?? undefined, {
        onProgress: (progress) => {
          if (mine !== generation) {
            return
          }
          setPopupState({
            ...base,
            translated: progress.text,
            streaming: true,
            thinking: progress.thinking?.status === "thinking" && !progress.text,
            fast: false,
          })
        },
      })
      if (mine !== generation) {
        return
      }
      log("划词翻译", `完成：${Date.now() - started}ms`)
      setPopupState({
        ...base,
        translated: result.text,
        streaming: false,
        thinking: false,
        fast: result.fast,
      })
    } catch (error) {
      if (mine !== generation) {
        return
      }
      log("划词翻译", `失败：${errorCodeOf(error)}，${Date.now() - started}ms`)
      retryWhenConnected = errorCodeOf(error) === "not_connected"
      setPopupState(buildErrorState(error, text, source))
    }
  }

  /** 扩展说它的工具栏上有哪些按钮；旧版扩展说不出来就是 null */
  let toolbarInfo: ToolbarInfo | null = null
  /** 这次弹出的工具栏上每个按钮对应做什么 */
  let toolbarEntries: ToolbarEntry[] = []
  /** 工具栏是在哪个窗口里选中文字后弹出来的 */
  let toolbarContext: { handle: bigint | null; source: string | null; exe: string | null } | null =
    null

  async function refreshToolbarInfo() {
    if (!server.getStatus().connected || !server.supports("toolbar")) {
      toolbarInfo = null
      return
    }
    try {
      toolbarInfo = await server.getToolbar()
    } catch (error) {
      log("划词工具栏", `读取按钮失败：${errorCodeOf(error)}`)
    }
  }

  function buildToolbarEntries(): ToolbarEntry[] {
    // 浏览器没开：只放朗读（系统语音）和词典（先记下来，连上后自动查好存进生词本）
    if (!server.getStatus().connected) {
      return [
        { kind: "speak", name: "朗读", icon: "tabler:volume", action: DICTIONARY },
        { kind: "action", name: "词典（先记下）", icon: "tabler:book-2", action: DICTIONARY },
      ]
    }
    // 旧版扩展说不出工具栏有哪些按钮：照网页的默认放翻译、朗读、词典。
    // 朗读没有扩展也能用系统语音读；翻译点了会提示去重新加载扩展
    if (!toolbarInfo) {
      return [
        { kind: "translate", name: "翻译", icon: "ri:translate", action: DICTIONARY },
        { kind: "speak", name: "朗读", icon: "tabler:volume", action: DICTIONARY },
        { kind: "action", name: "词典", icon: "tabler:book-2", action: DICTIONARY },
      ]
    }
    const entries: ToolbarEntry[] = []
    if (toolbarInfo.translate) {
      entries.push({ kind: "translate", name: "翻译", icon: "ri:translate", action: DICTIONARY })
    }
    if (toolbarInfo.speak) {
      entries.push({ kind: "speak", name: "朗读", icon: "tabler:volume", action: DICTIONARY })
    }
    for (const item of toolbarInfo.actions) {
      entries.push({
        kind: "action",
        name: item.name,
        icon: item.icon,
        action: item.isDictionary ? { name: item.name } : { name: item.name, actionId: item.id },
      })
    }
    return entries
  }

  /** 鼠标钩子看出用户刚选中了一段文字：在旁边弹出工具栏（这时还不复制、不查词） */
  async function onSelectionGesture(gesture: SelectionGesture) {
    // 扩展没连上也弹：可以先把词记下来（见 buildToolbarEntries）
    if (capturing) {
      log("划词工具栏", "正忙着上一次取词，这次不弹")
      return
    }
    const app = getForegroundApp()
    const skipped = skipReason(app.exe, selfExe)
    if (skipped) {
      log("划词工具栏", `${app.exe ?? "未知程序"} 不弹：${skipped}`)
      return
    }
    if (isForegroundFullscreen()) {
      log("划词工具栏", "当前是全屏程序，不弹")
      return
    }
    // 双击选中一个词：托盘里开了「双击直接查词」就不弹工具栏，直接查词典（三击、拖选照旧弹工具栏）
    if (settings.doubleClickLookup && gesture.kind === "multi-click" && gesture.clicks === 2) {
      await lookupDoubleClicked(app.exe, app.name)
      return
    }
    if (!settings.selectionToolbar) {
      log("划词工具栏", "托盘里关掉了，不弹")
      return
    }
    log(
      "划词工具栏",
      `${gesture.kind === "drag" ? "拖选" : `连点 ${gesture.clicks} 下`}，在 ${app.name ?? app.exe ?? "未知程序"} 里弹出`,
    )
    await showSelectionToolbar(screen.screenToDipPoint({ x: gesture.x, y: gesture.y }), app)
  }

  /**
   * 在指定位置弹出划词工具栏。鼠标动作和快捷键两条路都走这里。
   * @param point 工具栏弹在哪（DIP 坐标）
   */
  async function showSelectionToolbar(
    point: { x: number; y: number },
    app: { handle: bigint | null; name: string | null; exe: string | null },
  ) {
    toolbarEntries = buildToolbarEntries()
    toolbarContext = { handle: app.handle, source: app.name, exe: app.exe }
    // 读文字的小进程闲置时会关掉：趁用户还在看工具栏，先把它拉起来
    contextReader.warmUp()
    // 等选区在那个程序里定下来，顺便拿一份最新的按钮设置留给下次
    void refreshToolbarInfo()
    await sleep(80)
    toolbarWindow.showAt(
      point,
      toolbarEntries.map(({ kind, name, icon }) => ({ kind, name, icon })),
    )
  }

  /**
   * 按快捷键强制弹出划词工具栏：不看鼠标动作，选中文字的方式不限
   * （Shift+点击、Ctrl+A、键盘选中、拖到一半自动滚动都行）。
   * 和鼠标那条路不同，这里不受托盘里「划词工具栏」开关的限制——按了键就是想要它。
   */
  async function onToolbarHotkey() {
    if (capturing) {
      return
    }
    const app = getForegroundApp()
    if (skipReason(app.exe, selfExe) || isForegroundFullscreen()) {
      log("划词工具栏", `快捷键：当前程序不弹（${app.exe ?? "未知"}）`)
      return
    }
    log("划词工具栏", `快捷键：在 ${app.name ?? app.exe ?? "未知程序"} 里弹出`)
    await showSelectionToolbar(screen.getCursorScreenPoint(), app)
  }

  function registerToolbarHotkey(): string | null {
    for (const candidate of TOOLBAR_HOTKEY_CANDIDATES) {
      try {
        if (globalShortcut.register(candidate, () => void onToolbarHotkey())) {
          return candidate
        }
      } catch (error) {
        console.error(`注册快捷键 ${candidate} 失败`, error)
      }
    }
    return null
  }

  /** 点了工具栏上的按钮：这时才去复制选中的文字，然后翻译 / 朗读 / 查词 */
  async function onToolbarClick(index: number) {
    const entry = toolbarEntries[index]
    const context = toolbarContext
    if (!entry || !context || capturing) {
      return
    }
    capturing = true
    const cursor = screen.getCursorScreenPoint()
    try {
      // 工具栏不抢焦点，前台应该还是原来的程序；换了就别往别的程序里按 Ctrl+C
      if (getForegroundApp().handle !== context.handle) {
        log("划词工具栏", "前台窗口变了，不取词")
        return
      }
      const grabbed = await grabSelection(context.exe, true)
      if (!grabbed) {
        generation += 1
        current = null
        currentHeader = { title: entry.name, icon: "dictionary" }
        setPopupState({
          kind: "error",
          text: null,
          source: context.source,
          title: "没取到选中的文字",
          message: "选中的字没复制出来：可能选区已经没了，或者这个程序不让复制。重新选一下再试。",
          canRetry: false,
        })
        popup.showAt(cursor)
        return
      }
      if (entry.kind === "speak") {
        void speakText(grabbed.text)
        return
      }
      if (entry.kind === "translate") {
        void translateSelectionText(grabbed.text, context.source)
      } else {
        void lookup(grabbed.text, context.source, entry.action, { context: grabbed.context })
      }
      popup.showAt(cursor)
    } catch (error) {
      log("划词工具栏", `出错：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      capturing = false
    }
  }

  /** 按设置装上或摘掉鼠标钩子（划词工具栏） */
  function applySelectionToolbar() {
    // 划词工具栏和双击查词都靠鼠标钩子，有一个开着就装着
    const wanted = settings.selectionToolbar || settings.doubleClickLookup
    if (!settings.selectionToolbar) {
      toolbarWindow.hide()
    }
    if (wanted && !mouseHook) {
      try {
        mouseHook = startMouseHook((event) => {
          // 钩子回调里只做最少的事，其余挪到下一轮
          if (event.type === "down" && toolbarWindow.containsScreenPoint(event)) {
            return
          }
          if (event.type === "down" && toolbarWindow.isVisible()) {
            setImmediate(() => toolbarWindow.hide())
          }
          if (event.type === "down") {
            // 按下那一刻的光标形状：在文字上才是 I 形。游戏里长按开枪、拖窗口都不是
            downOnText = isTextCursor()
          }
          const gesture = gestures.handle(event)
          if (gesture) {
            // 按下时光标是 I 形最可靠；但选一大段时常常按在已选中的文字上、
            // 或者在 PDF 阅读器这类自定义光标的程序里，按下那一刻并不是 I 形。
            // 所以松开时再看一次，任一时刻在文字上就认。误判的代价只是多一个会自己消失的工具栏
            if (downOnText || isTextCursor()) {
              setImmediate(() => void onSelectionGesture(gesture))
            } else {
              log("划词工具栏", "认出了选中动作，但按下和松开时光标都不在文字上，没弹")
            }
          }
        })
        log("划词工具栏", "已开启")
      } catch (error) {
        log("划词工具栏", `开不了：${error instanceof Error ? error.message : String(error)}`)
      }
    } else if (!wanted && mouseHook) {
      mouseHook.stop()
      mouseHook = null
      gestures.reset()
      log("划词工具栏", "已关闭")
    }
  }

  function registerHotkey(): string | null {
    for (const candidate of HOTKEY_CANDIDATES) {
      try {
        if (globalShortcut.register(candidate, () => void onHotkey())) {
          return candidate
        }
      } catch (error) {
        console.error(`注册快捷键 ${candidate} 失败`, error)
      }
    }
    return null
  }

  function refreshTray(status: BridgeStatus) {
    if (!tray) {
      return
    }
    tray.setImage(status.connected ? colorIcon : grayIcon)
    tray.setToolTip(
      `${APP_NAME} · ${status.connected ? "已连接浏览器扩展" : "未连接浏览器扩展"}` +
        (hotkey ? `\n选中文字后按 ${hotkey} 查词` : "") +
        (screenshotHotkey ? `\n按 ${screenshotHotkey} 截图识别翻译` : ""),
    )

    const items: MenuItemConstructorOptions[] = [
      { label: APP_NAME, enabled: false },
      { label: statusLabel(status), enabled: false },
    ]
    if (status.lastError) {
      items.push({ label: `⚠ ${status.lastError}`, enabled: false })
    }
    // 截图识别翻译放在最上面、能直接点：只有快捷键的话，没看过说明书的人根本不知道有这个功能
    items.push(
      { type: "separator" },
      {
        label: screenshotHotkey
          ? `截图识别翻译（${screenshotHotkey}）`
          : "截图识别翻译（快捷键被占用，点这里使用）",
        // 等托盘菜单收起来再截屏，不然菜单会被截进去
        click: () => setTimeout(() => void onScreenshotLookup(), 250),
      },
    )
    if (status.connected && !server.supports("toolbar")) {
      items.push({
        label: "⚠ 浏览器扩展为旧版本：请在 chrome://extensions 重新加载后使用",
        enabled: false,
      })
    }
    if (!status.connected) {
      items.push({ label: "如何连接？", click: showHowToConnect })
    }
    if (status.connected && server.supports("reviewStatus")) {
      items.push({
        label:
          reviewDue === null
            ? "闪卡复习"
            : reviewDue > 0
              ? `闪卡复习：今天 ${reviewDue} 个词到期`
              : "闪卡复习：今天的都复习完了",
        click: () => void openReview(),
      })
    }
    const queued = offlineQueue.list()
    if (queued.length > 0) {
      const shown = 15
      const shorten = (text: string) => {
        const oneLine = text.replace(/\s+/g, " ")
        return oneLine.length > 30 ? `${oneLine.slice(0, 30)}…` : oneLine
      }
      items.push({
        label: `离线记下的词（${queued.length} 个）`,
        submenu: [
          ...queued.slice(0, shown).map((word) => ({ label: shorten(word.text), enabled: false })),
          ...(queued.length > shown
            ? [{ label: `……还有 ${queued.length - shown} 个`, enabled: false }]
            : []),
          { type: "separator" as const },
          status.connected
            ? { label: "立即查询并存入生词本", click: () => void drainOfflineQueue() }
            : { label: "连接浏览器扩展后将自动存入生词本", enabled: false },
          { label: "清空（不再保存这些词）", click: () => void confirmClearQueue() },
        ],
      })
    }
    items.push(
      { type: "separator" },
      hotkey
        ? { label: `查词：选中文字后按 ${hotkey}`, enabled: false }
        : { label: "⚠ 查词快捷键已被其他程序占用", enabled: false },
      toolbarHotkey
        ? { label: `弹出划词工具栏：选中文字后按 ${toolbarHotkey}`, enabled: false }
        : { label: "⚠ 划词工具栏快捷键已被其他程序占用", enabled: false },
      {
        label: "连按三次空格翻译（浏览器以外的程序，如 QQ、微信）",
        type: "checkbox",
        checked: settings.tripleSpaceTranslate,
        click: (item) => {
          settings.tripleSpaceTranslate = item.checked
          saveSettings(settings)
          log("三下空格翻译", item.checked ? "已开启" : "已关闭")
          applyKeyboardHook()
        },
      },
      {
        label: "划词工具栏（浏览器以外的程序，如 QQ、微信）",
        type: "checkbox",
        checked: settings.selectionToolbar,
        click: (item) => {
          settings.selectionToolbar = item.checked
          saveSettings(settings)
          applySelectionToolbar()
          applyKeyboardHook()
        },
      },
      {
        label: "双击单词直接查词典（不显示工具栏）",
        type: "checkbox",
        checked: settings.doubleClickLookup,
        click: (item) => {
          settings.doubleClickLookup = item.checked
          saveSettings(settings)
          log("双击查词", item.checked ? "已开启" : "已关闭")
          applySelectionToolbar()
        },
      },
      {
        label: "每日复习提醒（有到期的词时提醒一次）",
        type: "checkbox",
        checked: settings.reviewReminder,
        click: (item) => {
          settings.reviewReminder = item.checked
          saveSettings(settings)
          log("复习提醒", item.checked ? "已开启" : "已关闭")
        },
      },
      ...dailyGoal.menuItems(),
      {
        label: "开机自动启动",
        type: "checkbox",
        checked: isOpenAtLogin(),
        click: (item) => setOpenAtLogin(item.checked),
      },
      ...(app.isPackaged ? [{ label: "在桌面创建快捷方式", click: createDesktopShortcut }] : []),
      {
        label: "打开日志文件夹",
        click: () => void shell.openPath(path.dirname(logFilePath())),
      },
      { type: "separator" },
      { label: "退出", click: () => app.quit() },
    )
    tray.setContextMenu(Menu.buildFromTemplate(items))
  }

  app.on("second-instance", () => {
    tray?.displayBalloon({
      iconType: "info",
      title: APP_NAME,
      content: "已经在运行了，图标在屏幕右下角的托盘里。",
    })
  })

  let quitting = false
  app.on("before-quit", (event) => {
    if (quitting) {
      return
    }
    // 先把连接收拾干净再退，扩展那边会立刻看到"未连接"
    event.preventDefault()
    quitting = true
    void server.stop().finally(() => app.quit())
  })

  app.on("will-quit", () => {
    globalShortcut.unregisterAll()
    keyboardHook?.stop()
    keyboardHook = null
    mouseHook?.stop()
    mouseHook = null
    contextReader.stop()
    ocrReader.stop()
    regionSelector.cancel()
  })

  void app.whenReady().then(async () => {
    tray = new Tray(grayIcon)
    // 左键也弹菜单，不然用户点了没反应会以为程序卡了
    tray.on("click", () => tray?.popUpContextMenu())
    // 点了复习提醒那条气泡：打开复习页
    tray.on("balloon-click", () => {
      if (balloonAction === "review") {
        void openReview()
      }
      balloonAction = null
    })
    hotkey = registerHotkey()
    screenshotHotkey = registerScreenshotHotkey()
    toolbarHotkey = registerToolbarHotkey()
    log(
      "启动",
      `快捷键=${hotkey ?? "注册失败"}，截图查词=${screenshotHotkey ?? "注册失败"}，` +
        `划词工具栏=${toolbarHotkey ?? "注册失败"}`,
    )
    popup.preload()
    toast.preload()
    toolbarWindow.preload()
    contextReader.warmUp()
    // 连着的时候隔一阵子再试一遍：离线记下的词里有上次超时没查成的
    setInterval(() => {
      if (server.getStatus().connected && offlineQueue.size() > 0) {
        void drainOfflineQueue()
      }
    }, QUEUE_RETRY_MS)
    // 隔一阵子更新托盘上的复习数字；过了零点又有到期的词，这里会提醒当天的第一次
    setInterval(() => void refreshReviewStatus(true), REVIEW_CHECK_MS)
    applyKeyboardHook()
    applySelectionToolbar()
    refreshTray(server.getStatus())
    powerMonitor.on("resume", () => void dailyGoal.evaluate())
    powerMonitor.on("unlock-screen", () => void dailyGoal.evaluate())

    try {
      await server.start()
    } catch (error) {
      const detail =
        error instanceof BridgeRequestError
          ? `${error.message}\n\n可能是已经开着另一个桌面版，或者别的软件恰好用了这个端口。重启电脑一般就好了。`
          : String(error)
      dialog.showErrorBox(APP_NAME, detail)
      app.quit()
      return
    }

    dailyGoal.start()

    if (!process.argv.includes(AUTOSTART_ARG)) {
      tray.displayBalloon({
        iconType: "info",
        title: `${APP_NAME}已在托盘运行`,
        content:
          (hotkey
            ? `在 QQ、微信、记事本等任何程序里选中文字，按 ${hotkey} 查词。`
            : "查词快捷键被别的程序占用了，暂时没法取词。") +
          (screenshotHotkey
            ? `图片、游戏里复制不出来的字，按 ${screenshotHotkey} 截图识别翻译。`
            : ""),
      })
    }
  })
}

// 托盘程序没有常开的窗口；查词弹窗关了也不能退出
app.on("window-all-closed", () => {})

if (process.env.DIC_USER_DATA) {
  // 只给自动化测试用：换个数据目录，才不会和正在用的那份抢"只开一个"的锁
  app.setPath("userData", process.env.DIC_USER_DATA)
}

if (app.requestSingleInstanceLock()) {
  app.setAppUserModelId("com.yangzihao.dic.desktop")
  startApp()
} else {
  // 已经有一个在跑了：那边会收到 second-instance 并提示，这边直接退
  app.quit()
}
