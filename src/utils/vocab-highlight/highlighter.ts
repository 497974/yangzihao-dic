/**
 * 网页生词高亮（优化清单第 9 条）：生词本里的词出现在网页上时，用虚线下划线标出来，
 * 鼠标移上去显示音标和释义——在阅读里一次次遇见存过的词，是记住它最自然的办法。
 *
 * 只改文字节点：把命中的词包进一个 <yzh-vocab> 标签。用自定义标签是因为网页自己的 CSS
 * 几乎不可能写到它，标出来的样子在哪个网站都一样，也不会把网页原来的样式搞乱。
 * 输入框、可编辑区域、代码、扩展自己的译文都不碰。后来加载的内容（无限滚动、评论区）也会补上。
 */

import type { VocabEntry, Vocabulary } from "./vocabulary"
import { formatDueIn, WORD_STATUS_LABEL } from "./status"
import { buildMatcher, findVocabMatches } from "./vocabulary"

export const VOCAB_TAG = "yzh-vocab"
const TIP_TAG = "yzh-vocab-tip"
const STYLE_ID = "yzh-vocab-style"

/** 这些地方的字不标：会破坏输入、代码，或者是扩展自己加的译文 */
const SKIP_SELECTOR = [
  "script",
  "style",
  "noscript",
  "template",
  "textarea",
  "input",
  "select",
  "option",
  "code",
  "pre",
  "kbd",
  "samp",
  "svg",
  "math",
  "[contenteditable]:not([contenteditable='false'])",
  VOCAB_TAG,
  TIP_TAG,
  // 行内释义提示（word-wise）插进去的 <ruby>：里面的词已经有提示了，不再重复标
  "yzh-ww",
  "rt",
  "[class*='yangzihao-dic']",
].join(",")

/** 一页最多标这么多处：满页都是下划线反而没法读 */
export const MAX_HIGHLIGHTS = 2_000

/** 挂在 <html> 上：有这个属性时，已掌握的词不显示任何标记（见 setShowMastered） */
export const HIDE_MASTERED_ATTR = "data-yzh-vocab-hide-mastered"

/**
 * 三种状态三种样式（LingQ 的做法）：新词天蓝、学习中琥珀、已掌握淡绿点线。
 * 中文夹词用的是实线蓝，这里用虚线和天蓝色，两种标记放在一起也分得开。
 */
const PAGE_STYLE = `
${VOCAB_TAG}{display:inline;background:none;border-bottom:1.5px dashed rgba(201,146,24,.85);
  border-radius:0;cursor:help;text-decoration:none}
${VOCAB_TAG}:hover{background:rgba(201,146,24,.14)}
${VOCAB_TAG}[data-status="new"]{border-bottom-color:rgba(14,165,233,.9)}
${VOCAB_TAG}[data-status="new"]:hover{background:rgba(14,165,233,.14)}
${VOCAB_TAG}[data-status="mastered"]{border-bottom:1.5px dotted rgba(22,163,74,.6)}
${VOCAB_TAG}[data-status="mastered"]:hover{background:rgba(22,163,74,.1)}
html[${HIDE_MASTERED_ATTR}] ${VOCAB_TAG}[data-status="mastered"]{border-bottom:0;background:none;cursor:inherit}
`

const TIP_STYLE = `
:host{all:initial}
.card{box-sizing:border-box;max-width:320px;padding:10px 12px;border-radius:10px;
  background:#fff;color:#18181b;border:1px solid #e4e4e7;box-shadow:0 8px 28px rgba(0,0,0,.16);
  font:13px/1.55 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.term{font-size:15px;font-weight:600}
.phonetic{color:#71717a}
.meaning{margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere}
.hint{margin-top:6px;color:#a1a1aa;font-size:11.5px}
.status{margin-left:auto;padding:0 6px;border-radius:999px;font-size:11px;line-height:18px}
.status[data-status="new"]{background:rgba(14,165,233,.14);color:#0369a1}
.status[data-status="learning"]{background:rgba(201,146,24,.16);color:#92400e}
.status[data-status="mastered"]{background:rgba(22,163,74,.14);color:#166534}
@media (prefers-color-scheme:dark){
  .card{background:#27272a;color:#fafafa;border-color:#3f3f46}
  .phonetic{color:#a1a1aa}
}
`

function shouldSkip(node: Text): boolean {
  const parent = node.parentElement
  return !parent || (node.nodeValue ?? "").trim().length < 3 || !!parent.closest(SKIP_SELECTOR)
}

/**
 * 长网页一次标完会卡一下（几万个文字节点逐个跑正则）：一批最多处理这么多个文字节点，
 * 处理完把主线程让给网页，空闲时再接着标。
 */
export const NODES_PER_BATCH = 300

/** root 下面所有要标的文字节点（跳过输入框、代码、扩展的译文……） */
function collectTextNodes(root: Node): Text[] {
  if (root.nodeType === Node.TEXT_NODE) {
    return shouldSkip(root as Text) ? [] : [root as Text]
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

/**
 * 把 root 里命中的词包起来，返回标了几处。budget 是这一页还能标多少处（多次调用共用）。
 */
export function highlightVocabulary(
  root: Node,
  vocab: Vocabulary,
  matcher: RegExp,
  budget: { remaining: number } = { remaining: MAX_HIGHLIGHTS },
): number {
  return highlightTextNodes(collectTextNodes(root), vocab, matcher, budget)
}

function highlightTextNodes(
  nodes: readonly Text[],
  vocab: Vocabulary,
  matcher: RegExp,
  budget: { remaining: number },
): number {
  let count = 0
  for (const node of nodes) {
    if (budget.remaining <= 0) {
      break
    }
    // 分批标的时候，排在后面的节点可能已经被网页换掉了
    if (!node.isConnected) {
      continue
    }
    const doc = node.ownerDocument
    const text = node.nodeValue ?? ""
    const matches = findVocabMatches(text, matcher).filter((match) => vocab.has(match.key))
    if (matches.length === 0) {
      continue
    }
    const fragment = doc.createDocumentFragment()
    let cursor = 0
    for (const match of matches) {
      if (budget.remaining <= 0) {
        break
      }
      fragment.append(text.slice(cursor, match.start))
      const mark = doc.createElement(VOCAB_TAG)
      mark.dataset.term = match.key
      mark.dataset.status = vocab.get(match.key)?.status ?? "new"
      mark.textContent = text.slice(match.start, match.end)
      fragment.append(mark)
      cursor = match.end
      count += 1
      budget.remaining -= 1
    }
    fragment.append(text.slice(cursor))
    node.replaceWith(fragment)
  }
  return count
}

/** 把页面上已有标记的学习状态更新成词表里的最新状态；返回改了几处 */
export function refreshStatuses(root: Document | ParentNode, vocab: Vocabulary): number {
  let changed = 0
  for (const mark of Array.from(root.querySelectorAll<HTMLElement>(VOCAB_TAG))) {
    const status = vocab.get(mark.dataset.term ?? "")?.status
    if (status && mark.dataset.status !== status) {
      mark.dataset.status = status
      changed += 1
    }
  }
  return changed
}

/** 把标过的词还原成普通文字（关掉开关、词表变了时） */
export function removeHighlights(root: ParentNode): void {
  const parents = new Set<Node>()
  for (const mark of Array.from(root.querySelectorAll(VOCAB_TAG))) {
    const parent = mark.parentNode
    if (parent) {
      parents.add(parent)
      mark.replaceWith(mark.ownerDocument.createTextNode(mark.textContent ?? ""))
    }
  }
  // 把拆开的文字节点并回去，别的脚本按文字节点找东西时不会被我们搅乱
  for (const parent of parents) {
    parent.normalize()
  }
}

/** 鼠标移到标出的词上时显示的小卡片；放在 Shadow DOM 里，网页的 CSS 碰不到它 */
function createTooltip(doc: Document, getEntry: (key: string) => VocabEntry | undefined) {
  const host = doc.createElement(TIP_TAG)
  host.style.cssText =
    "position:fixed;z-index:2147483647;top:0;left:0;pointer-events:none;display:none"
  const shadow = host.attachShadow({ mode: "open" })
  const style = doc.createElement("style")
  style.textContent = TIP_STYLE
  const card = doc.createElement("div")
  card.className = "card"
  shadow.append(style, card)
  doc.documentElement.append(host)

  const line = (className: string, text: string) => {
    const element = doc.createElement("div")
    element.className = className
    element.textContent = text
    return element
  }

  return {
    show(target: HTMLElement) {
      const entry = getEntry(target.dataset.term ?? "")
      if (!entry) {
        return
      }
      const head = line("head", "")
      const term = doc.createElement("span")
      term.className = "term"
      term.textContent = entry.term
      head.append(term)
      if (entry.phonetic) {
        const phonetic = doc.createElement("span")
        phonetic.className = "phonetic"
        phonetic.textContent = entry.phonetic
        head.append(phonetic)
      }
      const status = doc.createElement("span")
      status.className = "status"
      status.dataset.status = entry.status
      status.textContent = WORD_STATUS_LABEL[entry.status]
      head.append(status)

      const meaning = entry.meaning.length > 240 ? `${entry.meaning.slice(0, 240)}…` : entry.meaning
      const hint =
        entry.status !== "new" && entry.dueAt
          ? `已在你的生词本里 · 下次复习：${formatDueIn(entry.dueAt)}`
          : "已在你的生词本里 · 尚未复习"
      card.replaceChildren(
        head,
        line("meaning", meaning || "（生词本里没有释义）"),
        line("hint", hint),
      )

      host.style.display = "block"
      const rect = target.getBoundingClientRect()
      const width = host.offsetWidth || 280
      const height = host.offsetHeight || 80
      const view = doc.defaultView
      const viewWidth = view?.innerWidth ?? 1024
      const viewHeight = view?.innerHeight ?? 768
      const left = Math.max(8, Math.min(rect.left, viewWidth - width - 8))
      const below = rect.bottom + 6
      const top = below + height > viewHeight ? Math.max(8, rect.top - height - 6) : below
      host.style.left = `${left}px`
      host.style.top = `${top}px`
    },
    hide() {
      host.style.display = "none"
    },
    destroy() {
      host.remove()
    },
    isOwn: (node: Node) => node === host,
  }
}

export interface VocabHighlighterOptions {
  /** 页面有新内容后等这么久再补标（合并一连串变化）；测试里调小 */
  mutationDelayMs?: number
}

/** 两份词表里的词完全一样（只是释义、音标可能改了） */
function sameWords(a: Vocabulary, b: Vocabulary): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const key of b.keys()) {
    if (!a.has(key)) {
      return false
    }
  }
  return true
}

/** 等网页空闲了再接着干；没有 requestIdleCallback 的环境（测试）退回 setTimeout */
function whenIdle(doc: Document, callback: () => void) {
  const view = doc.defaultView
  if (view?.requestIdleCallback) {
    view.requestIdleCallback(callback, { timeout: 200 })
  } else {
    setTimeout(callback, 0)
  }
}

/**
 * 在整页上开始标词。setVocabulary 换词表（第一次调用就开始标，返回的 Promise 在整页标完时完成），
 * stop 全部还原、不再监听。
 */
export function startVocabHighlighter(doc: Document, options: VocabHighlighterOptions = {}) {
  const mutationDelayMs = options.mutationDelayMs ?? 400
  let vocab: Vocabulary = new Map()
  let matcher: RegExp | null = null
  let budget = { remaining: MAX_HIGHLIGHTS }
  let pendingRoots: Node[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  /** 换了词表或停下时加一：还没标完的上一轮就不再接着标 */
  let scanRound = 0

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style")
    style.id = STYLE_ID
    style.textContent = PAGE_STYLE
    ;(doc.head ?? doc.documentElement).append(style)
  }
  const tooltip = createTooltip(doc, (key) => vocab.get(key))
  const hideTip = () => tooltip.hide()

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (!tooltip.isOwn(node)) {
          pendingRoots.push(node)
        }
      }
    }
    if (pendingRoots.length > 0 && !timer) {
      timer = setTimeout(flushPending, mutationDelayMs)
    }
  })

  /** 标词时我们自己改了 DOM，这些变化不能再当成"网页有新内容" */
  function run(action: () => void) {
    action()
    observer.takeRecords()
  }

  function flushPending() {
    timer = null
    const roots = pendingRoots
    pendingRoots = []
    if (!matcher) {
      return
    }
    const activeMatcher = matcher
    run(() => {
      for (const root of roots) {
        if (root.isConnected && budget.remaining > 0) {
          highlightVocabulary(root, vocab, activeMatcher, budget)
        }
      }
    })
  }

  const onMouseOver = (event: Event) => {
    const target = event.target as Element | null
    const found = target?.closest?.(VOCAB_TAG) as HTMLElement | null
    // 已掌握的词在「不显示」时看上去就是普通文字，悬停也不该弹出卡片
    const mark =
      found &&
      !(found.dataset.status === "mastered" && doc.documentElement.hasAttribute(HIDE_MASTERED_ATTR))
        ? found
        : null
    if (mark) {
      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = null
      }
      tooltip.show(mark)
    } else if (!hideTimer) {
      hideTimer = setTimeout(() => {
        hideTimer = null
        tooltip.hide()
      }, 120)
    }
  }
  doc.addEventListener("mouseover", onMouseOver, true)
  doc.addEventListener("scroll", hideTip, true)

  return {
    setVocabulary(next: Vocabulary): Promise<void> {
      // 词没变、只改了释义音标或学习状态（复习一次闪卡库就写一次）：不重扫整页，
      // 只把状态变了的标记改一下属性；小卡片读的是新词表，下次移上去就是新内容
      if (matcher && sameWords(vocab, next)) {
        vocab = next
        run(() => refreshStatuses(doc, next))
        return Promise.resolve()
      }
      scanRound += 1
      const round = scanRound
      run(() => removeHighlights(doc.body ?? doc.documentElement))
      vocab = next
      matcher = buildMatcher(next)
      budget = { remaining: MAX_HIGHLIGHTS }
      tooltip.hide()
      if (!matcher) {
        observer.disconnect()
        return Promise.resolve()
      }
      const activeMatcher = matcher
      // 先开始监听：分批标的这段时间里网页新加的内容也要标上
      observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true })
      const nodes = collectTextNodes(doc.body ?? doc.documentElement)
      return new Promise<void>((resolve) => {
        const step = () => {
          if (round !== scanRound) {
            resolve()
            return
          }
          const batch = nodes.splice(0, NODES_PER_BATCH)
          run(() => highlightTextNodes(batch, vocab, activeMatcher, budget))
          if (nodes.length === 0 || budget.remaining <= 0) {
            resolve()
          } else {
            whenIdle(doc, step)
          }
        }
        // 第一批马上标：短网页一下就标完，不用等
        step()
      })
    },

    /** 已掌握的词要不要标出来（默认不标，见「阅读辅助」页）；只切一个属性，不重扫 */
    setShowMastered(show: boolean) {
      doc.documentElement.toggleAttribute(HIDE_MASTERED_ATTR, !show)
      tooltip.hide()
    },

    stop() {
      scanRound += 1
      doc.documentElement.removeAttribute(HIDE_MASTERED_ATTR)
      observer.disconnect()
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (hideTimer) {
        clearTimeout(hideTimer)
      }
      doc.removeEventListener("mouseover", onMouseOver, true)
      doc.removeEventListener("scroll", hideTip, true)
      removeHighlights(doc.body ?? doc.documentElement)
      tooltip.destroy()
      doc.getElementById(STYLE_ID)?.remove()
    },

    /** 这一页标了几处（测试和日志用） */
    count: () => (doc.body ?? doc.documentElement).querySelectorAll(VOCAB_TAG).length,
  }
}

export type VocabHighlighter = ReturnType<typeof startVocabHighlighter>
