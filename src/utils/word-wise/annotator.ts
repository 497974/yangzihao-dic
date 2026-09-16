/**
 * 行内中文释义提示（阶段五实现方案 · 步骤 2，参考 Kindle Word Wise）。
 *
 * 在超出「我的水平」的词上方用小字标一个极简中文释义，读的时候不用停下来查词。
 *
 * 几个刻意的选择：
 *   - 用原生 <ruby><rt>：浏览器会正确处理基线对齐和行高，自己用 flex 模拟会让文字上下跳
 *   - 释义不可选中：复制网页文字时不会把中文释义一起复制出去
 *   - 每个词每页只标第一次出现：满篇重复的小字反而干扰阅读
 *   - 按钮、导航、代码、输入框里的字不动：插进去会撑乱布局或破坏功能
 */

export const WW_TAG = "yzh-ww"
const STYLE_ID = "yzh-ww-style"

/** 一页最多标多少处：再多就不是「提示」而是「对照翻译」了 */
export const MAX_HINTS_PER_PAGE = 80

const SKIP_SELECTOR = [
  "script",
  "style",
  "noscript",
  "template",
  "textarea",
  "input",
  "select",
  "option",
  "button",
  "code",
  "pre",
  "kbd",
  "samp",
  "svg",
  "math",
  "nav",
  "ruby",
  "rt",
  "title",
  '[role="button"]',
  '[contenteditable]:not([contenteditable="false"])',
  WW_TAG,
  "yzh-vocab",
  "yzh-vocab-tip",
  "yzh-mix",
  '[class*="yangzihao-dic"]',
].join(",")

const PAGE_STYLE = `
${WW_TAG}{display:inline;font:inherit;color:inherit}
${WW_TAG} > ruby{ruby-position:over;ruby-align:center}
${WW_TAG} > ruby > rt{font-size:.55em;line-height:1;color:rgba(107,114,128,.95);
  font-weight:400;font-style:normal;letter-spacing:0;text-transform:none;
  user-select:none;-webkit-user-select:none;pointer-events:none}
`

const WORD_PATTERN = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g

function shouldSkip(node: Text): boolean {
  const parent = node.parentElement
  return !parent || !/[A-Za-z]/.test(node.nodeValue ?? "") || !!parent.closest(SKIP_SELECTOR)
}

/** root 下面所有可以加提示的文字节点 */
export function collectTextNodes(root: Node): Text[] {
  if (root.nodeType === Node.TEXT_NODE) {
    return shouldSkip(root as Text) ? [] : [root as Text]
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) {
    return []
  }
  const doc = root.ownerDocument ?? (root as Document)
  const nodes: Text[] = []
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      shouldSkip(node as Text) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text)
  }
  return nodes
}

/** 要不要给这个词加提示；要的话给出原形（用来去重）和释义 */
export type HintDecider = (word: string) => { lemma: string; gloss: string } | null

export interface HintBudget {
  remaining: number
  /** 这一页已经标过的原形：每个词只标第一次出现 */
  seen: Set<string>
}

export function createHintBudget(total = MAX_HINTS_PER_PAGE): HintBudget {
  return { remaining: total, seen: new Set() }
}

/** 给这些文字节点里该提示的词加上释义，返回加了几处 */
export function annotateTextNodes(
  nodes: readonly Text[],
  decide: HintDecider,
  budget: HintBudget,
): number {
  let count = 0
  for (const node of nodes) {
    if (budget.remaining <= 0) {
      break
    }
    if (!node.isConnected) {
      continue
    }
    const doc = node.ownerDocument
    const text = node.nodeValue ?? ""
    let cursor = 0
    let fragment: DocumentFragment | null = null
    for (const match of text.matchAll(WORD_PATTERN)) {
      const word = match[0]
      const hint = decide(word)
      if (!hint || budget.seen.has(hint.lemma)) {
        continue
      }
      const index = match.index ?? 0
      fragment ??= doc.createDocumentFragment()
      fragment.append(text.slice(cursor, index), createHint(doc, word, hint.lemma, hint.gloss))
      cursor = index + word.length
      budget.seen.add(hint.lemma)
      budget.remaining -= 1
      count += 1
      if (budget.remaining <= 0) {
        break
      }
    }
    if (fragment) {
      fragment.append(text.slice(cursor))
      node.replaceWith(fragment)
    }
  }
  return count
}

function createHint(doc: Document, word: string, lemma: string, gloss: string): HTMLElement {
  const wrapper = doc.createElement(WW_TAG)
  wrapper.dataset.lemma = lemma
  const ruby = doc.createElement("ruby")
  const rt = doc.createElement("rt")
  rt.textContent = gloss
  // 读屏软件只读原文，不把释义当成正文念出来
  rt.setAttribute("aria-hidden", "true")
  ruby.append(doc.createTextNode(word), rt)
  wrapper.append(ruby)
  return wrapper
}

/** 去掉所有提示，把原文还原成普通文字 */
export function removeAnnotations(root: ParentNode): void {
  const parents = new Set<Node>()
  for (const wrapper of Array.from(root.querySelectorAll<HTMLElement>(WW_TAG))) {
    const parent = wrapper.parentNode
    if (!parent) {
      continue
    }
    parents.add(parent)
    const word = wrapper.querySelector("ruby")?.firstChild?.textContent ?? ""
    wrapper.replaceWith(wrapper.ownerDocument.createTextNode(word))
  }
  for (const parent of parents) {
    parent.normalize()
  }
}

export interface WordWiseOptions {
  /** 批量查词（内容脚本里是发消息问后台） */
  decideFor: (words: string[]) => Promise<HintDecider>
  /** 页面有新内容后等这么久再补（合并一连串变化）；测试里调小 */
  mutationDelayMs?: number
}

/**
 * 在整页上开始加提示；页面后来加载的内容（无限滚动、评论区）也会补上。
 * decideFor 拿到这一批词之后返回判断函数——查词是异步的，要先问完再改网页。
 */
export function startWordWise(doc: Document, options: WordWiseOptions) {
  const mutationDelayMs = options.mutationDelayMs ?? 500
  const budget = createHintBudget()
  let pendingRoots: Node[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style")
    style.id = STYLE_ID
    style.textContent = PAGE_STYLE
    ;(doc.head ?? doc.documentElement).append(style)
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      pendingRoots.push(...Array.from(record.addedNodes))
    }
    if (pendingRoots.length > 0 && !timer) {
      timer = setTimeout(() => void flushPending(), mutationDelayMs)
    }
  })

  async function annotate(nodes: Text[]) {
    if (nodes.length === 0 || budget.remaining <= 0) {
      return
    }
    const words = new Set<string>()
    for (const node of nodes) {
      for (const match of (node.nodeValue ?? "").matchAll(WORD_PATTERN)) {
        words.add(match[0])
      }
    }
    const decide = await options.decideFor([...words])
    if (stopped) {
      return
    }
    annotateTextNodes(nodes, decide, budget)
    // 我们自己插进去的节点不算「网页有新内容」
    observer.takeRecords()
  }

  async function flushPending() {
    timer = null
    const roots = pendingRoots
    pendingRoots = []
    const nodes = roots.filter((root) => root.isConnected).flatMap(collectTextNodes)
    await annotate(nodes)
  }

  const root = doc.body ?? doc.documentElement
  observer.observe(root, { childList: true, subtree: true })

  return {
    /** 首次整页加提示完成 */
    ready: annotate(collectTextNodes(root)),

    stop() {
      stopped = true
      observer.disconnect()
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      removeAnnotations(root)
      doc.getElementById(STYLE_ID)?.remove()
    },

    count: () => root.querySelectorAll(WW_TAG).length,
  }
}

export type WordWise = ReturnType<typeof startWordWise>
