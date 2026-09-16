/**
 * 大模型结构化查词结果的缓存：同一个词、同一套提示词和供应商，再查直接用上次的结果，
 * 不再调用大模型——百炼这类按量计费的接口，一个词查两遍就是两份钱，还要多等十几秒。
 *
 * - 只有调用方明确要（payload.cache）才用：网页词典弹窗、桌面查词会带，其它结构化请求不受影响
 * - 「重新生成」带 cache: "refresh"：不看缓存、重新问模型，并用新结果覆盖旧的
 * - key 是整个请求（供应商、模型参数、提示词、输出字段）的哈希：改了设置或提示词自然就不命中
 * - 存在 chrome.storage.local，最多 MAX_CACHE_ENTRIES 条、CACHE_TTL_MS 内有效，旧的先丢
 */

import { storage } from "#imports"

export type StructuredResultCacheMode = "use" | "refresh"

const CACHE_STORAGE_KEY = "local:structuredResultCache"
export const MAX_CACHE_ENTRIES = 300
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

interface CacheEntry {
  output: Record<string, unknown>
  savedAt: number
}

type CacheStore = Record<string, CacheEntry>

/** 键按字母排序后再序列化：同一个请求字段顺序不同，也得算出同一把 key */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

/** 请求 id 每次都不一样、cache 只是开关，都不算进 key */
export async function structuredResultCacheKey(payload: object): Promise<string> {
  const { requestId: _requestId, cache: _cache, ...request } = payload as Record<string, unknown>
  const bytes = new TextEncoder().encode(stableStringify(request))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** 至少有一个字段有内容才值得存：模型偶尔会返回空对象 */
function hasContent(output: Record<string, unknown>): boolean {
  return Object.values(output).some((value) =>
    typeof value === "string" ? value.trim() !== "" : value !== null && value !== undefined,
  )
}

async function readStore(): Promise<CacheStore> {
  return (await storage.getItem<CacheStore>(CACHE_STORAGE_KEY)) ?? {}
}

export async function readCachedStructuredResult(
  key: string,
  now = Date.now(),
): Promise<Record<string, unknown> | null> {
  const entry = (await readStore())[key]
  if (!entry || now - entry.savedAt > CACHE_TTL_MS) {
    return null
  }
  return entry.output
}

export async function writeCachedStructuredResult(
  key: string,
  output: Record<string, unknown>,
  now = Date.now(),
): Promise<void> {
  if (!hasContent(output)) {
    return
  }
  const store = await readStore()
  store[key] = { output, savedAt: now }
  const kept = Object.entries(store)
    .filter(([, entry]) => now - entry.savedAt <= CACHE_TTL_MS)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, MAX_CACHE_ENTRIES)
  await storage.setItem(CACHE_STORAGE_KEY, Object.fromEntries(kept))
}
