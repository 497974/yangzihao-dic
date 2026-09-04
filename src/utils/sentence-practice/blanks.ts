/**
 * 造句练习 · 挖空与判定
 *
 * 给一句英文原句，切成词元、挑出要挖空的词、逐空判对错。全是纯函数，跟界面
 * 解耦，方便单独调整难度策略而不动 UI。
 *
 * 判定刻意做成"逐空独立"：一个空错了只标这一个空，其余对的照常锁定，错的保留
 * 用户输入让他自己改——而不是整句判错、把答案全抖出来。空是可以乱序填的，
 * 所以判定不能依赖填写顺序。
 */

/** 一句里最多挖几个空——再多就从"练句型"变成"默写酷刑"了 */
const MAX_BLANKS = 6

/** 词数不超过这个值就整句全挖，超过了只挖实词 */
const BLANK_ALL_MAX_WORDS = 8

/**
 * 挖空时跳过的功能词。挖这些词考不出什么东西（谁都能猜到 the/of），
 * 留着还能当骨架，帮人看出句子结构。
 */
const FUNCTION_WORDS = new Set([
  "a",
  "an",
  "the",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "me",
  "him",
  "her",
  "us",
  "them",
  "my",
  "your",
  "his",
  "its",
  "our",
  "their",
  "is",
  "am",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "will",
  "would",
  "can",
  "could",
  "shall",
  "should",
  "may",
  "might",
  "must",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "with",
  "by",
  "from",
  "as",
  "into",
  "and",
  "or",
  "but",
  "so",
  "if",
  "than",
  "that",
  "this",
  "these",
  "those",
  "not",
  "no",
  "there",
  "here",
])

export interface SentenceToken {
  /** 渲染用的稳定 key。同一句里可能出现重复的词，光用 text 会撞，所以带上位置 */
  key: string
  /** 原文形态，用于展示和比对 */
  text: string
  /** 标点为 false —— 标点从不挖空，直接显示 */
  isWord: boolean
  /** 挖空的话，这是它在空位序列里的下标；没挖空为 null */
  blankIndex: number | null
}

/**
 * 切词元：单词（含内部的撇号和连字符，如 don't、well-known）与标点分开，
 * 顺序原样保留，拼回去要能还原成原句。
 */
export function tokenizeSentence(sentence: string): SentenceToken[] {
  const matches = sentence.match(/[A-Za-z0-9]+(?:['''’-][A-Za-z0-9]+)*|[^\sA-Za-z0-9]+/g)
  if (!matches) return []
  return matches.map((text, index) => ({
    key: `${index}-${text}`,
    text,
    isWord: /[A-Za-z0-9]/.test(text),
    blankIndex: null,
  }))
}

/** 归一化后比对：忽略大小写、首尾标点，弯撇号统一成直的 */
export function normalizeAnswer(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^[^\w']+|[^\w']+$/g, "")
}

/**
 * 决定挖哪些空。
 *
 * 短句整句全挖（那才是真正的"造句"）；长句只挖实词并且封顶 MAX_BLANKS ——
 * 生词本里的例句中位数 13 词、最长 28 词，全挖会直接劝退。挖空位置在实词里
 * 均匀取，避免全挤在句首。
 */
/**
 * 挖空策略：
 *   - `all`         整句每个词都挖，只留标点。这才是真正的"造句"——只给中文
 *                   和空格，没有任何骨架可蹭。用于内置语料库那种短句。
 *   - `content-words` 留下功能词当骨架，只挖实词。这实际考的是"这个位置该填
 *                   哪个词"，属于词汇题而不是表达题，适合放进闪卡复习当题型。
 */
export type BlankStrategy = "all" | "content-words"

export function buildBlanks(
  tokens: SentenceToken[],
  strategy: BlankStrategy = "content-words",
): SentenceToken[] {
  const wordIndexes = tokens.flatMap((token, index) => (token.isWord ? [index] : []))

  if (wordIndexes.length === 0) return tokens

  if (strategy === "all") {
    let blankIndex = 0
    return tokens.map((token) =>
      token.isWord ? { ...token, blankIndex: blankIndex++ } : { ...token, blankIndex: null },
    )
  }

  let chosen: number[]
  if (wordIndexes.length <= BLANK_ALL_MAX_WORDS) {
    chosen = wordIndexes
  } else {
    const contentWords = wordIndexes.filter(
      (index) => !FUNCTION_WORDS.has(normalizeAnswer(tokens[index]!.text)),
    )
    // 实词太少（整句几乎都是功能词）就退回全部词，总得有东西可考
    const pool = contentWords.length >= 2 ? contentWords : wordIndexes
    if (pool.length <= MAX_BLANKS) {
      chosen = pool
    } else {
      // 均匀取样：在候选里按等距挑，让空位散布在整句而不是堆在开头
      const step = pool.length / MAX_BLANKS
      chosen = Array.from({ length: MAX_BLANKS }, (_, i) => pool[Math.floor(i * step)]!)
    }
  }

  const chosenSet = new Set(chosen)
  let blankIndex = 0
  return tokens.map((token, index) => {
    if (!chosenSet.has(index)) return { ...token, blankIndex: null }
    const next = { ...token, blankIndex }
    blankIndex += 1
    return next
  })
}

export interface PreparedSentence {
  tokens: SentenceToken[]
  /** 每个空的正确答案，按 blankIndex 排列 */
  answers: string[]
}

export function prepareSentence(
  sentence: string,
  strategy: BlankStrategy = "content-words",
): PreparedSentence {
  const tokens = buildBlanks(tokenizeSentence(sentence), strategy)
  const answers: string[] = []
  for (const token of tokens) {
    if (token.blankIndex !== null) answers[token.blankIndex] = token.text
  }
  return { tokens, answers }
}

export type BlankVerdict = "correct" | "wrong" | "empty"

/**
 * 逐空判定。空着的返回 "empty" 而不是 "wrong" —— 还没填的空不该被标成错，
 * 那会让"先填后面几个空"这种用法一提交就满屏红。
 */
export function checkBlanks(inputs: string[], answers: string[]): BlankVerdict[] {
  return answers.map((answer, index) => {
    const raw = inputs[index] ?? ""
    if (raw.trim() === "") return "empty"
    return normalizeAnswer(raw) === normalizeAnswer(answer) ? "correct" : "wrong"
  })
}

/**
 * 输入框宽度：下划线长短本身就是提示，但不能因此夹掉用户已经打进去的字母。
 *
 * 单位是 ch —— ch 等于字符 "0" 的宽度，只有在等宽字体里才真的等于"一个字母宽"。
 * 所以输入框必须配等宽字体渲染，否则 m/w 这类宽字母会溢出被裁掉。
 *
 * 取答案长度和已输入长度的较大值：猜错时打的词可能比答案长，这时宽度跟着涨，
 * 宁可让提示宽一点，也不能让人看不见自己打了什么。
 */
export function blankWidthCh(answer: string, typed = ""): number {
  return Math.max(3, answer.length + 1, typed.length + 1)
}
