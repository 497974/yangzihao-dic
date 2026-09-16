/**
 * 截图框选页面的 preload：只暴露这几个函数（window.dicCapture），页面本身碰不到 Node 和 Electron。
 */

import type { CaptureRect, DicCaptureApi } from "./shared/popup-api"
import { contextBridge, ipcRenderer } from "electron"

const api: DicCaptureApi = {
  onScreenshot: (listener) => {
    ipcRenderer.on("capture:screenshot", (_event, dataUrl: string) => listener(dataUrl))
  },
  done: (rect: CaptureRect) => ipcRenderer.send("capture:done", rect),
  cancel: () => ipcRenderer.send("capture:cancel"),
}

contextBridge.exposeInMainWorld("dicCapture", api)
