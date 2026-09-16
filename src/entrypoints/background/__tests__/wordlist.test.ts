/**
 * 后台离线词表服务。用的是真实生成的 public/data/wordlist.json，
 * 所以这里同时验证了「要随扩展发布的词表文件」本身能加载、能查到该查到的词。
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const WORDLIST_JSON = readFileSync(join(process.cwd(), "public", "data", "wordlist.json"), "utf8")

async function freshModule() {
  vi.resetModules()
  return import("../wordlist")
}

/**
 * 不用 `new Response(字符串)`：测试环境里的 Response 会把中文弄乱（实测「中考」往返后变成乱码），
 * 解析时报「Bad control character」。真实浏览器的 fetch 没有这个问题，
 * 所以这里只模拟 wordlist.ts 用到的 ok / status / json()。
 */
function jsonResponse(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body) as unknown,
  }
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(WORDLIST_JSON)),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("离线词表服务", () => {
  it("查到的词返回难度档、音标和释义；变形能还原到原形", async () => {
    const { lookupWords } = await freshModule()

    const result = await lookupWords(["Obtained", "ubiquitous", "xyzzyq"])

    expect(result.Obtained).toMatchObject({
      lemma: "obtain",
      gloss: expect.stringContaining("获得"),
    })
    expect(result.ubiquitous?.level).toBe(7)
    expect(result.xyzzyq).toBeUndefined()
  })

  it("常见词的变形不会被标成高难度（ECDICT 雅思词表里单独收录的复数、比较级）", async () => {
    const { lookupWords } = await freshModule()
    const pairs = [
      ["countries", "country"],
      ["problems", "problem"],
      ["governments", "government"],
      ["scientists", "scientist"],
      ["cheaper", "cheap"],
    ]

    const result = await lookupWords(pairs.flat())

    // 收集档位比原形还高的变形：失败时直接列出是哪几个词
    const harderThanLemma = pairs
      .filter(([form, lemma]) => (result[form!]?.level ?? 0) > (result[lemma!]?.level ?? 0))
      .map(([form]) => form)
    expect(harderThanLemma).toEqual([])
  })

  it("词表只读一次，之后都用内存里的", async () => {
    const { lookupWords } = await freshModule()

    await lookupWords(["obtain"])
    await lookupWords(["study"])

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("读取失败不会把失败缓存住，下次再问会重试", async () => {
    const { lookupWords } = await freshModule()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse("", 500) as unknown as Response)

    await expect(lookupWords(["obtain"])).rejects.toThrow(/500/)
    await expect(lookupWords(["obtain"])).resolves.toHaveProperty("obtain")
  })

  it("中文反查：合成词整体换（留学生不会变成「留students」），太简单的词不换", async () => {
    const { lookupChineseTerms } = await freshModule()

    // 高中水平、提升档（四级到六级）
    const result = await lookupChineseTerms(
      ["留学生", "交换生", "学生", "人工智能", "机会", "经济"],
      2,
      "improve",
    )

    expect(result["留学生"]?.en).toBe("international student")
    expect(result["交换生"]?.en).toBe("exchange student")
    expect(result["人工智能"]?.en).toBe("artificial intelligence")
    expect(result["机会"]?.en).toBe("opportunity")
    expect(result["经济"]?.en).toBe("economy")
    // student 是中考词，不在提升档里
    expect(result["学生"]).toBeUndefined()
  })

  it("中文反查：不把形容词、动词换成派生名词（重要 ≠ importance、选择 ≠ selection）", async () => {
    const { lookupChineseTerms } = await freshModule()

    const result = await lookupChineseTerms(["重要", "选择", "显著"], 1, "mixed")

    expect(result["重要"]?.en).not.toBe("importance")
    expect(result["选择"]?.en).not.toBe("selection")
    expect(result["显著"]?.en).not.toBe("notability")
  })

  it("中文反查：难度范围越高换上去的词越难", async () => {
    const { lookupChineseTerms } = await freshModule()

    const easy = await lookupChineseTerms(["放弃"], 2, "consolidate")
    const hard = await lookupChineseTerms(["放弃"], 2, "challenge")

    expect(easy["放弃"]?.level).toBe(2)
    expect(hard["放弃"]?.level).toBeGreaterThanOrEqual(4)
  })

  it("一次请求的词数有上限，超出的部分不查", async () => {
    const { lookupWords, MAX_WORDS_PER_LOOKUP } = await freshModule()
    const words = [...Array.from({ length: MAX_WORDS_PER_LOOKUP }, () => "zzzz"), "obtain"]

    expect(await lookupWords(words)).not.toHaveProperty("obtain")
  })
})
