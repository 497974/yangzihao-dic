/**
 * 划词工具栏：在 QQ、Word 里选中文字后，旁边弹出和扩展网页划词工具栏一样的一排按钮
 * （翻译、朗读、词典和其它动作），点哪个做哪个。
 *
 * 它绝不能抢焦点：点按钮时前台必须还是原来的程序，模拟的 Ctrl+C 才会复制到选中的文字。
 * 所以窗口不可聚焦（点它不会把它变成前台），只用 showInactive 显示。
 *
 * 不理它就自己消失（鼠标停在上面时不消失）；点别处、打字也会收起（见 main.ts 里的钩子）。
 */

import type { Point } from "./popup-position"
import type { ToolbarAudio, ToolbarButton } from "./shared/popup-api"
import path from "node:path"
import { BrowserWindow, ipcMain, nativeTheme, screen } from "electron"
import { placePopup } from "./popup-position"

/** 不理它多久自动消失 */
/**
 * 弹出来多久没动就自己消失。选了一大段文字的人往往要先看一眼选中的范围，
 * 4 秒太短，经常一回头工具栏已经没了，看起来像没弹出来
 */
const AUTO_HIDE_MS = 10_000
/** 鼠标从工具栏上移开后多久消失 */
const LEAVE_HIDE_MS = 1_500
/** 工具栏在鼠标松开处的右下方一点，不挡住刚选中的字 */
const OFFSET: Point = { x: 6, y: 10 }

export interface ToolbarHandlers {
  onClick: (index: number) => void
}

export function createToolbarWindow(handlers: ToolbarHandlers) {
  let win: BrowserWindow | null = null
  let loaded = false
  let anchor: Point = { x: 0, y: 0 }
  let size = { width: 200, height: 36 }
  let pendingButtons: ToolbarButton[] | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  const alive = (): BrowserWindow | null => (win && !win.isDestroyed() ? win : null)
  const isToolbar = (event: Electron.IpcMainEvent) => !!alive() && event.sender === win?.webContents

  function clearHideTimer() {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  function scheduleHide(ms: number) {
    clearHideTimer()
    hideTimer = setTimeout(hide, ms)
  }

  function hide() {
    clearHideTimer()
    const current = alive()
    if (current?.isVisible()) {
      current.hide()
    }
  }

  function applyBounds() {
    const current = alive()
    if (!current) {
      return
    }
    const point = { x: anchor.x + OFFSET.x, y: anchor.y + OFFSET.y }
    const { workArea } = screen.getDisplayNearestPoint(anchor)
    current.setBounds(placePopup(point, size, workArea))
  }

  function ensureWindow(): BrowserWindow {
    const existing = alive()
    if (existing) {
      return existing
    }
    loaded = false
    const created = new BrowserWindow({
      width: size.width,
      height: size.height,
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
      webPreferences: {
        preload: path.join(__dirname, "toolbar-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    })
    created.setAlwaysOnTop(true, "pop-up-menu")
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    created.webContents.on("will-navigate", (event) => event.preventDefault())
    created.webContents.on("did-finish-load", () => {
      loaded = true
      if (pendingButtons) {
        created.webContents.send("toolbar:buttons", pendingButtons)
        pendingButtons = null
      }
    })
    void created.loadFile(path.join(__dirname, "popup", "toolbar.html"))
    win = created
    return created
  }

  ipcMain.on("toolbar:click", (event, index: unknown) => {
    if (isToolbar(event) && typeof index === "number") {
      hide()
      handlers.onClick(index)
    }
  })
  ipcMain.on("toolbar:close", (event) => {
    if (isToolbar(event)) {
      hide()
    }
  })
  ipcMain.on("toolbar:hover", (event, inside: unknown) => {
    if (!isToolbar(event)) {
      return
    }
    if (inside === true) {
      clearHideTimer()
    } else if (alive()?.isVisible()) {
      scheduleHide(LEAVE_HIDE_MS)
    }
  })
  ipcMain.on("toolbar:resize", (event, width: unknown, height: unknown) => {
    if (!isToolbar(event) || typeof width !== "number" || typeof height !== "number") {
      return
    }
    size = { width: Math.ceil(width), height: Math.ceil(height) }
    applyBounds()
  })

  return {
    /** 提前建好窗口（隐藏着），第一次弹出不用等页面加载 */
    preload() {
      ensureWindow()
    },
    /** 在 point（屏幕逻辑坐标）旁边弹出这些按钮 */
    showAt(point: Point, buttons: ToolbarButton[]) {
      anchor = point
      const current = ensureWindow()
      if (loaded) {
        current.webContents.send("toolbar:buttons", buttons)
      } else {
        pendingButtons = buttons
      }
      applyBounds()
      current.showInactive()
      scheduleHide(AUTO_HIDE_MS)
    },
    hide,
    isVisible: () => !!alive()?.isVisible(),
    /** 物理像素坐标的一个点是不是落在工具栏上（鼠标钩子给的是物理像素） */
    containsScreenPoint(point: Point): boolean {
      const current = alive()
      if (!current?.isVisible()) {
        return false
      }
      const rect = screen.dipToScreenRect(current, current.getBounds())
      return (
        point.x >= rect.x &&
        point.x < rect.x + rect.width &&
        point.y >= rect.y &&
        point.y < rect.y + rect.height
      )
    },
    /** 朗读：借工具栏页面的语音合成（窗口隐藏着也能读） */
    speak(text: string) {
      ensureWindow().webContents.send("toolbar:speak", text)
    },
    /** 放扩展合成好的音频；放不出来时页面会改用系统语音读 fallbackText */
    playAudio(audio: { audioBase64: string; contentType: string }, fallbackText: string) {
      const payload: ToolbarAudio = { ...audio, fallbackText }
      ensureWindow().webContents.send("toolbar:play-audio", payload)
    },
  }
}

export type ToolbarWindow = ReturnType<typeof createToolbarWindow>
