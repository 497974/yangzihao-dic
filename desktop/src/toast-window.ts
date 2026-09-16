/**
 * 鼠标旁边的小提示（「正在翻译…」、翻译失败的原因）。
 *
 * 和查词弹窗不同，它绝不能抢焦点：用户正在输入框里打字，焦点一走，替换就落空了。
 * 所以它不可聚焦、鼠标点击直接穿过去，只用 showInactive 显示。
 */

import type { ToastState } from "./shared/popup-api"
import path from "node:path"
import { BrowserWindow, nativeTheme, screen } from "electron"
import { placePopup } from "./popup-position"

const WIDTH = 300
const MIN_HEIGHT = 40
const MAX_HEIGHT = 220

export function createToastWindow() {
  let win: BrowserWindow | null = null
  let ready: Promise<void> = Promise.resolve()
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  /** 每次显示或收起都加一：晚到的旧显示请求直接作废 */
  let generation = 0

  function ensureWindow(): BrowserWindow {
    if (win && !win.isDestroyed()) {
      return win
    }
    const created = new BrowserWindow({
      width: WIDTH,
      height: MIN_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#27272a" : "#ffffff",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    created.setAlwaysOnTop(true, "screen-saver")
    // 点击直接穿过去，不挡住下面的输入框
    created.setIgnoreMouseEvents(true)
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    created.webContents.on("will-navigate", (event) => event.preventDefault())
    ready = new Promise((resolve) => {
      created.webContents.once("did-finish-load", () => resolve())
    })
    void created.loadFile(path.join(__dirname, "popup", "toast.html"))
    win = created
    return created
  }

  function clearHideTimer() {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  function hide() {
    generation += 1
    clearHideTimer()
    if (win && !win.isDestroyed() && win.isVisible()) {
      win.hide()
    }
  }

  async function show(state: ToastState, autoHideMs?: number) {
    generation += 1
    const mine = generation
    clearHideTimer()
    const current = ensureWindow()
    await ready
    if (mine !== generation || current.isDestroyed()) {
      return
    }
    const measured = Number(
      await current.webContents.executeJavaScript(`window.setToast(${JSON.stringify(state)})`),
    )
    if (mine !== generation) {
      return
    }
    const height = Math.min(
      Math.max(Number.isFinite(measured) ? measured : 0, MIN_HEIGHT),
      MAX_HEIGHT,
    )
    const cursor = screen.getCursorScreenPoint()
    const { workArea } = screen.getDisplayNearestPoint(cursor)
    current.setBounds(placePopup(cursor, { width: WIDTH, height }, workArea))
    current.showInactive()
    if (autoHideMs) {
      hideTimer = setTimeout(hide, autoHideMs)
    }
  }

  return {
    /** 提前建好窗口，第一次提示不用等页面加载 */
    preload() {
      ensureWindow()
    },
    show,
    hide,
  }
}

export type ToastWindow = ReturnType<typeof createToastWindow>
