/**
 * 常驻的隐藏小进程（PowerShell 脚本），一问一答：写一行 "<id> <参数>"，它回一行 JSON（带同一个 id）。
 *
 * 读选中文字（selection-context.ts）和截图识字（ocr.ts）都用它：
 * PowerShell 起来要零点几秒，常驻着每次只要几十毫秒；闲置一阵子自动关掉省内存，
 * 连着几次不回话就当它卡死了，重启。
 */

import type { ChildProcess } from "node:child_process"
import { spawn } from "node:child_process"
import path from "node:path"
import readline from "node:readline"

/** 闲置这么久就关掉小进程，下次要用时再起 */
export const IDLE_STOP_MS = 15 * 60_000
/** 连着这么多次没回话，就当小进程卡死了，重启它 */
const MAX_CONSECUTIVE_TIMEOUTS = 3

export interface HelperProcessOptions {
  scriptPath: string
  /** 写日志时怎么称呼它，比如「读文字」「认字」 */
  label: string
  log?: (message: string) => void
  idleStopMs?: number
  /** 测试用：换成别的命令（比如 node 跑一个假的小脚本） */
  command?: { file: string; args: string[] }
}

function powershellPath(): string {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows"
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
}

export function createHelperProcess(options: HelperProcessOptions) {
  const idleStopMs = options.idleStopMs ?? IDLE_STOP_MS
  let child: ChildProcess | null = null
  let nextId = 1
  let consecutiveTimeouts = 0
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const pending = new Map<string, (reply: Record<string, unknown> | null) => void>()

  function settleAll() {
    for (const resolve of pending.values()) {
      resolve(null)
    }
    pending.clear()
  }

  function start(): ChildProcess {
    const command = options.command ?? {
      file: powershellPath(),
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        options.scriptPath,
      ],
    }
    const proc = spawn(command.file, command.args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    })
    readline.createInterface({ input: proc.stdout! }).on("line", (line) => {
      let reply: Record<string, unknown>
      try {
        reply = JSON.parse(line) as Record<string, unknown>
      } catch {
        return
      }
      const resolve = pending.get(String(reply.id))
      if (resolve) {
        pending.delete(String(reply.id))
        resolve(reply)
      }
    })
    proc.on("error", (error) => {
      options.log?.(`${options.label}的小进程起不来：${error.message}`)
    })
    proc.on("exit", () => {
      if (child === proc) {
        child = null
      }
      settleAll()
    })
    proc.stdin?.on("error", () => {})
    child = proc
    return proc
  }

  function stop() {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    const current = child
    child = null
    settleAll()
    current?.kill()
  }

  /** 每用一次就重新计时，闲置够久了关掉 */
  function touch() {
    if (idleTimer) {
      clearTimeout(idleTimer)
    }
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (child) {
        options.log?.(`闲置太久，先关掉${options.label}的小进程`)
        stop()
      }
    }, idleStopMs)
    idleTimer.unref?.()
  }

  return {
    /** 提前把小进程拉起来，别让第一次用的时候去等它 */
    warmUp() {
      if (!child) {
        start()
      }
      touch()
    },

    /** 发一次请求；args 是 id 后面那一段（可以不带）。超时、小进程没了都返回 null */
    request(args: string | undefined, timeoutMs: number): Promise<Record<string, unknown> | null> {
      const proc = child ?? start()
      touch()
      const id = String(nextId++)
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          resolve(null)
          consecutiveTimeouts += 1
          if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
            options.log?.(`${options.label}的小进程一直没回话，重启它`)
            consecutiveTimeouts = 0
            stop()
          }
        }, timeoutMs)
        pending.set(id, (reply) => {
          clearTimeout(timer)
          consecutiveTimeouts = 0
          resolve(reply)
        })
        try {
          proc.stdin?.write(args === undefined ? `${id}\n` : `${id} ${args}\n`)
        } catch {
          pending.delete(id)
          clearTimeout(timer)
          resolve(null)
        }
      })
    },

    isRunning: () => child !== null,
    stop,
  }
}

export type HelperProcess = ReturnType<typeof createHelperProcess>
