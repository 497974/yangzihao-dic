/**
 * 中文网页夹英文词（功能路线图阶段四第 6 条）：在中文网页里挑几个词换成英文。
 *
 * 读中文的时候顺手认几个英文词，是 Toucan 验证过的玩法——不用专门抽时间背，
 * 一个词在不同句子里撞见几次就记住了。换上去的词优先来自你自己的生词本，
 * 其余按「我的英语水平」和选的难度范围从离线词表里挑。
 *
 * 分寸很重要：默认一页只换十来处、同一个词最多换两处。换多了整页读不下去，
 * 反而两头都学不到。鼠标移上去看中文原文和音标，点一下就换回中文。
 */

import type { MixPair, MixPairs } from "./pairs"
import { LEVELS } from "@/utils/wordlist/ecdict"
import { collectTerms, createSegmenter, findMatches } from "./pairs"

export const MIX_TAG = "yzh-mix"
const TIP_TAG = "yzh-mix-tip"
const STYLE_ID = "yzh-mix-style"

/** 这些地方不换：会弄坏输入、代码，或者是扩展自己加的内容 */
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
  "title",
  '[contenteditable]:not([contenteditable="false"])',
  MIX_TAG,
  TIP_TAG,
  "yzh-vocab",
  "yzh-vocab-tip",
  '[class*="yangzihao-dic"]',
].join(",")

/** 同一个英文词在一页里最多换这么多处：同一个词满页都是就腻了 */
export const MAX_PER_PAIR = 2

/** 一页最多换多少处（设置里的「密度」） */
export const MIX_DENSITY_BUDGET = { low: 6, medium: 14, high: 30 } as const
export type MixDensity = keyof typeof MIX_DENSITY_BUDGET

const PAGE_STYLE = `
${MIX_TAG}{display:inline;cursor:pointer;border-bottom:1.5px solid rgba(37,99,235,.55);
  border-radius:0;text-decoration:none;font-style:normal}
${MIX_TAG}:hover{background:rgba(37,99,235,.14)}
${MIX_TAG}[data-state="zh"]{border-bottom-style:dotted;opacity:.85}
`

const TIP_STYLE = `
:host{all:initial}
.card{box-sizing:border-box;max-width:300px;padding:10px 12px;border-radius:10px;
  background:#fff;color:#18181b;border:1px solid #e4e4e7;box-shadow:0 8px 28px rgba(0,0,0,.16);
  font:13px/1.55 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.en{font-size:15px;font-weight:600}
.phonetic{color:#71717a}
.zh{margin-top:4px}
.hint{margin-top:6px;color:#a1a1aa;font-size:11.5px}
@media (prefers-color-scheme:dark){
  .card{background:#27272a;color:#fafafa;border-color:#3f3f46}
  .phonetic{color:#a1a1aa}
}
`

function shouldSkip(node: Text): boolean {
  const parent = node.parentElement
  return !parent || !(node.nodeValue ?? "").trim() || !!parent.closest(SKIP_SELECTOR)
}

/** 一批处理这么多个文字节点，处理完把主线程让给网页 */
export const NODES_PER_BATCH = 300

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

export interface MixBudget {
  /** 这一页还能换多少处 */
  remaining: number
  /** 每个英文词换过几处 */
  used: Map<string, number>
}

export function createMixBudget(total: number): MixBudget {
  return { remaining: total, used: new Map() }
}

/** 这个词还能不能再换（整页预算 + 每个词的上限） */
function canReplace(budget: MixBudget, en: string): boolean {
  return budget.remaining > 0 && (budget.used.get(en) ?? 0) < MAX_PER_PAIR
}

function take(budget: MixBudget, en: string) {
  budget.remaining -= 1
  budget.used.set(en, (budget.used.get(en) ?? 0) + 1)
}

/** 这些文字节点里所有可以拿来查的中文词（发给后台反查用） */
export function collectNodeTerms(nodes: readonly Text[], segmenter: Intl.Segmenter): string[] {
  const terms = new Set<string>()
  for (const node of nodes) {
    collectTerms(node.nodeValue ?? "", segmenter, terms)
  }
  return [...terms]
}

/** 把这些文字节点里命中的中文词换成英文，返回换了几处。pairs 是这批词查好的结果 */
export function mixTextNodes(
  nodes: readonly Text[],
  pairs: MixPairs,
  segmenter: Intl.Segmenter,
  budget: MixBudget,
): number {
  let count = 0
  for (const node of nodes) {
    if (budget.remaining <= 0) {
      break
    }
    // 分批处理时，排在后面的节点可能已经被网页换掉了
    if (!node.isConnected) {
      continue
    }
    const doc = node.ownerDocument
    const text = node.nodeValue ?? ""
    const matches = findMatches(text, segmenter, (term) => {
      const pair = pairs.get(term)
      const key = pair?.en.toLowerCase()
      if (!pair || !key || !canReplace(budget, key)) {
        return undefined
      }
      // findMatches 用的就是第一个查到的拼法，查到即换
      take(budget, key)
      return pair
    })
    if (matches.length === 0) {
      continue
    }
    let cursor = 0
    const fragment = doc.createDocumentFragment()
    for (const { index, pair } of matches) {
      fragment.append(text.slice(cursor, index))
      fragment.append(createMark(doc, pair))
      cursor = index + pair.zh.length
      count += 1
    }
    fragment.append(text.slice(cursor))
    node.replaceWith(fragment)
  }
  return count
}

function createMark(doc: Document, pair: MixPair): HTMLElement {
  const mark = doc.createElement(MIX_TAG)
  mark.dataset.zh = pair.zh
  mark.dataset.en = pair.en
  mark.dataset.state = "en"
  mark.dataset.source = pair.source
  if (pair.phonetic) {
    mark.dataset.phonetic = pair.phonetic
  }
  if (pair.level) {
    mark.dataset.level = String(pair.level)
  }
  mark.textContent = pair.en
  return mark
}

/** 全部换回中文原文（关掉开关、词表变了时） */
export function removeMixMarks(root: ParentNode): void {
  const parents = new Set<Node>()
  for (const mark of Array.from(root.querySelectorAll<HTMLElement>(MIX_TAG))) {
    const parent = mark.parentNode
    if (parent) {
      parents.add(parent)
      mark.replaceWith(mark.ownerDocument.createTextNode(mark.dataset.zh ?? mark.textContent ?? ""))
    }
  }
  for (const parent of parents) {
    parent.normalize()
  }
}

/** 提示卡片最下面那行：这个词从哪来的 */
export function markSourceHint(mark: HTMLElement): string {
  if (mark.dataset.source === "notebase") {
    return "来自生词本 · 点击切回中文"
  }
  const level = LEVELS[Number(mark.dataset.level) - 1]
  return level ? `${level}词汇 · 点击切回中文` : "点击切回中文"
}

/** 鼠标移上去的小卡片：英文、音标、中文原文；放在 Shadow DOM 里，网页的 CSS 碰不到 */
function createTooltip(doc: Document) {
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
      const en = target.dataset.en ?? ""
      const zh = target.dataset.zh ?? ""
      const head = line("head", "")
      const word = doc.createElement("span")
      word.className = "en"
      word.textContent = en
      head.append(word)
      if (target.dataset.phonetic) {
        const phonetic = doc.createElement("span")
        phonetic.className = "phonetic"
        phonetic.textContent = target.dataset.phonetic
        head.append(phonetic)
      }
      card.replaceChildren(head, line("zh", `原文：${zh}`), line("hint", markSourceHint(target)))

      host.style.display = "block"
      const rect = target.getBoundingClientRect()
      const width = host.offsetWidth || 260
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

/** 点一下：英文 ⇄ 中文原文来回切。没看懂就点一下看中文，不用跳出这篇文章 */
export function toggleMark(mark: HTMLElement): void {
  const showingEnglish = mark.dataset.state !== "zh"
  mark.textContent = showingEnglish ? (mark.dataset.zh ?? "") : (mark.dataset.en ?? "")
  mark.dataset.state = showingEnglish ? "zh" : "en"
}

/** 一批中文词 → 查好的词对（生词本优先，其余问后台的离线词表）。只返回要换的 */
export type ResolveTerms = (terms: string[]) => Promise<MixPairs>

export interface ChineseMixerOptions {
  /** 页面有新内容后等这么久再补（合并一连串变化）；测试里调小 */
  mutationDelayMs?: number
}

function whenIdle(doc: Document): Promise<void> {
  return new Promise((resolve) => {
    const view = doc.defaultView
    if (view?.requestIdleCallback) {
      view.requestIdleCallback(() => resolve(), { timeout: 200 })
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/**
 * 在整页上开始夹英文词。restart 按新的设置从头换一遍（Promise 在整页处理完时完成），
 * stop 全部换回中文、不再监听。
 */
export function startChineseMixer(doc: Document, options: ChineseMixerOptions = {}) {
  const mutationDelayMs = options.mutationDelayMs ?? 400
  const segmenter = createSegmenter()
  let resolveTerms: ResolveTerms | null = null
  let budget = createMixBudget(0)
  let pendingRoots: Node[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  /** 重新开始或停下时加一：还没处理完的上一轮就不再接着跑 */
  let round = 0

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style")
    style.id = STYLE_ID
    style.textContent = PAGE_STYLE
    ;(doc.head ?? doc.documentElement).append(style)
  }
  const tooltip = createTooltip(doc)
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
      timer = setTimeout(() => void flushPending(), mutationDelayMs)
    }
  })

  /** 我们自己改的 DOM 不算「网页有新内容」 */
  function run(action: () => void) {
    action()
    observer.takeRecords()
  }

  /** 查一批节点里的词，再换；查词期间换了设置或停下了（round 变了）就放弃这一批 */
  async function mixBatch(nodes: readonly Text[], current: number) {
    const resolve = resolveTerms
    const terms = collectNodeTerms(nodes, segmenter)
    if (terms.length === 0 || !resolve) {
      return
    }
    const pairs = await resolve(terms)
    if (current !== round || pairs.size === 0) {
      return
    }
    run(() => mixTextNodes(nodes, pairs, segmenter, budget))
  }

  async function flushPending() {
    timer = null
    const roots = pendingRoots
    pendingRoots = []
    if (!resolveTerms || budget.remaining <= 0) {
      return
    }
    const nodes = roots.filter((root) => root.isConnected).flatMap(collectTextNodes)
    try {
      await mixBatch(nodes, round)
    } catch {
      // 后台暂时没响应（扩展刚更新、service worker 在重启）：这批不换，不影响网页
    }
  }

  const onMouseOver = (event: Event) => {
    const target = event.target as Element | null
    const mark = target?.closest?.(MIX_TAG) as HTMLElement | null
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

  const onClick = (event: Event) => {
    const target = event.target as Element | null
    const mark = target?.closest?.(MIX_TAG) as HTMLElement | null
    if (!mark) {
      return
    }
    // 换的词常常在链接里（中文网页的标题、导航）：点它是想看中文，不是想跳走
    event.preventDefault()
    event.stopPropagation()
    run(() => toggleMark(mark))
  }

  doc.addEventListener("mouseover", onMouseOver, true)
  doc.addEventListener("click", onClick, true)
  doc.addEventListener("scroll", hideTip, true)

  return {
    /**
     * 按新的设置从头换一遍：先全部换回中文，再分批查词、替换。
     * Promise 在整页处理完（或被下一次 restart / stop 打断）时完成。
     */
    async restart(resolve: ResolveTerms, total: number): Promise<void> {
      round += 1
      const current = round
      run(() => removeMixMarks(doc.body ?? doc.documentElement))
      resolveTerms = resolve
      budget = createMixBudget(total)
      tooltip.hide()
      if (total <= 0) {
        observer.disconnect()
        return
      }
      observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true })
      const nodes = collectTextNodes(doc.body ?? doc.documentElement)
      while (nodes.length > 0 && budget.remaining > 0) {
        await mixBatch(nodes.splice(0, NODES_PER_BATCH), current)
        // 查词期间又 restart 或 stop 了：这一轮到此为止
        if (current !== round) {
          break
        }
        if (nodes.length > 0) {
          await whenIdle(doc)
        }
      }
    },

    stop() {
      round += 1
      resolveTerms = null
      observer.disconnect()
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (hideTimer) {
        clearTimeout(hideTimer)
      }
      doc.removeEventListener("mouseover", onMouseOver, true)
      doc.removeEventListener("click", onClick, true)
      doc.removeEventListener("scroll", hideTip, true)
      removeMixMarks(doc.body ?? doc.documentElement)
      tooltip.destroy()
      doc.getElementById(STYLE_ID)?.remove()
    },

    /** 这一页换了几处（测试和日志用） */
    count: () => (doc.body ?? doc.documentElement).querySelectorAll(MIX_TAG).length,
  }
}

export type ChineseMixer = ReturnType<typeof startChineseMixer>
