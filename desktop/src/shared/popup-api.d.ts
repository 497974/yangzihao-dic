/**
 * 查词弹窗（渲染进程）和主进程之间传的数据，两边共用这一份类型。
 * 弹窗页面通过 preload 暴露的 window.dic 和主进程通信。
 */

/** 一个词典字段（和网页查词弹窗里的一行一样） */
export interface PopupField {
  label: string
  value: string
  /** 大模型还没写到这个字段，显示"…" */
  pending: boolean
  /** 这个字段旁边有朗读按钮（词典设置里开了朗读的字段） */
  speakable: boolean
}

/** 弹窗标题栏：标题和图标跟着点的是哪个按钮走（词典、翻译、自定义动作） */
export interface PopupHeader {
  title: string
  icon: "dictionary" | "translate" | "action"
}

export type PopupState = (
/** 刚发出去、还不知道有哪些字段（第一次查词时） */
| { kind: "loading"; text: string; source: string | null; thinking: boolean }
  /** 有字段了；streaming = 大模型还在写 */
  | {
      kind: "result"
      text: string
      source: string | null
      fields: PopupField[]
      streaming: boolean
      /** 推理模型还在思考、一个字段都还没写 */
      thinking: boolean
      fast: boolean
      /** 这个词第几次查（查完才有） */
      lookupCount?: number
      /** 存过的词又查了一次，复习卡提前到了今天 */
      reviewBumped?: boolean
    }
  /** 划词翻译：原文 + 译文；streaming = 大模型还在写 */
  | {
      kind: "translation"
      text: string
      source: string | null
      translated: string
      streaming: boolean
      thinking: boolean
      /** 纯翻译引擎一次返回 */
      fast: boolean
    }
  | {
      kind: "error"
      text: string | null
      source: string | null
      title: string
      message: string
      canRetry: boolean
    }
  /** 浏览器没开：词先记在本地，连上扩展后自动查好、存进生词本 */
  | {
      kind: "queued"
      text: string
      source: string | null
      title: string
      message: string
    }
) & { header?: PopupHeader }

/** 划词工具栏上的一个按钮 */
export interface ToolbarButton {
  kind: "translate" | "speak" | "action"
  name: string
  /** Iconify 图标名，比如 tabler:book-2；不认识的就显示名字的第一个字 */
  icon: string
}

/** 扩展按朗读设置合成好的音频；fallbackText：放不出来时改用系统语音读这段字 */
export interface ToolbarAudio {
  audioBase64: string
  contentType: string
  fallbackText: string
}

export interface DicToolbarApi {
  onButtons: (listener: (buttons: ToolbarButton[]) => void) => void
  /** 用 Windows 自带的语音读 */
  onSpeak: (listener: (text: string) => void) => void
  /** 放扩展合成好的音频 */
  onPlayAudio: (listener: (audio: ToolbarAudio) => void) => void
  /** 点了第几个按钮 */
  click: (index: number) => void
  close: () => void
  /** 鼠标在不在工具栏上：在上面时不自动消失 */
  hover: (inside: boolean) => void
  resize: (width: number, height: number) => void
}

/** 截图查词框出的区域，屏幕逻辑坐标（相对这块屏幕的左上角） */
export interface CaptureRect {
  x: number
  y: number
  width: number
  height: number
}

export interface DicCaptureApi {
  /** 冻住的屏幕画面（data URL），当框选页面的背景 */
  onScreenshot: (listener: (dataUrl: string) => void) => void
  done: (rect: CaptureRect) => void
  cancel: () => void
}

/** 鼠标旁边的小提示（三下空格翻译用） */
export interface ToastState {
  kind: "working" | "error"
  title: string
  message?: string
}

export type SaveOutcome = { ok: true; message: string } | { ok: false; message: string }

export interface DicPopupApi {
  onState: (listener: (state: PopupState) => void) => void
  /** 主进程改了钉住状态（比如弹窗被关掉时自动取消钉住） */
  onPinned: (listener: (pinned: boolean) => void) => void
  save: () => Promise<SaveOutcome>
  retry: () => void
  close: () => void
  setPinned: (pinned: boolean) => void
  resize: (height: number) => void
  /** 按住标题栏开始拖动 / 松开 */
  dragStart: () => void
  dragEnd: () => void
  /** 把译文复制到剪贴板 */
  copy: (text: string) => void
  /** 朗读一段字（主进程决定用扩展的声音还是系统语音） */
  speak: (text: string) => void
}

declare global {
  interface Window {
    dic: DicPopupApi
    /** 划词工具栏页面的 preload 提供 */
    /** 不能叫 toolbar：那是浏览器自带的 window.toolbar */
    dicToolbar: DicToolbarApi
    /** 小提示窗页面提供：显示一条提示，返回内容需要的高度 */
    setToast: (state: ToastState) => number
    /** 截图查词框选页面的 preload 提供 */
    dicCapture: DicCaptureApi
  }
}
