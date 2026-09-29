/**
 * 查词弹窗：鼠标旁边弹出、置顶、不占任务栏。窗口只建一次，之后反复显示/隐藏，弹出来不用等页面加载。
 *
 * 和网页查词弹窗一样：
 * - 点别处就收起；点了钉子就不收，查新词时原地更新、不跟着鼠标跳
 * - 按住标题栏可以拖动；拖过之后内容再变高变矮，只改高度不改位置
 * - 关掉弹窗会自动取消钉住
 *
 * 弹窗页面没有 Node 权限（沙盒 + 上下文隔离），只能通过 preload 里那几个函数和这里通信；
 * 这里也只认来自弹窗页面的消息。存词时存的是主进程手里的查词结果，不用页面传回来的数据。
 */

import type { IpcMainEvent, IpcMainInvokeEvent } from "electron"
import type { Point } from "./popup-position"
import type { PopupState, SaveOutcome } from "./shared/popup-api"
import path from "node:path"
import { BrowserWindow, clipboard, ipcMain, nativeTheme, screen } from "electron"
import { log } from "./logger"
import { placePopup } from "./popup-position"
import { isLeftButtonDown } from "./windows-input"

/** 查词、短句翻译用这个宽度 */
export const POPUP_WIDTH = 420
/** 长文本翻译用更宽的窗口：420 宽显示整段译文，一屏只有十来个字，读着很累 */
export const POPUP_WIDE_WIDTH = 620
/** 超过这么多字就算长文本，弹窗加宽 */
export const WIDE_TEXT_LENGTH = 80
const MIN_HEIGHT = 120
/** 高度上限：小屏幕按工作区算，别顶到屏幕外 */
const MAX_HEIGHT_CAP = 900
const MAX_HEIGHT_MARGIN = 120
const MIN_MAX_HEIGHT = 400

export interface PopupHandlers {
  onSave: () => Promise<SaveOutcome>
  onRetry: () => void
  /** 点了朗读按钮：由主进程决定用扩展的声音还是系统语音 */
  onSpeak: (text: string) => void
}

export function createPopupWindow(handlers: PopupHandlers) {
  let win: BrowserWindow | null = null
  let loaded = false
  let lastState: PopupState | null = null
  let anchor: Point = { x: 0, y: 0 }
  let height = 180
  let width = POPUP_WIDTH
  let pinned = false
  /** 用户拖动过弹窗：之后只改高度，不再按鼠标位置重新摆 */
  let userPlaced = false

  const alive = (): BrowserWindow | null => (win && !win.isDestroyed() ? win : null)
  const isPopup = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    !!alive() && event.sender === win?.webContents

  function setPinned(next: boolean) {
    if (pinned === next) {
      return
    }
    pinned = next
    log("弹窗", `主程序改钉住=${next}`)
    alive()?.webContents.send("popup:pinned", next)
  }

  function hide(reason: string) {
    const current = alive()
    if (current?.isVisible()) {
      log("弹窗", `收起（${reason}）`)
      current.hide()
    }
    setPinned(false)
  }

  function applyBounds() {
    const current = alive()
    if (!current) {
      return
    }
    if (!userPlaced) {
      const { workArea } = screen.getDisplayNearestPoint(anchor)
      current.setBounds(placePopup(anchor, { width, height }, workArea))
      return
    }
    // 拖过的：保持左上角不动，只是别超出屏幕底边
    const bounds = current.getBounds()
    const { workArea } = screen.getDisplayMatching(bounds)
    const nextHeight = Math.min(height, workArea.height)
    const maxY = workArea.y + workArea.height - nextHeight
    current.setBounds({
      x: bounds.x,
      y: Math.max(workArea.y, Math.min(bounds.y, maxY)),
      width,
      height: nextHeight,
    })
  }

  /** 这块屏幕上弹窗最高能有多高 */
  function maxHeight(): number {
    const current = alive()
    const { workArea } = current
      ? screen.getDisplayMatching(current.getBounds())
      : screen.getDisplayNearestPoint(anchor)
    return Math.max(MIN_MAX_HEIGHT, Math.min(MAX_HEIGHT_CAP, workArea.height - MAX_HEIGHT_MARGIN))
  }

  function ensureWindow(): BrowserWindow {
    const existing = alive()
    if (existing) {
      return existing
    }
    loaded = false
    const created = new BrowserWindow({
      width: POPUP_WIDTH,
      height,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#27272a" : "#ffffff",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    })
    // 普通置顶会被有些全屏程序盖住，用菜单级别的置顶
    created.setAlwaysOnTop(true, "pop-up-menu")
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    created.webContents.on("will-navigate", (event) => event.preventDefault())
    created.webContents.on("console-message", (event) => {
      log("[弹窗页面]", event.message)
    })
    created.webContents.on("did-finish-load", () => {
      loaded = true
      created.webContents.send("popup:pinned", pinned)
      if (lastState) {
        created.webContents.send("popup:state", lastState)
      }
    })
    created.on("blur", () => {
      log("弹窗", `失去焦点，钉住=${pinned}`)
      if (!pinned) {
        hide("点了别处")
      }
    })
    void created.loadFile(path.join(__dirname, "popup", "popup.html"))
    win = created
    return created
  }

  ipcMain.handle("popup:save", (event) => {
    if (!isPopup(event)) {
      return { ok: false, message: "无效的请求" } satisfies SaveOutcome
    }
    return handlers.onSave()
  })
  ipcMain.on("popup:copy", (event, text: unknown) => {
    if (isPopup(event) && typeof text === "string") {
      void clipboard.writeText(text)
    }
  })
  ipcMain.on("popup:speak", (event, text: unknown) => {
    if (isPopup(event) && typeof text === "string" && text.trim()) {
      handlers.onSpeak(text)
    }
  })
  ipcMain.on("popup:retry", (event) => {
    if (isPopup(event)) {
      handlers.onRetry()
    }
  })
  ipcMain.on("popup:close", (event) => {
    if (isPopup(event)) {
      hide("关闭按钮或 Esc")
    }
  })
  ipcMain.on("popup:pin", (event, value: unknown) => {
    if (isPopup(event) && typeof value === "boolean") {
      pinned = value
      log("弹窗", `页面改钉住=${value}`)
    }
  })
  /*
   * 拖动：按住标题栏时，每 16 毫秒把窗口挪到"鼠标位置 − 按下时的偏移"。
   * 不用 Electron 的 -webkit-app-region：在 Windows 上它会把标题栏里的钉子、关闭按钮
   * 也当成拖动区，一按就变成拖窗口，按钮收不到点击。
   */
  let dragTimer: ReturnType<typeof setInterval> | null = null
  const stopDrag = () => {
    if (dragTimer) {
      clearInterval(dragTimer)
      dragTimer = null
    }
  }
  ipcMain.on("popup:drag-start", (event) => {
    const current = alive()
    if (!isPopup(event) || !current) {
      return
    }
    stopDrag()
    const start = screen.getCursorScreenPoint()
    const [x, y] = current.getPosition()
    const offset = { x: start.x - x, y: start.y - y }
    userPlaced = true
    dragTimer = setInterval(() => {
      // 松开鼠标的消息万一没传过来，也靠这里停下
      if (!isLeftButtonDown() || current.isDestroyed()) {
        stopDrag()
        return
      }
      const point = screen.getCursorScreenPoint()
      current.setPosition(Math.round(point.x - offset.x), Math.round(point.y - offset.y))
    }, 16)
  })
  ipcMain.on("popup:drag-end", (event) => {
    if (isPopup(event)) {
      stopDrag()
    }
  })

  ipcMain.on("popup:resize", (event, requested: unknown) => {
    if (!isPopup(event) || typeof requested !== "number" || !Number.isFinite(requested)) {
      return
    }
    height = Math.min(Math.max(Math.ceil(requested), MIN_HEIGHT), maxHeight())
    applyBounds()
  })

  return {
    /** 提前把窗口建好（隐藏着），第一次弹出就不用等 */
    preload() {
      ensureWindow()
    },
    setState(state: PopupState) {
      lastState = state
      // 长文本（整段翻译、截图识别出的一段字）用更宽的窗口
      const source = "text" in state ? (state.text ?? "") : ""
      const nextWidth = source.length >= WIDE_TEXT_LENGTH ? POPUP_WIDE_WIDTH : POPUP_WIDTH
      if (nextWidth !== width) {
        width = nextWidth
        applyBounds()
      }
      const current = ensureWindow()
      if (loaded) {
        current.webContents.send("popup:state", state)
      }
    },
    /** 在鼠标旁边弹出；已经钉住并且开着的，原地更新内容、不挪位置 */
    showAt(point: Point) {
      const current = ensureWindow()
      log("弹窗", `弹出，钉住=${pinned}，本来就开着=${current.isVisible()}`)
      if (pinned && current.isVisible()) {
        return
      }
      anchor = point
      userPlaced = false
      applyBounds()
      current.show()
      current.focus()
    },
    hide: () => hide("主程序"),
    isVisible: () => !!alive()?.isVisible(),
    isFocused: () => !!alive()?.isFocused(),
  }
}

export type PopupWindow = ReturnType<typeof createPopupWindow>
