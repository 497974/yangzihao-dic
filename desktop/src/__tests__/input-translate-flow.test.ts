import type { InputTranslateDeps } from "../input-translate-flow"
import type { ToastState } from "../shared/popup-api"
import { describe, expect, it } from "vitest"
import { runInputTranslate, selectKindFor, skipReason } from "../input-translate-flow"

interface FakeOptions {
  exe?: string
  fullscreen?: boolean
  /** 两次复制分别拿到什么；null = 没复制到 */
  copies?: Array<string | null>
  translation?: string | Error
  /** 翻译完成时前台窗口换成了别的 */
  windowChangesDuringTranslate?: boolean
}

function createFake(options: FakeOptions = {}) {
  const calls: string[] = []
  const notices: Array<ToastState | null> = []
  const copies = [...(options.copies ?? ["你好世界   ", "你好世界   "])]
  let handle = 1n
  const deps: InputTranslateDeps = {
    foreground: () => ({ handle, exe: options.exe ?? "QQ.exe", name: "QQ" }),
    isFullscreen: () => options.fullscreen ?? false,
    selfExe: "electron.exe",
    waitForSpaceRelease: async () => {
      calls.push("wait")
    },
    select: (kind) => calls.push(`select:${kind}`),
    collapse: () => calls.push("collapse"),
    copySelection: async () => {
      calls.push("copy")
      return copies.shift() ?? null
    },
    translate: async (text, source) => {
      calls.push(`translate:${text}:${source}`)
      if (options.windowChangesDuringTranslate) {
        handle = 2n
      }
      if (options.translation instanceof Error) {
        throw options.translation
      }
      return options.translation ?? "Hello world"
    },
    paste: async (text) => {
      calls.push(`paste:${text}`)
    },
    notify: (state) => notices.push(state),
  }
  return { deps, calls, notices }
}

describe("三下空格翻译：选哪些字", () => {
  it.each([
    ["QQ.exe", "all"],
    ["Weixin.exe", "all"],
    ["Discord.exe", "all"],
    ["notepad.exe", "line"],
    ["WINWORD.EXE", "line"],
    [null, "line"],
  ])("%s → %s", (exe, kind) => {
    expect(selectKindFor(exe)).toBe(kind)
  })

  it.each([
    ["chrome.exe", "浏览器"],
    ["msedge.exe", "浏览器"],
    ["WindowsTerminal.exe", "终端"],
    ["Code.exe", "写代码"],
    ["electron.exe", "自己"],
  ])("%s 不处理（%s）", (exe) => {
    expect(skipReason(exe, "electron.exe")).not.toBeNull()
  })

  it("QQ、记事本要处理", () => {
    expect(skipReason("QQ.exe", "electron.exe")).toBeNull()
    expect(skipReason("notepad.exe", "electron.exe")).toBeNull()
  })
})

describe("三下空格翻译：流程", () => {
  it("QQ 里：全选 → 复制 → 翻译 → 核对 → 粘贴译文，提示收起", async () => {
    const { deps, calls, notices } = createFake()
    await expect(runInputTranslate(deps)).resolves.toBe("replaced")
    expect(calls).toEqual([
      "wait",
      "select:all",
      "copy",
      "translate:你好世界:QQ",
      "copy",
      "paste:Hello world",
    ])
    expect(notices).toEqual([{ kind: "working", title: "正在翻译…" }, null])
  })

  it("记事本里只选光标所在这一行", async () => {
    const { deps, calls } = createFake({ exe: "notepad.exe" })
    await runInputTranslate(deps)
    expect(calls).toContain("select:line")
  })

  it("浏览器里什么都不做（扩展自己会翻）", async () => {
    const { deps, calls } = createFake({ exe: "chrome.exe" })
    await expect(runInputTranslate(deps)).resolves.toBe("skipped")
    expect(calls).toEqual([])
  })

  it("全屏程序（游戏）里连按空格不当回事", async () => {
    const { deps, calls } = createFake({ fullscreen: true })
    await expect(runInputTranslate(deps)).resolves.toBe("skipped")
    expect(calls).toEqual([])
  })

  it("复制出来的字结尾没空格：说明空格没打进这个输入框，取消选中、原样不动", async () => {
    const { deps, calls, notices } = createFake({ copies: ["你好世界"] })
    await expect(runInputTranslate(deps)).resolves.toBe("no_text")
    expect(calls).toEqual(["wait", "select:all", "copy", "collapse"])
    expect(notices).toEqual([])
  })

  it("输入框里只有空格：什么都不做", async () => {
    const { deps, calls } = createFake({ copies: ["   "] })
    await expect(runInputTranslate(deps)).resolves.toBe("no_text")
    expect(calls.some((c) => c.startsWith("translate"))).toBe(false)
  })

  it("什么都没复制到：什么都不做", async () => {
    const { deps, calls } = createFake({ copies: [null] })
    await expect(runInputTranslate(deps)).resolves.toBe("no_text")
    expect(calls.some((c) => c.startsWith("translate"))).toBe(false)
  })

  it("翻译失败：提示原因，不粘贴", async () => {
    const { deps, calls, notices } = createFake({ translation: new Error("网络断了") })
    await expect(runInputTranslate(deps)).resolves.toBe("failed")
    expect(calls.some((c) => c.startsWith("paste"))).toBe(false)
    expect(notices.at(-1)).toEqual({ kind: "error", title: "输入翻译没成功", message: "网络断了" })
  })

  it("翻译期间换了窗口：不粘贴", async () => {
    const { deps, calls, notices } = createFake({ windowChangesDuringTranslate: true })
    await expect(runInputTranslate(deps)).resolves.toBe("window_changed")
    expect(calls.some((c) => c.startsWith("paste"))).toBe(false)
    expect(notices.at(-1)).toMatchObject({ kind: "error", title: "没有替换" })
  })

  it("翻译期间输入框里的字变了（用户接着打字、点掉了选区）：不粘贴", async () => {
    const { deps, calls } = createFake({ copies: ["你好世界   ", "你好世界，再见"] })
    await expect(runInputTranslate(deps)).resolves.toBe("changed")
    expect(calls.some((c) => c.startsWith("paste"))).toBe(false)
  })

  it("第二次复制时换行、首尾空白不同不算变了", async () => {
    const { deps } = createFake({ copies: ["第一行\r\n第二行   ", "第一行\n第二行"] })
    await expect(runInputTranslate(deps)).resolves.toBe("replaced")
  })
})
