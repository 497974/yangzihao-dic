// @vitest-environment jsdom
import type { HintDecider } from "../annotator"
import { afterEach, describe, expect, it } from "vitest"
import {
  annotateTextNodes,
  collectTextNodes,
  createHintBudget,
  removeAnnotations,
  startWordWise,
  WW_TAG,
} from "../annotator"

const GLOSSES: Record<string, { lemma: string; gloss: string }> = {
  ubiquitous: { lemma: "ubiquitous", gloss: "无所不在的" },
  obtained: { lemma: "obtain", gloss: "获得" },
  obtain: { lemma: "obtain", gloss: "获得" },
}
const decide: HintDecider = (word) => GLOSSES[word.toLowerCase()] ?? null

const hints = () =>
  Array.from(document.querySelectorAll(WW_TAG)).map((el) => ({
    word: el.querySelector("ruby")?.firstChild?.textContent,
    gloss: el.querySelector("rt")?.textContent,
  }))

afterEach(() => {
  document.body.innerHTML = ""
  document.getElementById("yzh-ww-style")?.remove()
})

describe("行内释义提示", () => {
  it("在该提示的词上方加释义，其余文字原样保留", () => {
    document.body.innerHTML = "<p>Phones are ubiquitous now.</p>"

    annotateTextNodes(collectTextNodes(document.body), decide, createHintBudget())

    expect(hints()).toEqual([{ word: "ubiquitous", gloss: "无所不在的" }])
    // 原文文字不变（释义在 rt 里，另算）
    const paragraph = document.querySelector("p")!.cloneNode(true) as HTMLElement
    paragraph.querySelectorAll("rt").forEach((rt) => rt.remove())
    expect(paragraph.textContent).toBe("Phones are ubiquitous now.")
  })

  it("释义对读屏软件隐藏", () => {
    document.body.innerHTML = "<p>ubiquitous</p>"
    annotateTextNodes(collectTextNodes(document.body), decide, createHintBudget())

    expect(document.querySelector("rt")?.getAttribute("aria-hidden")).toBe("true")
  })

  it("同一个词（按原形算）每页只标第一次出现", () => {
    document.body.innerHTML = "<p>obtain it; obtained it; obtain it again</p>"

    annotateTextNodes(collectTextNodes(document.body), decide, createHintBudget())

    expect(hints()).toEqual([{ word: "obtain", gloss: "获得" }])
  })

  it("一页有上限", () => {
    document.body.innerHTML = "<p>ubiquitous obtain</p>"

    annotateTextNodes(collectTextNodes(document.body), decide, createHintBudget(1))

    expect(hints()).toHaveLength(1)
  })

  it("按钮、导航、代码、输入框、已有的生词标记里的字不动", () => {
    document.body.innerHTML = [
      "<button>ubiquitous</button>",
      "<nav>ubiquitous</nav>",
      "<code>ubiquitous</code>",
      "<textarea>ubiquitous</textarea>",
      "<yzh-vocab>ubiquitous</yzh-vocab>",
    ].join("")

    expect(collectTextNodes(document.body)).toHaveLength(0)
  })

  it("去掉提示后，文字和文字节点都还原", () => {
    document.body.innerHTML = "<p>Phones are ubiquitous now.</p>"
    annotateTextNodes(collectTextNodes(document.body), decide, createHintBudget())

    removeAnnotations(document.body)

    expect(document.querySelector("p")!.textContent).toBe("Phones are ubiquitous now.")
    expect(document.querySelector("p")!.childNodes).toHaveLength(1)
  })
})

describe("整页加提示", () => {
  it("先查词再改网页；后来加载的内容也会补上；停下后全部还原", async () => {
    document.body.innerHTML = "<p>ubiquitous</p>"
    const asked: string[][] = []
    const wordWise = startWordWise(document, {
      mutationDelayMs: 5,
      decideFor: async (words) => {
        asked.push(words)
        return decide
      },
    })

    await wordWise.ready
    expect(wordWise.count()).toBe(1)
    expect(asked[0]).toEqual(["ubiquitous"])

    const later = document.createElement("p")
    later.textContent = "We obtained it."
    document.body.append(later)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(wordWise.count()).toBe(2)

    wordWise.stop()
    expect(wordWise.count()).toBe(0)
    expect(document.body.textContent).toBe("ubiquitousWe obtained it.")
    expect(document.getElementById("yzh-ww-style")).toBeNull()
  })

  it("查词还没回来就停下：不会在停下之后再改网页", async () => {
    document.body.innerHTML = "<p>ubiquitous</p>"
    let release!: () => void
    const wordWise = startWordWise(document, {
      decideFor: () =>
        new Promise<HintDecider>((resolve) => {
          release = () => resolve(decide)
        }),
    })

    wordWise.stop()
    release()
    await wordWise.ready

    expect(wordWise.count()).toBe(0)
  })
})
