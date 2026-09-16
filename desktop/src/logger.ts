/**
 * 桌面版的运行日志：%APPDATA%\yangzihao-dic-desktop\logs\desktop.log。
 *
 * 出问题时（查词没反应、弹窗关不掉……）靠它看清楚到底发生了什么。
 * 只记事件、耗时、错误码，不记用户选中的文字和查词结果。超过 1 MB 就换一个新文件。
 */

import fs from "node:fs"
import path from "node:path"
import { app } from "electron"

const MAX_BYTES = 1024 * 1024
let file: string | null = null

export function logFilePath(): string {
  if (!file) {
    const dir = path.join(app.getPath("userData"), "logs")
    fs.mkdirSync(dir, { recursive: true })
    file = path.join(dir, "desktop.log")
    try {
      if (fs.statSync(file).size > MAX_BYTES) {
        fs.renameSync(file, `${file}.old`)
      }
    } catch {
      // 还没有日志文件
    }
  }
  return file
}

export function log(...parts: unknown[]): void {
  const text = parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
  const line = `${new Date().toISOString()} ${text.join(" ")}`
  console.log(line)
  try {
    fs.appendFileSync(logFilePath(), `${line}\n`)
  } catch {
    // 写不了日志不能影响查词
  }
}
