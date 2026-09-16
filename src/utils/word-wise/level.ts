/**
 * 「我的英语水平」（阶段五实现方案 · 步骤 2）。
 *
 * 用中国学习者熟悉的考试档位来表示，和离线词表（ECDICT）的难度档一一对应：
 * 1 中考 · 2 高考 · 3 四级 · 4 六级 · 5 考研 · 6 雅思托福 · 7 GRE。
 * 选「四级」的意思是：四级及以下的词大体认识，比它难的词才需要提示。
 */

export const ENGLISH_LEVEL_OPTIONS = [
  { value: 1, label: "初中（中考）" },
  { value: 2, label: "高中（高考）" },
  { value: 3, label: "大学英语四级" },
  { value: 4, label: "大学英语六级" },
  { value: 5, label: "考研英语" },
  { value: 6, label: "雅思 / 托福" },
  { value: 7, label: "GRE" },
] as const

export type EnglishLevel = (typeof ENGLISH_LEVEL_OPTIONS)[number]["value"]

/** 没做过词汇量测试、也没手动选过时的默认水平 */
export const DEFAULT_ENGLISH_LEVEL: EnglishLevel = 2

export function isEnglishLevel(value: unknown): value is EnglishLevel {
  return typeof value === "number" && ENGLISH_LEVEL_OPTIONS.some((option) => option.value === value)
}

/**
 * 词汇量测试估出的词汇量 → 水平档。
 *
 * 门槛参照各考试大纲要求的词汇量（中考约 1600、高考约 3500、四级约 4500、
 * 六级约 6000、考研约 5500 但侧重学术词、雅思托福约 8000）。测试本身是粗估，
 * 这里只用来给一个合理的默认值，用户随时可以在设置里改。
 */
export function levelFromVocabSize(estimatedWords: number): EnglishLevel {
  if (estimatedWords < 1_500) return 1
  if (estimatedWords < 3_000) return 2
  if (estimatedWords < 4_500) return 3
  if (estimatedWords < 6_000) return 4
  if (estimatedWords < 7_000) return 5
  if (estimatedWords < 9_000) return 6
  return 7
}

/** 提示范围：比我的水平高几档的词才提示 */
export type HintRange = "atLevel" | "above1" | "above2"

export const HINT_RANGE_OPTIONS: ReadonlyArray<{ value: HintRange; label: string }> = [
  { value: "atLevel", label: "我这一档及以上的词（巩固）" },
  { value: "above1", label: "高于我的水平的词" },
  { value: "above2", label: "明显超纲的词（高两档及以上）" },
]

export const DEFAULT_HINT_RANGE: HintRange = "above1"

/** 这个难度档的词要不要提示 */
export function needsHint(wordLevel: number, userLevel: EnglishLevel, range: HintRange): boolean {
  const offset = range === "atLevel" ? 0 : range === "above2" ? 2 : 1
  return wordLevel >= userLevel + offset
}
