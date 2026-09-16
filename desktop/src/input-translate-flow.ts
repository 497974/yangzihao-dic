/**
 * 三下空格翻译（浏览器以外的地方）：在 QQ、微信、记事本里打完字连按三下空格，
 * 把输入框里的字按扩展「输入翻译」的设置翻译好，替换回去。
 *
 * 桌面程序看不到别的程序输入框里的字，只能借剪贴板：
 * 1. 选中要翻的字：聊天软件用 Ctrl+A（输入框里全选就是这条消息），其它程序只选光标所在这一行
 *    （Shift+Home）——在 Word 里按 Ctrl+A 会把整篇文档换掉
 * 2. 复制出来，确认结尾有空格——说明刚才那三下空格确实打进了这个输入框；
 *    没有就说明是在别的地方按的（游戏、按钮上），什么都不动
 * 3. 交给扩展翻译，同时在鼠标旁边显示「正在翻译…」
 * 4. 替换前再核对一次：窗口没换、选中的字没变，才粘贴译文；用户原来的剪贴板随后放回去
 *
 * 系统相关的操作全部从外面注入（见 main.ts），这里只管顺序和判断，方便测试。
 */

import type { ToastState } from "./shared/popup-api"
import type { ForegroundApp } from "./windows-input"

export type SelectKind = "all" | "line"

export type InputTranslateOutcome =
  | "skipped"
  | "no_text"
  | "failed"
  | "window_changed"
  | "changed"
  | "replaced"

/** 浏览器里由扩展自己做三下空格翻译，桌面版不插手，否则会翻两遍 */
const BROWSERS = new Set(["chrome.exe", "msedge.exe", "firefox.exe"])

/**
 * 不处理的程序：
 * - 终端：没选中文字时 Ctrl+C 会中断正在运行的程序
 * - 写代码的软件：连按空格缩进、对齐太常见
 */
const CODE_TOOLS = new Set([
  "windowsterminal.exe",
  "wt.exe",
  "cmd.exe",
  "powershell.exe",
  "pwsh.exe",
  "conhost.exe",
  "openconsole.exe",
  "mintty.exe",
  "putty.exe",
  "wsl.exe",
  "code.exe",
  "cursor.exe",
  "devenv.exe",
  "idea64.exe",
  "pycharm64.exe",
  "webstorm64.exe",
  "clion64.exe",
  "goland64.exe",
  "rider64.exe",
  "sublime_text.exe",
  "notepad++.exe",
])

/** 输入框是独立一块、Ctrl+A 只会选中这条消息的聊天软件 */
const SELECT_ALL_APPS = new Set([
  "qq.exe",
  "tim.exe",
  "weixin.exe",
  "wechat.exe",
  "wxwork.exe",
  "dingtalk.exe",
  "feishu.exe",
  "lark.exe",
  "discord.exe",
  "telegram.exe",
  "slack.exe",
])

export function skipReason(exe: string | null, selfExe: string): string | null {
  if (!exe) {
    return "认不出前台程序"
  }
  const name = exe.toLowerCase()
  if (name === selfExe.toLowerCase()) {
    return "桌面版自己的窗口"
  }
  if (BROWSERS.has(name)) {
    return "浏览器里由扩展负责"
  }
  if (CODE_TOOLS.has(name)) {
    return "终端和写代码的软件不处理"
  }
  return null
}

export function selectKindFor(exe: string | null): SelectKind {
  return exe && SELECT_ALL_APPS.has(exe.toLowerCase()) ? "all" : "line"
}

export interface InputTranslateDeps {
  foreground: () => ForegroundApp
  isFullscreen: () => boolean
  /** 桌面版自己的可执行文件名 */
  selfExe: string
  /** 等用户松开空格、那一下空格真正打进输入框 */
  waitForSpaceRelease: () => Promise<void>
  select: (kind: SelectKind) => void
  /** 取消选中，光标回到末尾 */
  collapse: () => void
  /** 复制当前选中的字，返回剪贴板里的原样；什么都没复制到返回 null（剪贴板会被还原） */
  copySelection: () => Promise<string | null>
  translate: (text: string, source: string | null) => Promise<string>
  /** 用译文替换当前选中的字 */
  paste: (text: string) => Promise<void>
  /** 鼠标旁的小提示；null = 收起 */
  notify: (state: ToastState | null) => void
  log?: (...parts: unknown[]) => void
}

const normalize = (text: string) => text.replace(/\r\n?/g, "\n").trim()

export async function runInputTranslate(deps: InputTranslateDeps): Promise<InputTranslateOutcome> {
  const app = deps.foreground()
  const reason = skipReason(app.exe, deps.selfExe)
  if (reason) {
    deps.log?.("输入翻译", `跳过：${reason}`)
    return "skipped"
  }
  if (deps.isFullscreen()) {
    deps.log?.("输入翻译", "跳过：前台是全屏程序")
    return "skipped"
  }

  await deps.waitForSpaceRelease()
  deps.select(selectKindFor(app.exe))
  const copied = await deps.copySelection()
  if (copied === null) {
    return "no_text"
  }
  // 结尾没有空格：刚才的三下空格没打进这个输入框（游戏、按钮……），原样不动
  if (!/\s$/.test(copied)) {
    deps.collapse()
    return "no_text"
  }
  const text = normalize(copied)
  if (!text) {
    deps.collapse()
    return "no_text"
  }

  deps.notify({ kind: "working", title: "正在翻译…" })
  let translated: string
  try {
    translated = normalize(await deps.translate(text, app.name))
  } catch (error) {
    deps.notify({
      kind: "error",
      title: "输入翻译没成功",
      message: error instanceof Error ? error.message : String(error),
    })
    return "failed"
  }

  // 翻译要等一会儿，这期间用户可能换了窗口、接着打了字、点掉了选区——都不能硬替换
  if (deps.foreground().handle !== app.handle) {
    deps.notify({
      kind: "error",
      title: "没有替换",
      message: "翻译期间切换了窗口，原文没动。",
    })
    return "window_changed"
  }
  const again = await deps.copySelection()
  if (again === null || normalize(again) !== text) {
    deps.notify({
      kind: "error",
      title: "没有替换",
      message: "翻译期间输入框里的字变了（或者选中的范围没了），原文没动。",
    })
    return "changed"
  }

  await deps.paste(translated)
  deps.notify(null)
  return "replaced"
}
