/**
 * 取词：拿到用户在任意程序里选中的文字（桌面版方案第 5 步）。
 *
 * Windows 没有"读取别的程序里选中的文字"的通用接口，靠的是模拟一次 Ctrl+C：
 *
 * 1. 等用户松开 Alt / Shift / Win。快捷键是 Ctrl+Alt+D，如果 Alt 还按着就发 Ctrl+C，
 *    程序收到的是 Ctrl+Alt+C，复制不了。一直不松（超过 0.6 秒）就替用户松开
 * 2. 记下现在的剪贴板，发送 Ctrl+C
 * 3. 看剪贴板的「序号」有没有变：系统每次剪贴板内容变化都会把它加一。
 *    没变 = 什么都没选中，这时剪贴板里还是旧内容，千万不能拿旧内容去查
 * 4. 读出文字，然后把用户原来的剪贴板放回去，用户完全感觉不到剪贴板被借用过
 *
 * 系统相关的操作全部从外面注入（真实实现见 windows-input.ts、clipboard-snapshot.ts），
 * 这里只管顺序和时机，方便测试。
 */

export interface SelectionCaptureDeps<Snapshot> {
  snapshotClipboard: () => Promise<Snapshot>
  restoreClipboard: (snapshot: Snapshot) => Promise<void>
  readClipboardText: () => Promise<string>
  clipboardSequence: () => number
  /** Alt / Shift / Win 是否还按着（Ctrl 按着不影响复制，不算） */
  isModifierHeld: () => boolean
  releaseModifiers: () => void
  sendCopy: () => void
  sleep: (ms: number) => Promise<void>
  now: () => number
}

/** text 是整理过的（去掉首尾空白、统一换行）；raw 是剪贴板里的原样，三下空格翻译要看结尾的空格 */
export type CaptureResult =
  | { ok: true; text: string; raw: string }
  | { ok: false; reason: "no_selection" }

/** 最多等用户松开修饰键多久 */
export const MODIFIER_WAIT_MS = 600
/** 发出 Ctrl+C 后最多等程序把内容放进剪贴板多久；有的程序（比如 Word）比较慢 */
export const COPY_WAIT_MS = 800
export const POLL_MS = 15
/** 剪贴板刚变时，有的程序还在分几次往里写不同格式，稍等一下再读 */
export const SETTLE_MS = 30

export async function captureSelection<Snapshot>(
  deps: SelectionCaptureDeps<Snapshot>,
): Promise<CaptureResult> {
  const waitStart = deps.now()
  while (deps.isModifierHeld() && deps.now() - waitStart < MODIFIER_WAIT_MS) {
    await deps.sleep(POLL_MS)
  }
  if (deps.isModifierHeld()) {
    deps.releaseModifiers()
  }

  const snapshot = await deps.snapshotClipboard()
  const sequenceBefore = deps.clipboardSequence()
  deps.sendCopy()

  const copyStart = deps.now()
  const timedOut = () => deps.now() - copyStart >= COPY_WAIT_MS
  let changed = false
  while (!timedOut()) {
    await deps.sleep(POLL_MS)
    if (deps.clipboardSequence() !== sequenceBefore) {
      changed = true
      break
    }
  }
  if (!changed) {
    // 剪贴板没被动过，也就不用恢复
    return { ok: false, reason: "no_selection" }
  }

  try {
    await deps.sleep(SETTLE_MS)
    let text = await deps.readClipboardText()
    // 有的程序先放别的格式、过一会儿才放文字
    while (!text.trim() && !timedOut()) {
      await deps.sleep(POLL_MS)
      text = await deps.readClipboardText()
    }
    const normalized = text.replace(/\r\n?/g, "\n").trim()
    return normalized
      ? { ok: true, text: normalized, raw: text }
      : { ok: false, reason: "no_selection" }
  } finally {
    await deps.restoreClipboard(snapshot)
  }
}
