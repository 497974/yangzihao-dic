/**
 * 视频字幕里点了一个词（字幕学习模式）：字幕脚本发出这个事件，划词脚本收到后直接用词典查这个词，
 * 整句字幕当语境。两个脚本是同一个扩展的内容脚本，共用一个隔离环境，window 事件的 detail 能原样拿到。
 */
export const SUBTITLE_WORD_LOOKUP_EVENT = "yangzihao-dic:subtitle-word-lookup"

export interface SubtitleWordLookupDetail {
  /** 点的那个词 */
  text: string
  /** 这个词所在的整句字幕 */
  sentence: string
  /** 弹窗放在哪（视口坐标，一般是这个词的左下角） */
  anchor: { x: number; y: number }
  /** 这句字幕在视频里从哪开始（毫秒）：存词时记成出处，复习时从这句开始放 */
  videoTimeMs?: number
}

/** 「每句播完自动暂停」开关记在这里，下次看视频还是这样 */
export const SUBTITLE_STUDY_AUTO_PAUSE_KEY = "local:subtitleStudyAutoPause" as const
