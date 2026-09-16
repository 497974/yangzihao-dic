// @vitest-environment jsdom
import type { Vocabulary } from "../vocabulary"
import { afterEach, describe, expect, it } from "vitest"
import {
  HIDE_MASTERED_ATTR,
  highlightVocabulary,
  MAX_HIGHLIGHTS,
  NODES_PER_BATCH,
  refreshStatuses,
  removeHighlights,
  startVocabHighlighter,
  VOCAB_TAG,
} from "../highlighter"
import { buildMatcher } from "../vocabulary"

const VOCAB: Vocabulary = new Map([
  [
    "obtain",
    { term: "obtain", phonetic: "/əbˈteɪn/", meaning: "获得", status: "new", dueAt: null },
  ],
  ["take off", { term: "take off", phonetic: "", meaning: "起飞", status: "new", dueAt: null }],
])

const marks = () => Array.from(document.querySelectorAll(VOCAB_TAG)).map((m) => m.textContent)

afterEach(() => {
  document.body.innerHTML = ""
})

describe("在网页上标出生词", () => {
  it("正文里的词包起来，前后的字原样保留", () => {
    document.body.innerHTML = "<p>You must obtain a permit before the plane can take off.</p>"

    const count = highlightVocabulary(document.body, VOCAB, buildMatcher(VOCAB)!)

    expect(count).toBe(2)
    expect(marks()).toEqual(["obtain", "take off"])
    expect(document.body.textContent).toBe(
      "You must obtain a permit before the plane can take off.",
    )
    expect(document.querySelector(VOCAB_TAG)?.getAttribute("data-term")).toBe("obtain")
  })

  it("输入框、可编辑区域、代码、扩展的译文都不碰", () => {
    document.body.innerHTML = `
      <textarea>obtain</textarea>
      <div contenteditable="true">obtain</div>
      <pre><code>obtain()</code></pre>
      <span class="yangzihao-dic-translated-content-wrapper">obtain</span>
      <p>obtain</p>`

    highlightVocabulary(document.body, VOCAB, buildMatcher(VOCAB)!)

    expect(document.querySelectorAll(VOCAB_TAG)).toHaveLength(1)
    expect(document.querySelector(`p ${VOCAB_TAG}`)).not.toBeNull()
  })

  it("一页最多标这么多处", () => {
    document.body.innerHTML = `<p>${"obtain ".repeat(10)}</p>`

    const count = highlightVocabulary(document.body, VOCAB, buildMatcher(VOCAB)!, { remaining: 3 })

    expect(count).toBe(3)
    expect(MAX_HIGHLIGHTS).toBeGreaterThan(100)
  })

  it("还原后和原来一模一样，文字节点也并回去了", () => {
    document.body.innerHTML = "<p>Please obtain it.</p>"
    highlightVocabulary(document.body, VOCAB, buildMatcher(VOCAB)!)

    removeHighlights(document.body)

    expect(document.body.innerHTML).toBe("<p>Please obtain it.</p>")
    expect(document.querySelector("p")!.childNodes).toHaveLength(1)
  })
})

describe("整页的标词器", () => {
  it("开始就标；后来加载的内容也补上；鼠标移上去显示音标和释义；停下后全部还原", async () => {
    document.body.innerHTML = "<p>obtain</p>"
    const highlighter = startVocabHighlighter(document, { mutationDelayMs: 5 })
    await highlighter.setVocabulary(VOCAB)
    expect(highlighter.count()).toBe(1)

    const later = document.createElement("p")
    later.textContent = "The plane will take off."
    document.body.append(later)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(highlighter.count()).toBe(2)

    const mark = document.querySelector(VOCAB_TAG)!
    mark.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    const tip = document.querySelector("yzh-vocab-tip") as HTMLElement
    expect(tip.style.display).toBe("block")
    expect(tip.shadowRoot!.textContent).toContain("/əbˈteɪn/")
    expect(tip.shadowRoot!.textContent).toContain("获得")

    highlighter.stop()
    expect(document.querySelectorAll(VOCAB_TAG)).toHaveLength(0)
    expect(document.querySelector("yzh-vocab-tip")).toBeNull()
    expect(document.body.textContent).toBe("obtainThe plane will take off.")
  })

  it("换词表时先还原旧的，再按新的标", async () => {
    document.body.innerHTML = "<p>obtain and take off</p>"
    const highlighter = startVocabHighlighter(document)
    await highlighter.setVocabulary(VOCAB)

    await highlighter.setVocabulary(new Map([["obtain", VOCAB.get("obtain")!]]))

    expect(marks()).toEqual(["obtain"])
    highlighter.stop()
  })

  it("词没变、只改了释义：页面上的标记原样不动，卡片显示新的释义", async () => {
    document.body.innerHTML = "<p>obtain</p>"
    const highlighter = startVocabHighlighter(document)
    await highlighter.setVocabulary(VOCAB)
    const markBefore = document.querySelector(VOCAB_TAG)

    const edited: Vocabulary = new Map(VOCAB)
    edited.set("obtain", {
      term: "obtain",
      phonetic: "/əbˈteɪn/",
      meaning: "取得；获得",
      status: "new",
      dueAt: null,
    })
    await highlighter.setVocabulary(edited)

    expect(document.querySelector(VOCAB_TAG)).toBe(markBefore)
    markBefore!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    const tip = document.querySelector("yzh-vocab-tip") as HTMLElement
    expect(tip.shadowRoot!.textContent).toContain("取得；获得")
    highlighter.stop()
  })

  it("每个标记带上学习状态；悬停卡片显示状态和下次复习时间", async () => {
    document.body.innerHTML = "<p>obtain</p>"
    const learning: Vocabulary = new Map([
      [
        "obtain",
        {
          term: "obtain",
          phonetic: "",
          meaning: "获得",
          status: "learning",
          dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        },
      ],
    ])
    const highlighter = startVocabHighlighter(document)
    await highlighter.setVocabulary(learning)
    const mark = document.querySelector<HTMLElement>(VOCAB_TAG)!

    expect(mark.dataset.status).toBe("learning")
    mark.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    const tip = document.querySelector("yzh-vocab-tip") as HTMLElement
    expect(tip.shadowRoot!.textContent).toContain("学习中")
    expect(tip.shadowRoot!.textContent).toContain("下次复习：3 天后")
    highlighter.stop()
  })

  it("复习后状态变了：只改标记上的状态，不重扫整页（标记还是原来那个元素）", async () => {
    document.body.innerHTML = "<p>obtain and take off</p>"
    const highlighter = startVocabHighlighter(document)
    await highlighter.setVocabulary(VOCAB)
    const markBefore = document.querySelector<HTMLElement>(VOCAB_TAG)!

    const reviewed: Vocabulary = new Map(VOCAB)
    reviewed.set("obtain", { ...VOCAB.get("obtain")!, status: "mastered", dueAt: null })
    await highlighter.setVocabulary(reviewed)

    const markAfter = document.querySelector<HTMLElement>(VOCAB_TAG)!
    expect(markAfter).toBe(markBefore)
    expect(markAfter.dataset.status).toBe("mastered")
    expect(refreshStatuses(document, reviewed)).toBe(0)
    highlighter.stop()
  })

  it("已掌握的词默认不标：切换只改一个属性；隐藏时悬停也不弹卡片", async () => {
    document.body.innerHTML = "<p>obtain</p>"
    const mastered: Vocabulary = new Map([
      ["obtain", { ...VOCAB.get("obtain")!, status: "mastered", dueAt: null }],
    ])
    const highlighter = startVocabHighlighter(document)
    await highlighter.setVocabulary(mastered)

    highlighter.setShowMastered(false)
    expect(document.documentElement.hasAttribute(HIDE_MASTERED_ATTR)).toBe(true)
    document.querySelector(VOCAB_TAG)!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    const tip = document.querySelector("yzh-vocab-tip") as HTMLElement
    expect(tip.style.display).toBe("none")

    highlighter.setShowMastered(true)
    expect(document.documentElement.hasAttribute(HIDE_MASTERED_ATTR)).toBe(false)

    highlighter.setShowMastered(false)
    highlighter.stop()
    expect(document.documentElement.hasAttribute(HIDE_MASTERED_ATTR)).toBe(false)
  })

  it("长网页分批标：第一批马上标，其余空闲时接着标，最后全部标上", async () => {
    const paragraphs = NODES_PER_BATCH * 2 + 10
    document.body.innerHTML = Array.from({ length: paragraphs }, () => "<p>obtain it</p>").join("")
    const highlighter = startVocabHighlighter(document)

    const done = highlighter.setVocabulary(VOCAB)
    expect(highlighter.count()).toBe(NODES_PER_BATCH)

    await done
    expect(highlighter.count()).toBe(paragraphs)
    highlighter.stop()
  })
})
