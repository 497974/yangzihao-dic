/**
 * 全局键盘钩子（WH_KEYBOARD_LL）：在任何程序里打字，这里都能知道按了哪个键。
 * 只用来数「三下空格」（triple-space.ts）和「一打字就收起划词工具栏」，
 * 不记录、不保存、不改动任何按键。
 *
 * 系统在主线程上同步调用钩子：回调里只做最少的事，而且一定把按键原样往下传。
 * 回调慢了，全机打字都会跟着卡（系统等不及还会把钩子悄悄摘掉）。
 */

import koffi from "koffi"

export interface HookKeyEvent {
  vk: number
  down: boolean
  /** 系统给的按键时间（毫秒） */
  time: number
}

export interface KeyboardHook {
  stop: () => void
}

const WH_KEYBOARD_LL = 13
const WM_KEYDOWN = 0x0100
const WM_KEYUP = 0x0101
const WM_SYSKEYDOWN = 0x0104
const WM_SYSKEYUP = 0x0105

function loadHookApi() {
  const user32 = koffi.load("user32.dll")
  const kernel32 = koffi.load("kernel32.dll")
  const keyInfo = koffi.struct("YZH_KBDLLHOOKSTRUCT", {
    vkCode: "uint32_t",
    scanCode: "uint32_t",
    flags: "uint32_t",
    time: "uint32_t",
    dwExtraInfo: "uintptr_t",
  })
  const hookProc = koffi.proto(
    "intptr_t __stdcall YZH_LowLevelKeyboardProc(int nCode, uintptr_t wParam, void *lParam)",
  )
  return {
    keyInfo,
    hookProc,
    SetWindowsHookExW: user32.func(
      "void *__stdcall SetWindowsHookExW(int idHook, YZH_LowLevelKeyboardProc *lpfn, void *hmod, uint32_t dwThreadId)",
    ),
    CallNextHookEx: user32.func(
      "intptr_t __stdcall CallNextHookEx(void *hhk, int nCode, uintptr_t wParam, void *lParam)",
    ),
    UnhookWindowsHookEx: user32.func("int __stdcall UnhookWindowsHookEx(void *hhk)"),
    GetModuleHandleW: kernel32.func("void *__stdcall GetModuleHandleW(void *lpModuleName)"),
  }
}

let hookApi: ReturnType<typeof loadHookApi> | null = null

export function startKeyboardHook(onKey: (event: HookKeyEvent) => void): KeyboardHook {
  hookApi ??= loadHookApi()
  const h = hookApi
  let hook: unknown = null

  const callback = koffi.register((nCode: number, wParam: number | bigint, lParam: unknown) => {
    if (nCode === 0) {
      try {
        const message = Number(wParam)
        const down = message === WM_KEYDOWN || message === WM_SYSKEYDOWN
        if (down || message === WM_KEYUP || message === WM_SYSKEYUP) {
          const info = koffi.decode(lParam, h.keyInfo) as { vkCode: number; time: number }
          onKey({ vk: info.vkCode, down, time: info.time })
        }
      } catch {
        // 数空格出了错也绝不能影响打字
      }
    }
    return h.CallNextHookEx(hook, nCode, wParam, lParam)
  }, koffi.pointer(h.hookProc))

  hook = h.SetWindowsHookExW(WH_KEYBOARD_LL, callback, h.GetModuleHandleW(null), 0)
  if (!hook) {
    koffi.unregister(callback)
    throw new Error("装不上键盘钩子")
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
