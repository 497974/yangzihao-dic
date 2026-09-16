/**
 * 桌面版用到的几个 Windows 系统接口：模拟按键、查按键状态、剪贴板序号、前台程序是谁、是不是全屏。
 *
 * 通过 koffi 直接调用 user32 / kernel32，不需要编译原生模块。
 * 第一次用到时才加载；加载失败会抛错，由调用方显示原因。
 *
 * 系统限制：以管理员身份运行的程序，普通权限的桌面版发的按键它收不到，取不了词。
 */

import path from "node:path"
import koffi from "koffi"
import { friendlyAppName } from "./app-names"

const VK_LBUTTON = 0x01
const VK_SHIFT = 0x10
const VK_CONTROL = 0x11
const VK_MENU = 0x12 // Alt
export const VK_SPACE = 0x20
const VK_HOME = 0x24
const VK_RIGHT = 0x27
const VK_A = 0x41
const VK_C = 0x43
const VK_V = 0x56
const VK_LWIN = 0x5b
const VK_RWIN = 0x5c
const VK_LSHIFT = 0xa0
const VK_RSHIFT = 0xa1
const VK_LMENU = 0xa4
const VK_RMENU = 0xa5
/**
 * 一个没分配用途的虚拟键。单独按下再松开 Alt 会激活程序的菜单栏、单独松开 Win 会弹开始菜单；
 * 替用户松开之前先"按"一下它，系统就不会把这当成单独按了 Alt / Win。
 */
const VK_MASK = 0xe8
/** Home、方向键这些在小键盘上也有同名键，要标成"扩展键"，不然有的程序会当成小键盘的 7、6 */
const KEYEVENTF_EXTENDEDKEY = 0x0001
const KEYEVENTF_KEYUP = 0x0002
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const MONITOR_DEFAULTTONEAREST = 2

const SHIFT_KEYS = [VK_SHIFT, VK_LSHIFT, VK_RSHIFT]
const ALT_WIN_KEYS = [VK_MENU, VK_LMENU, VK_RMENU, VK_LWIN, VK_RWIN]
const MODIFIER_KEYS = [...SHIFT_KEYS, ...ALT_WIN_KEYS]

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

function loadApi() {
  const user32 = koffi.load("user32.dll")
  const kernel32 = koffi.load("kernel32.dll")
  const rect = koffi.struct("YZH_RECT", {
    left: "int32_t",
    top: "int32_t",
    right: "int32_t",
    bottom: "int32_t",
  })
  const monitorInfo = koffi.struct("YZH_MONITORINFO", {
    cbSize: "uint32_t",
    rcMonitor: rect,
    rcWork: rect,
    dwFlags: "uint32_t",
  })
  const cursorInfo = koffi.struct("YZH_CURSORINFO", {
    cbSize: "uint32_t",
    flags: "uint32_t",
    hCursor: "void *",
    ptScreenPos: koffi.struct({ x: "int32_t", y: "int32_t" }),
  })
  return {
    cursorInfoSize: koffi.sizeof(cursorInfo),
    GetCursorInfo: user32.func("int __stdcall GetCursorInfo(_Inout_ YZH_CURSORINFO *pci)"),
    LoadCursorW: user32.func(
      "void *__stdcall LoadCursorW(void *hInstance, uintptr_t lpCursorName)",
    ),
    monitorInfoSize: koffi.sizeof(monitorInfo),
    GetAsyncKeyState: user32.func("int16_t __stdcall GetAsyncKeyState(int vKey)"),
    keybd_event: user32.func(
      "void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)",
    ),
    GetClipboardSequenceNumber: user32.func("uint32_t __stdcall GetClipboardSequenceNumber()"),
    GetForegroundWindow: user32.func("void *__stdcall GetForegroundWindow()"),
    GetWindowThreadProcessId: user32.func(
      "uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *lpdwProcessId)",
    ),
    GetWindowRect: user32.func("int __stdcall GetWindowRect(void *hWnd, _Out_ YZH_RECT *lpRect)"),
    MonitorFromWindow: user32.func(
      "void *__stdcall MonitorFromWindow(void *hwnd, uint32_t dwFlags)",
    ),
    GetMonitorInfoW: user32.func(
      "int __stdcall GetMonitorInfoW(void *hMonitor, _Inout_ YZH_MONITORINFO *lpmi)",
    ),
    OpenProcess: kernel32.func(
      "void *__stdcall OpenProcess(uint32_t dwDesiredAccess, int bInheritHandle, uint32_t dwProcessId)",
    ),
    QueryFullProcessImageNameW: kernel32.func(
      "int __stdcall QueryFullProcessImageNameW(void *hProcess, uint32_t dwFlags, void *lpExeName, _Inout_ uint32_t *lpdwSize)",
    ),
    CloseHandle: kernel32.func("int __stdcall CloseHandle(void *hObject)"),
  }
}

let api: ReturnType<typeof loadApi> | null = null

function win32() {
  api ??= loadApi()
  return api
}

export function isKeyDown(vk: number): boolean {
  return (win32().GetAsyncKeyState(vk) & 0x8000) !== 0
}

function key(vk: number, up: boolean, extended = false) {
  const flags = (up ? KEYEVENTF_KEYUP : 0) | (extended ? KEYEVENTF_EXTENDEDKEY : 0)
  win32().keybd_event(vk, 0, flags, 0)
}

function press(vk: number) {
  key(vk, false)
}

function release(vk: number) {
  key(vk, true)
}

/** 按住 modifier 敲一下 vk */
function chord(modifier: number, vk: number, extended = false) {
  press(modifier)
  key(vk, false, extended)
  key(vk, true, extended)
  release(modifier)
}

/** Alt / Shift / Win 是否还按着。Ctrl 按着不影响 Ctrl+C，不算 */
export function isModifierHeld(): boolean {
  return MODIFIER_KEYS.some(isKeyDown)
}

export function releaseModifiers(): void {
  if (ALT_WIN_KEYS.some(isKeyDown)) {
    press(VK_MASK)
    release(VK_MASK)
  }
  for (const vk of MODIFIER_KEYS) {
    if (isKeyDown(vk)) {
      release(vk)
    }
  }
}

/** 鼠标左键现在是不是按着（拖动弹窗时用来判断什么时候停） */
export function isLeftButtonDown(): boolean {
  return isKeyDown(VK_LBUTTON)
}

export function sendCopy(): void {
  chord(VK_CONTROL, VK_C)
}

export function sendPaste(): void {
  chord(VK_CONTROL, VK_V)
}

/** Ctrl+A：全选。聊天软件的输入框里只会选中这条还没发的消息 */
export function sendSelectAll(): void {
  chord(VK_CONTROL, VK_A)
}

/** Shift+Home：从光标选到这一行开头 */
export function sendSelectToLineStart(): void {
  chord(VK_SHIFT, VK_HOME, true)
}

/** →：取消选中，光标停在选区末尾（也就是原来打字的位置） */
export function sendCollapseToEnd(): void {
  key(VK_RIGHT, false, true)
  key(VK_RIGHT, true, true)
}

export function clipboardSequence(): number {
  return win32().GetClipboardSequenceNumber() as number
}

export interface ForegroundApp {
  /** 前台窗口的句柄（数字），用来判断"还是不是同一个窗口" */
  handle: bigint | null
  /** 可执行文件名，比如 QQ.exe */
  exe: string | null
  /** 给人看的名字，比如 QQ */
  name: string | null
}

const NO_FOREGROUND: ForegroundApp = { handle: null, exe: null, name: null }

export function getForegroundApp(): ForegroundApp {
  try {
    const w = win32()
    const hwnd = w.GetForegroundWindow()
    if (!hwnd) {
      return NO_FOREGROUND
    }
    const handle = BigInt(koffi.address(hwnd))
    const pid = [0]
    w.GetWindowThreadProcessId(hwnd, pid)
    if (!pid[0]) {
      return { handle, exe: null, name: null }
    }
    const process = w.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid[0])
    if (!process) {
      return { handle, exe: null, name: null }
    }
    try {
      const capacity = 1024
      const buffer = Buffer.alloc(capacity * 2)
      const size = [capacity]
      if (!w.QueryFullProcessImageNameW(process, 0, buffer, size)) {
        return { handle, exe: null, name: null }
      }
      const fullPath = buffer.toString("utf16le", 0, size[0] * 2)
      return { handle, exe: path.win32.basename(fullPath), name: friendlyAppName(fullPath) }
    } finally {
      w.CloseHandle(process)
    }
  } catch (error) {
    console.error("获取前台程序失败", error)
    return NO_FOREGROUND
  }
}

/** 前台窗口属于哪个程序（给人看的名字）；拿不到就返回 null，不影响查词 */
export function getForegroundAppName(): string | null {
  return getForegroundApp().name
}

const IDC_IBEAM = 32513
const CURSOR_SHOWING = 0x1
let ibeamCursor: bigint | null = null

/**
 * 鼠标现在是不是选文字用的"I 形"光标（而且没被隐藏）。
 *
 * 在文字上按下左键时光标一定是它；游戏里光标要么被藏起来、要么是准星，
 * 拖窗口标题栏、拖滚动条时是箭头。划词工具栏只在 I 形光标上开始的拖选、双击后才弹，
 * 长按开枪、拖窗口就不会误弹。
 */
export function isTextCursor(): boolean {
  try {
    const w = win32()
    ibeamCursor ??= BigInt(koffi.address(w.LoadCursorW(null, IDC_IBEAM)))
    const info = { cbSize: w.cursorInfoSize } as { cbSize: number; flags: number; hCursor: unknown }
    if (!w.GetCursorInfo(info)) {
      return false
    }
    if ((info.flags & CURSOR_SHOWING) === 0 || !info.hCursor) {
      return false
    }
    return BigInt(koffi.address(info.hCursor)) === ibeamCursor
  } catch {
    return false
  }
}

/**
 * 前台窗口是不是盖满了整个屏幕（连任务栏一起）：一般是游戏或者全屏看视频。
 * 这时连按空格多半是在跳、在暂停，不是在打字。桌面本身也算（桌面图标那一层是全屏的）。
 */
export function isForegroundFullscreen(): boolean {
  try {
    const w = win32()
    const hwnd = w.GetForegroundWindow()
    if (!hwnd) {
      return false
    }
    const windowRect = {} as Rect
    if (!w.GetWindowRect(hwnd, windowRect)) {
      return false
    }
    const monitor = w.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)
    if (!monitor) {
      return false
    }
    const info = { cbSize: w.monitorInfoSize } as { cbSize: number; rcMonitor: Rect }
    if (!w.GetMonitorInfoW(monitor, info)) {
      return false
    }
    const screen = info.rcMonitor
    return (
      windowRect.left <= screen.left &&
      windowRect.top <= screen.top &&
      windowRect.right >= screen.right &&
      windowRect.bottom >= screen.bottom
    )
  } catch (error) {
    console.error("判断全屏失败", error)
    return false
  }
}
