/**
 * 每日必学锁屏窗口（渲染进程）和主进程之间传的数据。页面通过 lock-preload 暴露的
 * window.dicLock 和主进程通信。题目的形状和 protocol.ts 里的 DailyGoalQuestion 一致。
 */

export interface LockQuestion {
  cardId: string
  mode: "intro" | "spell" | "cloze"
  word: string
  /** 都算对的写法 */
  answers: string[]
  phonetic: string
  partOfSpeech: string
  definition: string
  sentence: string
  sentenceTranslation: string
  mnemonic: string
}

export interface LockProgress {
  /** 今天已经答对几题 */
  done: number
  /** 今天的目标 */
  target: number
}

export type LockReply<T> = ({ ok: true } & T) | { ok: false; code: string; message: string }

export type LockNext = LockReply<{
  progress: LockProgress
  /** 没题可出了（今天的词都答完了）是 null */
  question: LockQuestion | null
}>

/**
 * 交答案的结果。correct = 打对了；retry = 新词照着打错了，不算成绩、让他再打一遍；
 * answers = 标准写法，答错时显示给他看
 */
export type LockSubmit = LockReply<{
  correct: boolean
  retry: boolean
  answers: string[]
  progress: LockProgress
}>

/** 为什么放开：done = 目标完成；empty = 没有更多词可答；emergency = 紧急解锁；off = 在托盘里关了 */
export type LockDoneReason = "done" | "empty" | "emergency" | "off"

export interface DicLockApi {
  init: () => Promise<{ target: number; windowed: boolean; emergencyPhrase: string }>
  next: (exclude: string[]) => Promise<LockNext>
  submit: (cardId: string, typed: string, durationMs: number) => Promise<LockSubmit>
  speak: (
    text: string,
  ) => Promise<{ ok: true; audioBase64: string; contentType: string } | { ok: false }>
  /** 启动浏览器，让词典扩展连上桌面版 */
  openBrowser: () => void
  /** 返回 true = 口令对了，已解锁 */
  emergencyUnlock: (phrase: string) => Promise<boolean>
  onDone: (listener: (reason: LockDoneReason, progress: LockProgress | null) => void) => void
}

declare global {
  interface Window {
    dicLock: DicLockApi
  }
}
