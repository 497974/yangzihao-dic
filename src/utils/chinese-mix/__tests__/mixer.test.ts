// @vitest-environment jsdom
import type { ResolveTerms } from "../mixer"
import type { MixPairs } from "../pairs"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createMixBudget,
  markSourceHint,
  MAX_PER_PAIR,
  MIX_TAG,
  mixTextNodes,
  removeMixMarks,
  startChineseMixer,
  toggleMark,
} from "../mixer"
import { createSegmenter } from "../pairs"

const PAIRS: MixPairs = new Map([
  ["学习", { zh: "学习", en: "study", phonetic: "/ˈstʌdi/", source: "notebase" }],
  ["时间", { zh: "时间", en: "time", phonetic: "/taɪm/", source: "wordlist", level: 1 }],
  ["交换生", { zh: "交换生", en: "exchange student", phonetic: "", source: "wordlist", level: 3 }],
])
const SEGMENTER = createSegmenter()

/** 假装后台：只返回这一批里查得到的词 */
const resolve = vi.fn<ResolveTerms>(async (terms) => {
  const found: MixPairs = new Map()
  for (const term of terms) {
    const pair = PAIRS.get(term)
    if (pair) {
      found.set(term, pair)
    }
  }
  return found
})

const marks = () => Array.from(document.querySelectorAll<HTMLElement>(MIX_TAG))
const textNodes = (root: Node) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text)
  }
  return nodes
}

afterEach(() => {
  document.body.innerHTML = ""
  resolve.mockClear()
})

describe("把中文词换成英文", () => {
  it("换掉命中的词，前后的字原样保留", () => {
    document.body.innerHTML = "<p>我每天学习英语，很花时间。</p>"

    const count = mixTextNodes(textNodes(document.body), PAIRS, SEGMENTER, createMixBudget(10))

    expect(count).toBe(2)
    expect(marks().map((mark) => mark.textContent)).toEqual(["study", "time"])
    expect(document.body.textContent).toBe("我每天study英语，很花time。")
  })

  it("分词器切开的合成词整体换掉", () => {
    document.body.innerHTML = "<p>他也是交换生。</p>"

    mixTextNodes(textNodes(document.body), PAIRS, SEGMENTER, createMixBudget(10))

    expect(document.body.textContent).toBe("他也是exchange student。")
  })

  it("整页有上限，超了就不换了", () => {
    document.body.innerHTML = "<p>学习，学习，学习</p>"

    mixTextNodes(textNodes(document.body), PAIRS, SEGMENTER, createMixBudget(1))

    expect(marks()).toHaveLength(1)
  })

  it("同一个词一页最多换两处", () => {
    document.body.innerHTML = `<p>${"学习，".repeat(5)}</p>`

    mixTextNodes(textNodes(document.body), PAIRS, SEGMENTER, createMixBudget(10))

    expect(marks()).toHaveLength(MAX_PER_PAIR)
  })

  it("输入框、代码块里的字不动", async () => {
    document.body.innerHTML = "<code>学习</code><textarea>学习</textarea><p>学习</p>"

    const mixer = startChineseMixer(document)
    await mixer.restart(resolve, 10)

    expect(marks()).toHaveLength(1)
    expect(document.querySelector("code")?.textContent).toBe("学习")
    mixer.stop()
  })

  it("换回中文时，拆开的文字节点会并回去", () => {
    document.body.innerHTML = "<p>我每天学习英语</p>"
    mixTextNodes(textNodes(document.body), PAIRS, SEGMENTER, createMixBudget(10))

    removeMixMarks(document.body)

    expect(document.body.textContent).toBe("我每天学习英语")
    expect(document.querySelector("p")?.childNodes).toHaveLength(1)
  })

  it("提示卡片说明词的来源：生词本，或者是哪一档的词", () => {
    document.body.innerHTML = "<p>学习时间</p>"
    mixTextNodes(textNodes(document.body), PAIRS, SEGMENTER, createMixBudget(10))

    expect(marks().map(markSourceHint)).toEqual([
      "来自生词本 · 点击切回中文",
      "中考词汇 · 点击切回中文",
    ])
  })
})

describe("点一下换回中文", () => {
  it("英文和中文来回切", () => {
    document.body.innerHTML = "<p>学习</p>"
    mixTextNodes(textNodes(document.body), PAIRS, SEGMENTER, createMixBudget(10))
    const mark = marks()[0]!

    toggleMark(mark)
    expect(mark.textContent).toBe("学习")
    expect(mark.dataset.state).toBe("zh")

    toggleMark(mark)
    expect(mark.textContent).toBe("study")
    expect(mark.dataset.state).toBe("en")
  })

  it("点在链接里的词不会跳走", async () => {
    document.body.innerHTML = "<a href='https://example.com'><span>学习</span>笔记</a>"
    const mixer = startChineseMixer(document)
    await mixer.restart(resolve, 10)

    const event = new MouseEvent("click", { bubbles: true, cancelable: true })
    marks()[0]!.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(marks()[0]!.textContent).toBe("学习")
    mixer.stop()
  })
})

describe("开关", () => {
  it("停下时全部换回中文，样式和提示卡片也清掉", async () => {
    document.body.innerHTML = "<p>我每天学习英语</p>"
    const mixer = startChineseMixer(document)
    await mixer.restart(resolve, 10)
    expect(mixer.count()).toBe(1)

    mixer.stop()

    expect(document.body.textContent).toBe("我每天学习英语")
    expect(document.querySelectorAll(MIX_TAG)).toHaveLength(0)
  })

  it("查词期间停下了，查回来的结果不再往网页上换", async () => {
    document.body.innerHTML = "<p>我每天学习英语</p>"
    const mixer = startChineseMixer(document)
    let release: () => void = () => {}
    const slow = vi.fn<ResolveTerms>(
      (terms) =>
        new Promise<MixPairs>((done) => {
          release = () => void resolve(terms).then(done)
        }),
    )

    const running = mixer.restart(slow, 10)
    await Promise.resolve()
    mixer.stop()
    release()
    await running

    expect(marks()).toHaveLength(0)
  })
})
