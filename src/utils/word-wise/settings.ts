/**
 * 读「我的英语水平」：手动选过的优先；没选过就按词汇量测试的结果推算；都没有就用默认的「高中」。
 * 内容脚本和设置页都用这一份，两边看到的水平保证一致。
 */

import type { EnglishLevel, HintRange } from "./level"
import type { VocabTestResult } from "@/utils/vocab-test/score"
import { storage } from "#imports"
import { VOCAB_TEST_RESULT_KEY } from "@/utils/constants/vocab-test"
import { ENGLISH_LEVEL_KEY, WORD_WISE_RANGE_KEY } from "@/utils/constants/word-wise"
import {
  DEFAULT_ENGLISH_LEVEL,
  DEFAULT_HINT_RANGE,
  isEnglishLevel,
  levelFromVocabSize,
} from "./level"

export type EnglishLevelSource = "manual" | "vocabTest" | "default"

export interface ResolvedEnglishLevel {
  level: EnglishLevel
  source: EnglishLevelSource
}

/** 纯函数：给定手动设置和测试结果，得出水平和来源 */
export function resolveEnglishLevel(
  manual: unknown,
  testResult: Pick<VocabTestResult, "estimatedWords" | "unreliable"> | null,
): ResolvedEnglishLevel {
  if (isEnglishLevel(manual)) {
    return { level: manual, source: "manual" }
  }
  // 乱蒙出来的测试结果不可信，不拿来当默认值
  if (testResult && !testResult.unreliable) {
    return { level: levelFromVocabSize(testResult.estimatedWords), source: "vocabTest" }
  }
  return { level: DEFAULT_ENGLISH_LEVEL, source: "default" }
}

export async function readEnglishLevel(): Promise<ResolvedEnglishLevel> {
  const [manual, testResult] = await Promise.all([
    storage.getItem<unknown>(ENGLISH_LEVEL_KEY),
    storage.getItem<VocabTestResult>(VOCAB_TEST_RESULT_KEY),
  ])
  return resolveEnglishLevel(manual, testResult)
}

export async function readHintRange(): Promise<HintRange> {
  const value = await storage.getItem<HintRange>(WORD_WISE_RANGE_KEY)
  return value === "atLevel" || value === "above1" || value === "above2"
    ? value
    : DEFAULT_HINT_RANGE
}
