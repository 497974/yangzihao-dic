/**
 * 词汇量测试怎么算分（功能路线图阶段四第 3 条）。纯逻辑，方便测试。
 *
 * 核心是「扣掉蒙的部分」：假词上答了几个「认识」，就说明有多高的比例是在蒙，
 * 真词的正确率按这个比例校正回去。全都点「认识」的人，最后分数接近 0。
 */

import type { Band } from "./word-bank"
import { BAND_SIZE, BANDS } from "./word-bank"

export interface TestAnswer {
  word: string
  band: Band | null
  /** 用户答的：认识 = true */
  known: boolean
}

export interface BandResult {
  band: Band
  total: number
  known: number
  /** 校正后的认识比例（0~1） */
  rate: number
}

export interface VocabTestResult {
  takenAt: number
  /** 粗略估计认识多少个英语常用词 */
  estimatedWords: number
  /** 假词答「认识」的比例：太高说明在乱蒙，结果不可信 */
  falseAlarmRate: number
  /** 乱蒙得太多，这次结果不作数 */
  unreliable: boolean
  bands: BandResult[]
  /** 答了「不认识」的真词，测完可以拿去查、去背 */
  unknownWords: string[]
}

/** 假词里答「认识」超过这个比例，就当是在乱蒙 */
export const UNRELIABLE_FALSE_ALARM = 0.4

/**
 * 校正公式：(答对率 − 乱蒙率) / (1 − 乱蒙率)。
 * 乱蒙率 0 时就是原始答对率；乱蒙率越高，扣得越狠。
 */
export function correctRate(rawRate: number, falseAlarmRate: number): number {
  if (falseAlarmRate >= 1) {
    return 0
  }
  return Math.max(0, (rawRate - falseAlarmRate) / (1 - falseAlarmRate))
}

export function scoreVocabTest(answers: readonly TestAnswer[], now = Date.now()): VocabTestResult {
  const fakes = answers.filter((answer) => answer.band === null)
  const falseAlarmRate = fakes.length
    ? fakes.filter((answer) => answer.known).length / fakes.length
    : 0

  const bands: BandResult[] = []
  let estimatedWords = 0
  for (const band of BANDS) {
    const inBand = answers.filter((answer) => answer.band === band)
    if (inBand.length === 0) {
      continue
    }
    const known = inBand.filter((answer) => answer.known).length
    const rate = correctRate(known / inBand.length, falseAlarmRate)
    bands.push({ band, total: inBand.length, known, rate })
    estimatedWords += BAND_SIZE[band] * rate
  }

  return {
    takenAt: now,
    estimatedWords: Math.round(estimatedWords / 100) * 100,
    falseAlarmRate,
    unreliable: falseAlarmRate > UNRELIABLE_FALSE_ALARM,
    bands,
    unknownWords: answers
      .filter((answer) => answer.band !== null && !answer.known)
      .map((answer) => answer.word),
  }
}

export interface VocabLevel {
  label: string
  /** 按这个水平，每天学几个新词比较合适 */
  dailyNewWords: number
  advice: string
}

/** 估出来的词汇量 → 水平说明和每天新词数的建议 */
export function describeLevel(estimatedWords: number): VocabLevel {
  if (estimatedWords < 1_500) {
    return {
      label: "入门",
      dailyNewWords: 5,
      advice: "建议先掌握最常用的那批词：每天 5 个新词，配合闪卡复习，不必贪多",
    }
  }
  if (estimatedWords < 3_000) {
    return {
      label: "初级",
      dailyNewWords: 8,
      advice: "已能读懂日常文章的大意。建议多读英文材料、多看带字幕的视频，遇到生词随手保存",
    }
  }
  if (estimatedWords < 5_000) {
    return {
      label: "中级",
      dailyNewWords: 10,
      advice: "已能读懂大部分新闻。接下来以语境积累为主：在视频字幕中查词，并记录生词出处",
    }
  }
  if (estimatedWords < 8_000) {
    return {
      label: "中高级",
      dailyNewWords: 12,
      advice: "词汇量已不是主要瓶颈，建议把重心转向表达：造句练习与写作纠错",
    }
  }
  return {
    label: "高级",
    dailyNewWords: 15,
    advice: "余下多为低频词，可通过大量阅读自然积累；建议转向写作与口语的准确度",
  }
}
