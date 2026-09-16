/**
 * 弹窗页面的 preload：只暴露这几个函数给页面（window.dic），页面本身碰不到 Node 和 Electron。
 */

import type { DicPopupApi, PopupState, SaveOutcome } from "./shared/popup-api"
import { contextBridge, ipcRenderer } from "electron"

const api: DicPopupApi = {
  onState: (listener) => {
    ipcRenderer.on("popup:state", (_event, state: PopupState) => listener(state))
  },
  onPinned: (listener) => {
    ipcRenderer.on("popup:pinned", (_event, pinned: boolean) => listener(pinned))
  },
  save: () => ipcRenderer.invoke("popup:save") as Promise<SaveOutcome>,
  retry: () => ipcRenderer.send("popup:retry"),
  close: () => ipcRenderer.send("popup:close"),
  setPinned: (pinned) => ipcRenderer.send("popup:pin", pinned),
  resize: (height) => ipcRenderer.send("popup:resize", height),
  dragStart: () => ipcRenderer.send("popup:drag-start"),
  dragEnd: () => ipcRenderer.send("popup:drag-end"),
  copy: (text) => ipcRenderer.send("popup:copy", text),
  speak: (text) => ipcRenderer.send("popup:speak", text),
}

contextBridge.exposeInMainWorld("dic", api)
