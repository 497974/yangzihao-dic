import { beforeEach, describe, expect, it } from "vitest"
import { storage } from "#imports"
import {
  CACHE_TTL_MS,
  MAX_CACHE_ENTRIES,
  readCachedStructuredResult,
  structuredResultCacheKey,
  writeCachedStructuredResult,
} from "../structured-result-cache"

const PAYLOAD = {
  providerId: "bailian",
  prompt: "obtain",
  instructions: "查词",
  outputSchema: [{ name: "词条", type: "string" }],
}

describe("查词结果缓存", () => {
  beforeEach(async () => {
    await storage.removeItem("local:structuredResultCache")
  })

  it("请求 id 和字段顺序不同，也是同一把 key；提示词不同就是另一把", async () => {
    const key = await structuredResultCacheKey({ ...PAYLOAD, requestId: "a", cache: "use" })
    const reordered = await structuredResultCacheKey({
      outputSchema: PAYLOAD.outputSchema,
      instructions: PAYLOAD.instructions,
      prompt: PAYLOAD.prompt,
      providerId: PAYLOAD.providerId,
      requestId: "b",
      cache: "refresh",
    })
    const other = await structuredResultCacheKey({ ...PAYLOAD, prompt: "confront" })

    expect(reordered).toBe(key)
    expect(other).not.toBe(key)
  })

  it("存进去的结果能原样取回来", async () => {
    await writeCachedStructuredResult("k", { 词条: "obtain", 释义: "获得" }, 1_000)

    await expect(readCachedStructuredResult("k", 2_000)).resolves.toEqual({
      词条: "obtain",
      释义: "获得",
    })
  })

  it("过期了就不算", async () => {
    await writeCachedStructuredResult("k", { 词条: "obtain" }, 0)

    await expect(readCachedStructuredResult("k", CACHE_TTL_MS + 1)).resolves.toBeNull()
  })

  it("全是空字段的结果不存", async () => {
    await writeCachedStructuredResult("k", { 词条: "  ", 释义: null }, 0)

    await expect(readCachedStructuredResult("k", 0)).resolves.toBeNull()
  })

  it("超过上限时丢掉最旧的", async () => {
    for (let index = 0; index <= MAX_CACHE_ENTRIES; index++) {
      await writeCachedStructuredResult(`k${index}`, { 词条: `w${index}` }, index)
    }

    await expect(readCachedStructuredResult("k0", MAX_CACHE_ENTRIES)).resolves.toBeNull()
    await expect(
      readCachedStructuredResult(`k${MAX_CACHE_ENTRIES}`, MAX_CACHE_ENTRIES),
    ).resolves.toEqual({ 词条: `w${MAX_CACHE_ENTRIES}` })
  })
})
