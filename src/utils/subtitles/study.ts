/**
 * 视频字幕学习模式（功能路线图阶段四第 1 条）用到的纯逻辑：
 * 找上一句 / 这一句 / 下一句、判断一句刚好播到句尾、把一句字幕拆成可以点的词。
 * 时间单位都是毫秒，和 SubtitlesFragment 一致；字幕按开始时间从早到晚排好。
 */

import type { SubtitlesFragment } from "./types"

type Cue = Pick<SubtitlesFragment, "start" | "end">

/**
 * 这句开始这么久以内按「上一句」，才跳到再上一句；过了这个时间按一下先回到这句开头——
 * 和音乐播放器的「上一首」一样，听漏了一个词按一下就能重听这句。
 */
export const RESTART_THRESHOLD_MS = 1_500
/** 一句结束前这么久就暂停：停在这句的末尾，而不是下一句已经冒出来 */
export const PAUSE_LEAD_MS = 80
/** 两帧之间时间跳了这么多，说明是拖了进度条，不算「播到了句尾」 */
export const MAX_FRAME_JUMP_MS = 1_000

/** 当前这句：正在播的那句；两句之间的空档里，就是刚播完的那句 */
export function findCurrentCue<T extends Cue>(cues: readonly T[], timeMs: number): T | null {
  let current: T | null = null
  for (const cue of cues) {
    if (cue.start > timeMs) {
      break
    }
    current = cue
  }
  return current
}

/** 「上一句」该跳到哪：刚开始播这句 → 再上一句；播了一会儿 → 这句开头 */
export function findPreviousCue<T extends Cue>(cues: readonly T[], timeMs: number): T | null {
  const current = findCurrentCue(cues, timeMs)
  if (!current) {
    return null
  }
  if (timeMs - current.start > RESTART_THRESHOLD_MS) {
    return current
  }
  const index = cues.indexOf(current)
  return index > 0 ? (cues[index - 1] ?? current) : current
}

/** 下一句：开始时间在现在之后的第一句 */
export function findNextCue<T extends Cue>(cues: readonly T[], timeMs: number): T | null {
  return cues.find((cue) => cue.start > timeMs + 1) ?? null
}

/** 这一帧刚好播到某句的句尾（逐句暂停用）；拖进度条造成的时间跳变不算 */
export function cueEndingBetween<T extends Cue>(
  cues: readonly T[],
  previousMs: number,
  nowMs: number,
): T | null {
  if (nowMs <= previousMs || nowMs - previousMs > MAX_FRAME_JUMP_MS) {
    return null
  }
  return (
    cues.find((cue) => {
      const stopAt = cue.end - PAUSE_LEAD_MS
      return previousMs < stopAt && nowMs >= stopAt
    }) ?? null
  )
}

export interface SubtitleToken {
  text: string
  /** 是不是一个可以点着查的英文词 */
  word: boolean
}

/** 英文词：字母开头结尾，中间可以有撇号、连字符（don't、well-known） */
const WORD_PATTERN = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g

/** 把一句字幕拆成一段段：英文词可以点，其余（空格、标点、数字、中文）原样显示 */
export function tokenizeSubtitle(text: string): SubtitleToken[] {
  const tokens: SubtitleToken[] = []
  let cursor = 0
  for (const match of text.matchAll(WORD_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) {
      tokens.push({ text: text.slice(cursor, index), word: false })
    }
    tokens.push({ text: match[0], word: true })
    cursor = index + match[0].length
  }
  if (cursor < text.length) {
    tokens.push({ text: text.slice(cursor), word: false })
  }
  return tokens
}
