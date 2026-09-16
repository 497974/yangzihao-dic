/**
 * 全局鼠标钩子（WH_MOUSE_LL）：只看左键的按下和松开，用来判断"刚选中了一段文字"
 * （selection-gesture.ts）和"点到了工具栏外面"。不记录、不改动任何鼠标操作。
 *
 * 和键盘钩子一样：系统在主线程上同步调用，回调里只做最少的事，而且一定往下传。
 */

import koffi from "koffi"

export interface HookMouseEvent {
  type: "down" | "up"
  /** 屏幕物理像素 */
  x: number
  y: number
  time: number
}

export interface MouseHook {
  stop: () => void
}

const WH_MOUSE_LL = 14
const WM_LBUTTONDOWN = 0x0201
const WM_LBUTTONUP = 0x0202

function loadMouseHookApi() {
  const user32 = koffi.load("user32.dll")
  const kernel32 = koffi.load("kernel32.dll")
  const point = koffi.struct("YZH_POINT", { x: "int32_t", y: "int32_t" })
  const mouseInfo = koffi.struct("YZH_MSLLHOOKSTRUCT", {
    pt: point,
    mouseData: "uint32_t",
    flags: "uint32_t",
    time: "uint32_t",
    dwExtraInfo: "uintptr_t",
  })
  const hookProc = koffi.proto(
    "intptr_t __stdcall YZH_LowLevelMouseProc(int nCode, uintptr_t wParam, void *lParam)",
  )
  return {
    mouseInfo,
    hookProc,
    SetWindowsHookExW: user32.func(
      "void *__stdcall SetWindowsHookExW(int idHook, YZH_LowLevelMouseProc *lpfn, void *hmod, uint32_t dwThreadId)",
    ),
    CallNextHookEx: user32.func(
      "intptr_t __stdcall CallNextHookEx(void *hhk, int nCode, uintptr_t wParam, void *lParam)",
    ),
    UnhookWindowsHookEx: user32.func("int __stdcall UnhookWindowsHookEx(void *hhk)"),
    GetModuleHandleW: kernel32.func("void *__stdcall GetModuleHandleW(void *lpModuleName)"),
  }
}

let mouseHookApi: ReturnType<typeof loadMouseHookApi> | null = null

export function startMouseHook(onButton: (event: HookMouseEvent) => void): MouseHook {
  mouseHookApi ??= loadMouseHookApi()
  const h = mouseHookApi
  let hook: unknown = null

  const callback = koffi.register((nCode: number, wParam: number | bigint, lParam: unknown) => {
    if (nCode === 0) {
      try {
        const message = Number(wParam)
        if (message === WM_LBUTTONDOWN || message === WM_LBUTTONUP) {
          const info = koffi.decode(lParam, h.mouseInfo) as {
            pt: { x: number; y: number }
            time: number
          }
          onButton({
            type: message === WM_LBUTTONDOWN ? "down" : "up",
            x: info.pt.x,
            y: info.pt.y,
            time: info.time,
          })
        }
      } catch {
        // 判断出了错也绝不能影响鼠标
      }
    }
    return h.CallNextHookEx(hook, nCode, wParam, lParam)
  }, koffi.pointer(h.hookProc))

  hook = h.SetWindowsHookExW(WH_MOUSE_LL, callback, h.GetModuleHandleW(null), 0)
  if (!hook) {
    koffi.unregister(callback)
    throw new Error("装不上鼠标钩子，划词工具栏用不了")
  }

  let stopped = false
  return {
    stop() {
      if (stopped) {
        return
      }
      stopped = true
      h.UnhookWindowsHookEx(hook)
      koffi.unregister(callback)
    },
  }
}
