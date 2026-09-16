/**
 * 词汇量测试的词库（功能路线图阶段四第 3 条）。
 *
 * 做法学 LexTALE：给一串词，你只回答「认识 / 不认识」，中间混进一批**假词**——
 * 拼写像英文但根本不存在。假词上点了多少「认识」，就说明蒙了多少，
 * 真词的正确率按这个比例扣回去（见 score.ts）。不用打字、不用选释义，两分钟能测完。
 *
 * 真词按词频分成五档，每档代表英语里大概有多少词：认得第三档的一半，
 * 就大致认得那一档对应的一半词。档位越高越冷僻。
 */

export type Band = 1 | 2 | 3 | 4 | 5

export interface TestItem {
  word: string
  /** 假词没有档位 */
  band: Band | null
}

/** 每档大致覆盖多少个英语常用词——估算词汇量时按这个加权（见 estimateVocabulary） */
export const BAND_SIZE: Record<Band, number> = {
  1: 1_000,
  2: 1_000,
  3: 2_000,
  4: 3_000,
  5: 3_000,
}

export const BAND_LABEL: Record<Band, string> = {
  1: "最常用（约前 1000 词）",
  2: "常用（1000–2000 词）",
  3: "中级（2000–4000 词）",
  4: "中高级（4000–7000 词）",
  5: "高级（7000 词以上）",
}

const REAL_WORDS: Record<Band, readonly string[]> = {
  1: ["begin", "answer", "winter", "forget", "bridge", "pocket"],
  2: ["sudden", "marble", "whisper", "polite", "ancient", "narrow", "harvest", "stubborn"],
  3: [
    "cautious",
    "drawer",
    "plunge",
    "ripple",
    "brittle",
    "vague",
    "spouse",
    "thrive",
    "soothe",
    "meadow",
  ],
  4: [
    "quench",
    "wary",
    "gauge",
    "prone",
    "tepid",
    "wane",
    "deft",
    "coax",
    "brisk",
    "sparse",
    "candid",
  ],
  5: [
    "obfuscate",
    "laconic",
    "quixotic",
    "ephemeral",
    "recalcitrant",
    "perfunctory",
    "sycophant",
    "garrulous",
    "ineffable",
    "truculent",
  ],
}

/**
 * 假词：拼写、读音都像英文，但英语里没有这个词。
 * 故意做得和真词很像（tebulate 之于 tabulate），蒙的人才会中招。
 */
const FAKE_WORDS: readonly string[] = [
  "plaustic",
  "trombide",
  "kellage",
  "fronial",
  "spandric",
  "morlish",
  "tebulate",
  "quaverine",
  "blorent",
  "hestical",
  "nubrate",
  "scrandle",
  "vosket",
  "dromative",
  "prantic",
]

export const BANDS: readonly Band[] = [1, 2, 3, 4, 5]

export const REAL_ITEMS: readonly TestItem[] = BANDS.flatMap((band) =>
  REAL_WORDS[band].map((word) => ({ word, band })),
)

export const FAKE_ITEMS: readonly TestItem[] = FAKE_WORDS.map((word) => ({ word, band: null }))

/** 整套题目 */
export const ALL_ITEMS: readonly TestItem[] = [...REAL_ITEMS, ...FAKE_ITEMS]

/**
 * 洗牌：真词假词必须打散，不然一眼看出「后面这批都是假的」，测出来就没意义了。
 * 传 random 是为了测试里能固定顺序。
 */
export function shuffleItems(
  items: readonly TestItem[] = ALL_ITEMS,
  random: () => number = Math.random,
): TestItem[] {
  const shuffled = [...items]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  return shuffled
}
