/**
 * 划词工具栏页面的 preload：只暴露这几个函数（window.toolbar），页面本身碰不到 Node 和 Electron。
 */

import type { DicToolbarApi, ToolbarAudio, ToolbarButton } from "./shared/popup-api"
import { contextBridge, ipcRenderer } from "electron"

const api: DicToolbarApi = {
  onButtons: (listener) => {
    ipcRenderer.on("toolbar:buttons", (_event, buttons: ToolbarButton[]) => listener(buttons))
  },
  onSpeak: (listener) => {
    ipcRenderer.on("toolbar:speak", (_event, text: string) => listener(text))
  },
  onPlayAudio: (listener) => {
    ipcRenderer.on("toolbar:play-audio", (_event, audio: ToolbarAudio) => listener(audio))
  },
  click: (index) => ipcRenderer.send("toolbar:click", index),
  close: () => ipcRenderer.send("toolbar:close"),
  hover: (inside) => ipcRenderer.send("toolbar:hover", inside),
  resize: (width, height) => ipcRenderer.send("toolbar:resize", width, height),
}

// 不能叫 toolbar：那是浏览器自带的 window.toolbar
contextBridge.exposeInMainWorld("dicToolbar", api)
