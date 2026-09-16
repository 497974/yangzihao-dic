/**
 * 数「连按三下空格」。规则和浏览器扩展的输入翻译一样（use-input-translation.ts）：
 * - 相邻两下空格间隔不超过 300 毫秒
 * - 中间按了别的键就重新数
 * 多加了一条：按住空格不放产生的自动连发不算（扩展里没管这个，桌面版在所有程序里都生效，更要小心）。
 *
 * 纯逻辑，按键从键盘钩子喂进来（keyboard-hook.ts）。
 */

import { VK_SPACE_CODE } from "./key-codes"

export const TRIPLE_SPACE_THRESHOLD_MS = 300
export const TRIPLE_SPACE_COUNT = 3

export interface KeyEvent {
  vk: number
  down: boolean
  /** 毫秒 */
  time: number
}

export function createTripleSpaceDetector(options: { thresholdMs?: number; count?: number } = {}) {
  const thresholdMs = options.thresholdMs ?? TRIPLE_SPACE_THRESHOLD_MS
  const count = options.count ?? TRIPLE_SPACE_COUNT
  let presses: number[] = []
  let spaceHeld = false

  return {
    /** 喂一个按键；返回 true 表示刚好凑齐三下 */
    handle(event: KeyEvent): boolean {
      if (event.vk !== VK_SPACE_CODE) {
        // 别的键按下就重新数；别的键松开不算（打字快的时候，字母键常常在空格按下之后才松开）
        if (event.down) {
          presses = []
        }
        return false
      }
      if (!event.down) {
        spaceHeld = false
        return false
      }
      if (spaceHeld) {
        // 按住不放的自动连发
        presses = []
        return false
      }
      spaceHeld = true
      const last = presses.at(-1)
      if (last !== undefined && event.time - last > thresholdMs) {
        presses = []
      }
      presses.push(event.time)
      if (presses.length >= count) {
        presses = []
        return true
      }
      return false
    },
    reset() {
      presses = []
      spaceHeld = false
    },
  }
}

export type TripleSpaceDetector = ReturnType<typeof createTripleSpaceDetector>
