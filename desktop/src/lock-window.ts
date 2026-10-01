/**
 * 每日必学的锁屏窗口：目标没完成时，每块屏幕盖一个全屏置顶窗口，主屏上答题，其余屏幕只盖一层黑幕。
 *
 * 锁屏页面（popup/lock.html）自己出题、判题、记结果，所有数据都经 ipc 从主进程拿；
 * 主进程再去问浏览器扩展。这里只管窗口：创建、盖住、守住焦点、放开。
 *
 * 能被"锁住"的只是桌面上的窗口，不是系统：Ctrl+Alt+Del、任务管理器永远在，
 * 前台是任务管理器时本窗口也不抢焦点（见 daily-goal.ts 的 shouldRefocus）。
 * 环境变量 DIC_LOCK_WINDOWED=1 让它变成一个普通的小窗口，开发和测试时用。
 */

import type { LockNext, LockSubmit } from "./shared/lock-api"
import path from "node:path"
import { BrowserWindow, ipcMain, screen } from "electron"
import { shouldRefocus } from "./daily-goal"
import { log } from "./logger"
import { getForegroundApp } from "./windows-input"

export interface LockHandlers {
  /** 页面刚打开：今天的目标、紧急解锁要敲的那句话 */
  getInit: () => { target: number; emergencyPhrase: string }
  next: (exclude: string[]) => Promise<LockNext>
  submit: (cardId: string, typed: string, durationMs: number) => Promise<LockSubmit>
  speak: (
    text: string,
  ) => Promise<{ ok: true; audioBase64: string; contentType: string } | { ok: false }>
  openBrowser: () => void
  /** 口令对了就记下紧急解锁并返回 true */
  emergency: (phrase: string) => boolean
}

const GUARD_INTERVAL_MS = 1_500
const BACKGROUND = "#0f172a"

export function createLockWindow(handlers: LockHandlers) {
  const windowed = process.env.DIC_LOCK_WINDOWED === "1"
  let windows: BrowserWindow[] = []
  let primary: BrowserWindow | null = null
  let guard: ReturnType<typeof setInterval> | null = null
  let tearingDown = false

  const isLockSender = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) =>
    primary !== null && !primary.isDestroyed() && event.sender === primary.webContents

  function create(bounds: Electron.Rectangle, isPrimary: boolean): BrowserWindow {
    const win = new BrowserWindow({
      ...(windowed
        ? { width: 980, height: 720, center: true }
        : { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }),
      show: false,
      frame: windowed,
      resizable: windowed,
      movable: windowed,
      minimizable: windowed,
      maximizable: false,
      fullscreenable: false,
      closable: windowed,
      skipTaskbar: !windowed,
      alwaysOnTop: !windowed,
      backgroundColor: BACKGROUND,
      title: "大傻豪词典 · 每日必学",
      webPreferences: {
        preload: isPrimary ? path.join(__dirname, "lock-preload.js") : undefined,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    })
    if (!windowed) {
      // 盖住任务栏：screen-saver 级别在 Windows 上就是最高的置顶层
      win.setAlwaysOnTop(true, "screen-saver")
      win.setBounds(bounds)
    }
    win.setMenuBarVisibility(false)
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    win.webContents.on("will-navigate", (event) => event.preventDefault())
    win.webContents.on("console-message", (event) => log("[锁屏页面]", event.message))
    // 页面里的快捷键一律不放行：刷新、开发者工具、关窗口
    win.webContents.on("before-input-event", (event, input) => {
      const key = input.key.toLowerCase()
      const blocked =
        key === "f5" ||
        key === "f11" ||
        key === "f12" ||
        (input.control && ["r", "w", "q"].includes(key)) ||
        (input.control && input.shift && ["i", "j", "c"].includes(key))
      if (blocked) {
        event.preventDefault()
      }
    })
    win.on("close", (event) => {
      if (!tearingDown && !windowed) {
        // Alt+F4 之类：只要还没完成目标，就关不掉
        event.preventDefault()
      }
    })
    win.on("closed", () => {
      windows = windows.filter((item) => item !== win)
      if (primary === win) {
        primary = null
      }
      if (windowed && windows.length === 0) {
        stopGuard()
      }
    })
    void win.loadFile(path.join(__dirname, "popup", "lock.html"), {
      query: isPrimary ? {} : { cover: "1" },
    })
    win.once("ready-to-show", () => win.show())
    return win
  }

  function build() {
    const displays = screen.getAllDisplays()
    const main = screen.getPrimaryDisplay()
    windows = []
    primary = null
    for (const display of windowed ? [main] : displays) {
      const isPrimary = display.id === main.id
      const win = create(display.bounds, isPrimary)
      windows.push(win)
      if (isPrimary) {
        primary = win
      }
    }
  }

  function startGuard() {
    if (guard || windowed) {
      return
    }
    guard = setInterval(() => {
      if (windows.length === 0) {
        return
      }
      const foreground = getForegroundApp()
      if (!shouldRefocus(foreground.exe)) {
        return
      }
      for (const win of windows) {
        if (!win.isDestroyed() && !win.isAlwaysOnTop()) {
          win.setAlwaysOnTop(true, "screen-saver")
        }
      }
      if (primary && !primary.isDestroyed() && !primary.isFocused()) {
        primary.show()
        primary.focus()
        primary.moveTop()
      }
    }, GUARD_INTERVAL_MS)
  }

  function stopGuard() {
    if (guard) {
      clearInterval(guard)
      guard = null
    }
  }

  // 拔插显示器：重新按现在的屏幕盖一遍
  const rebuildOnDisplayChange = () => {
    if (windows.length > 0 && !windowed) {
      log("锁屏", "显示器有变化，重新盖屏")
      destroyAll()
      build()
    }
  }
  /** 创建模块时 app 还没 ready，不能碰 screen；第一次弹出锁屏时再挂 */
  let watchingDisplays = false
  function watchDisplays() {
    if (watchingDisplays) {
      return
    }
    watchingDisplays = true
    screen.on("display-added", rebuildOnDisplayChange)
    screen.on("display-removed", rebuildOnDisplayChange)
  }

  function destroyAll() {
    tearingDown = true
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.destroy()
      }
    }
    windows = []
    primary = null
    tearingDown = false
  }

  ipcMain.handle("lock:init", (event) => {
    if (!isLockSender(event)) {
      return { target: 0, windowed, emergencyPhrase: "" }
    }
    return { ...handlers.getInit(), windowed }
  })
  ipcMain.handle("lock:next", (event, exclude: unknown) => {
    if (!isLockSender(event)) {
      return { ok: false, code: "forbidden", message: "无效的请求" }
    }
    const ids = Array.isArray(exclude)
      ? exclude.filter((id): id is string => typeof id === "string").slice(0, 50)
      : []
    return handlers.next(ids)
  })
  ipcMain.handle("lock:submit", (event, cardId: unknown, typed: unknown, durationMs: unknown) => {
    if (!isLockSender(event) || typeof cardId !== "string" || typeof typed !== "string") {
      return { ok: false, code: "forbidden", message: "无效的请求" }
    }
    return handlers.submit(
      cardId,
      typed.slice(0, 200),
      typeof durationMs === "number" ? durationMs : 0,
    )
  })
  ipcMain.handle("lock:speak", (event, text: unknown) => {
    if (!isLockSender(event) || typeof text !== "string" || !text.trim()) {
      return { ok: false }
    }
    return handlers.speak(text.slice(0, 300))
  })
  ipcMain.on("lock:open-browser", (event) => {
    if (isLockSender(event)) {
      handlers.openBrowser()
    }
  })
  ipcMain.handle("lock:emergency", (event, phrase: unknown) => {
    return isLockSender(event) && typeof phrase === "string" && handlers.emergency(phrase)
  })

  return {
    isShown: () => windows.length > 0,
    show() {
      if (windows.length > 0) {
        return
      }
      log("锁屏", windowed ? "弹出（测试窗口）" : "盖屏")
      watchDisplays()
      build()
      startGuard()
    },
    /** 通知页面可以收尾了（显示"完成啦"），页面自己决定多久之后让主进程关窗 */
    notifyDone(
      reason: "done" | "empty" | "emergency" | "off",
      progress: { done: number; target: number } | null,
    ) {
      if (primary && !primary.isDestroyed()) {
        primary.webContents.send("lock:done", reason, progress)
      }
    },
    hide() {
      if (windows.length === 0) {
        return
      }
      log("锁屏", "放开")
      stopGuard()
      destroyAll()
    },
  }
}

export type LockWindow = ReturnType<typeof createLockWindow>
