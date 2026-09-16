/**
 * 桌面版自己的设置（托盘菜单里的开关），存在 %APPDATA%\yangzihao-dic-desktop\settings.json。
 * 查词、翻译用的设置都在浏览器扩展里，这里只放桌面版独有的。
 */

import fs from "node:fs"
import path from "node:path"
import { app } from "electron"

export interface DesktopSettings {
  /** 在浏览器以外的地方连按三下空格，把输入框里的字翻译成外语 */
  tripleSpaceTranslate: boolean
  /** 在浏览器以外的地方选中文字后，旁边弹出划词工具栏 */
  selectionToolbar: boolean
  /** 双击一个词直接查词典，不弹工具栏（默认关：双击后弹工具栏） */
  doubleClickLookup: boolean
  /** 有到期该复习的词时，托盘每天提醒一次 */
  reviewReminder: boolean
  /** 上次提醒复习是哪天（本地日期 YYYY-MM-DD），一天只提醒一次 */
  lastReviewReminderDate: string | null
}

const DEFAULTS: DesktopSettings = {
  tripleSpaceTranslate: true,
  selectionToolbar: true,
  doubleClickLookup: false,
  reviewReminder: true,
  lastReviewReminderDate: null,
}

function settingsFile() {
  return path.join(app.getPath("userData"), "settings.json")
}

export function loadSettings(): DesktopSettings {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(settingsFile(), "utf8"))
    const saved = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}
    return {
      tripleSpaceTranslate:
        typeof saved.tripleSpaceTranslate === "boolean"
          ? saved.tripleSpaceTranslate
          : DEFAULTS.tripleSpaceTranslate,
      selectionToolbar:
        typeof saved.selectionToolbar === "boolean"
          ? saved.selectionToolbar
          : DEFAULTS.selectionToolbar,
      doubleClickLookup:
        typeof saved.doubleClickLookup === "boolean"
          ? saved.doubleClickLookup
          : DEFAULTS.doubleClickLookup,
      reviewReminder:
        typeof saved.reviewReminder === "boolean" ? saved.reviewReminder : DEFAULTS.reviewReminder,
      lastReviewReminderDate:
        typeof saved.lastReviewReminderDate === "string"
          ? saved.lastReviewReminderDate
          : DEFAULTS.lastReviewReminderDate,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(settings: DesktopSettings): void {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
    fs.writeFileSync(settingsFile(), `${JSON.stringify(settings, null, 2)}\n`)
  } catch (error) {
    console.error("保存设置失败", error)
  }
}
