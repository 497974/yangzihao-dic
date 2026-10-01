/**
 * 每日必学锁屏页面的 preload：只暴露 window.dicLock 这几个函数，页面碰不到 Node 和 Electron。
 */

import type { DicLockApi, LockDoneReason, LockProgress } from "./shared/lock-api"
import { contextBridge, ipcRenderer } from "electron"

const api: DicLockApi = {
  init: () => ipcRenderer.invoke("lock:init") as ReturnType<DicLockApi["init"]>,
  next: (exclude) => ipcRenderer.invoke("lock:next", exclude) as ReturnType<DicLockApi["next"]>,
  submit: (cardId, typed, durationMs) =>
    ipcRenderer.invoke("lock:submit", cardId, typed, durationMs) as ReturnType<
      DicLockApi["submit"]
    >,
  speak: (text) => ipcRenderer.invoke("lock:speak", text) as ReturnType<DicLockApi["speak"]>,
  openBrowser: () => ipcRenderer.send("lock:open-browser"),
  emergencyUnlock: (phrase) => ipcRenderer.invoke("lock:emergency", phrase) as Promise<boolean>,
  onDone: (listener) => {
    ipcRenderer.on("lock:done", (_event, reason: LockDoneReason, progress: LockProgress | null) =>
      listener(reason, progress),
    )
  },
}

contextBridge.exposeInMainWorld("dicLock", api)
