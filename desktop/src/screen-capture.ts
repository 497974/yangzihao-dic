/**
 * 截图查词（优化清单第 13 条）的第 2、3 步：把每块屏幕的画面冻住，盖一层能拖框的全屏窗口；
 * 框好后按缩放比例裁出选区、放大，存成临时 PNG 交给认字（ocr.ts）。
 *
 * 先截再框（而不是框完再截）：框的时候盖在上面的窗口会挡住画面；先冻住，框的就是按下快捷键那一刻的样子，
 * 正在播放的视频字幕也能框。
 *
 * 已知限制：独占全屏的游戏截出来可能是黑的（系统不让别的程序截它），改成无边框窗口化就行。
 */

import type { Display, NativeImage } from "electron"
import type { Rect } from "./capture-geometry"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { BrowserWindow, desktopCapturer, ipcMain, screen } from "electron"
import { isRect, toImageRect } from "./capture-geometry"
import { ocrUpscale } from "./ocr"

export interface CapturedRegion {
  display: Pick<Display, "id" | "bounds">
  /** 框选的区域，屏幕逻辑坐标（相对这块屏幕的左上角） */
  rect: Rect
  /** 这块屏幕的整张截图 */
  image: NativeImage
}

/** 每块屏幕截一张图；截图大小取所有屏幕里最大的物理分辨率，保证每块都不被缩小 */
async function captureDisplays(displays: Display[]): Promise<Map<number, NativeImage>> {
  const width = Math.max(
    ...displays.map((display) => Math.round(display.size.width * display.scaleFactor)),
  )
  const height = Math.max(
    ...displays.map((display) => Math.round(display.size.height * display.scaleFactor)),
  )
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
  })
  const images = new Map<number, NativeImage>()
  displays.forEach((display, index) => {
    // display_id 个别系统上是空的，那就按顺序对
    const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[index]
    if (source && !source.thumbnail.isEmpty()) {
      images.set(display.id, source.thumbnail)
    }
  })
  return images
}

interface Session {
  windows: BrowserWindow[]
  /** 哪个页面对应哪块屏幕、哪张截图 */
  byContents: Map<number, { display: Display; image: NativeImage }>
  resolve: (region: CapturedRegion | null) => void
}

export function createRegionSelector() {
  let session: Session | null = null

  function finish(region: CapturedRegion | null) {
    const current = session
    if (!current) {
      return
    }
    session = null
    for (const win of current.windows) {
      if (!win.isDestroyed()) {
        win.destroy()
      }
    }
    current.resolve(region)
  }

  ipcMain.on("capture:done", (event, rect: unknown) => {
    const entry = session?.byContents.get(event.sender.id)
    if (entry && isRect(rect)) {
      finish({ display: entry.display, image: entry.image, rect })
    }
  })
  ipcMain.on("capture:cancel", (event) => {
    if (session?.byContents.has(event.sender.id)) {
      finish(null)
    }
  })

  return {
    isActive: () => session !== null,

    /** 冻住屏幕让用户框选；取消返回 null。截不了屏幕时抛错 */
    async select(): Promise<CapturedRegion | null> {
      if (session) {
        return null
      }
      const displays = screen.getAllDisplays()
      const images = await captureDisplays(displays)
      if (images.size === 0) {
        throw new Error("截不了屏幕：系统没有给出任何屏幕的画面")
      }
      const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())

      return new Promise<CapturedRegion | null>((resolve) => {
        const current: Session = { windows: [], byContents: new Map(), resolve }
        session = current
        for (const display of displays) {
          const image = images.get(display.id)
          if (!image) {
            continue
          }
          const win = new BrowserWindow({
            ...display.bounds,
            show: false,
            frame: false,
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            hasShadow: false,
            enableLargerThanScreen: true,
            backgroundColor: "#000000",
            webPreferences: {
              preload: path.join(__dirname, "capture-preload.js"),
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              spellcheck: false,
            },
          })
          // 盖过任务栏和别的置顶窗口
          win.setAlwaysOnTop(true, "screen-saver")
          win.setBounds(display.bounds)
          win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
          win.webContents.on("will-navigate", (event) => event.preventDefault())
          // 背景只是给人看的，用 JPEG 传得快；真正裁图认字用的是原图
          const dataUrl = `data:image/jpeg;base64,${image.toJPEG(92).toString("base64")}`
          win.webContents.once("did-finish-load", () => {
            win.webContents.send("capture:screenshot", dataUrl)
            win.show()
            if (display.id === cursorDisplay.id) {
              win.focus()
            }
          })
          // 被别的途径关掉（比如 Alt+F4）也当取消
          win.on("closed", () => {
            if (session === current) {
              finish(null)
            }
          })
          void win.loadFile(path.join(__dirname, "popup", "capture.html"))
          current.windows.push(win)
          current.byContents.set(win.webContents.id, { display, image })
        }
      })
    },

    cancel: () => finish(null),
  }
}

export type RegionSelector = ReturnType<typeof createRegionSelector>

/**
 * 从截图里裁出选区、放大（小字放大后才认得出），存成临时 PNG，返回路径；选区太小返回 null。
 * 用完记得 removeTempFile。
 */
export function writeRegionPng(region: CapturedRegion): string | null {
  const rect = toImageRect(region.rect, region.display.bounds, region.image.getSize())
  if (!rect) {
    return null
  }
  const cropped = region.image.crop(rect)
  const scale = ocrUpscale(rect.width, rect.height)
  const scaled =
    scale > 1
      ? cropped.resize({
          width: Math.round(rect.width * scale),
          height: Math.round(rect.height * scale),
          quality: "best",
        })
      : cropped
  const file = path.join(os.tmpdir(), `yzh-ocr-${process.pid}-${Date.now()}.png`)
  fs.writeFileSync(file, scaled.toPNG())
  return file
}

export function removeTempFile(file: string | null) {
  if (file) {
    fs.rm(file, { force: true }, () => {})
  }
}
