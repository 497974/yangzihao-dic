/**
 * 存词带「出处」（功能路线图阶段四第 2 条）：存词时记下是在哪个网页、视频哪个时间点遇到的，
 * 复习闪卡时一点就回到原处，听一遍原声。
 *
 * 单独存一个键，不往生词本里加列：加列要改已有生词本的结构和字段映射，
 * 老用户的生词本都得迁移；出处只是复习时的附加信息，按词条挂在旁边就够了。
 * 词条按生词本去重的同一套规则归一化（大小写、空白不敏感），和生词本里的行一一对得上。
 */

import { storage } from "#imports"
import { normalizeNotebaseTerm } from "@/utils/notebase/duplicate"

export const WORD_SOURCES_STORAGE_KEY = "local:wordSourcesDb" as const

/** 最多记这么多个词的出处，超了先丢最早存的——几千个词之后很少再回头看最早那批的出处 */
export const MAX_WORD_SOURCES = 5_000

/** 字幕里点了词之后这么久以内存的词，才算「从这个视频的这句存的」 */
export const SUBTITLE_LOOKUP_TTL_MS = 10 * 60 * 1000

export interface WordSource {
  url: string
  title: string
  savedAt: number
  /** 从视频字幕里查的：那句字幕开始的时间点（秒） */
  videoTimeSec?: number
}

export type WordSourcesDb = Record<string, WordSource>

/** 只记普通网页：扩展自己的页面、浏览器内部页面记了也打不开 */
export function isRecordableSourceUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * 同一个词再存一次时出处怎么定：保留第一次遇到的地方——那才是「在哪学的这个词」；
 * 只有原来没有视频时间点、这次有，才换成这次的：能回去听原声比只有网页链接有用得多。
 */
export function mergeWordSource(
  db: WordSourcesDb,
  term: string,
  source: WordSource,
  max = MAX_WORD_SOURCES,
): WordSourcesDb {
  const key = normalizeNotebaseTerm(term)
  if (!key) {
    return db
  }
  const existing = db[key]
  if (existing && (existing.videoTimeSec !== undefined || source.videoTimeSec === undefined)) {
    return db
  }
  const next: WordSourcesDb = { ...db, [key]: source }
  const keys = Object.keys(next)
  if (keys.length <= max) {
    return next
  }
  const oldestFirst = keys.sort((a, b) => (next[a]?.savedAt ?? 0) - (next[b]?.savedAt ?? 0))
  for (const drop of oldestFirst.slice(0, keys.length - max)) {
    delete next[drop]
  }
  return next
}

export function findWordSource(db: WordSourcesDb, term: string): WordSource | null {
  return db[normalizeNotebaseTerm(term)] ?? null
}

/** 回到原处的链接：YouTube、B 站带上时间点直接从那句开始播；别的网站原样打开 */
export function buildSourceLink(source: WordSource): string {
  if (source.videoTimeSec === undefined) {
    return source.url
  }
  const seconds = Math.max(0, Math.floor(source.videoTimeSec))
  try {
    const url = new URL(source.url)
    const host = url.hostname.replace(/^(www|m)\./, "")
    if (host === "youtube.com" || host === "youtu.be") {
      url.searchParams.set("t", `${seconds}s`)
      return url.toString()
    }
    if (host.endsWith("bilibili.com")) {
      url.searchParams.set("t", String(seconds))
      return url.toString()
    }
  } catch {
    return source.url
  }
  return source.url
}

/** 视频时间点：65 → 1:05，3723 → 1:02:03 */
export function formatVideoTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`
}

// ── 字幕点词 → 存词：记下点词时视频播到哪 ──────────────────────────────
// 点词和存词都发生在同一个页面的划词脚本里，模块里的变量两边都看得到

let lastSubtitleLookup: { url: string; timeMs: number; at: number } | null = null

/** 字幕里点了一个词（见 subtitles.content 的字幕学习模式）：记下是这个页面、那句字幕的开头 */
export function rememberSubtitleLookup(url: string, timeMs: number, now = Date.now()) {
  lastSubtitleLookup = { url, timeMs, at: now }
}

/** 这次存词是不是刚从字幕里点出来的：同一个页面、不久之前 → 那句字幕的时间点（秒） */
export function videoTimeForSave(url: string, now = Date.now()): number | undefined {
  const lookup = lastSubtitleLookup
  if (!lookup || lookup.url !== url || now - lookup.at > SUBTITLE_LOOKUP_TTL_MS) {
    return undefined
  }
  return Math.floor(lookup.timeMs / 1000)
}

export async function getWordSources(): Promise<WordSourcesDb> {
  return (await storage.getItem<WordSourcesDb>(WORD_SOURCES_STORAGE_KEY)) ?? {}
}

export async function recordWordSource(term: string, source: WordSource): Promise<void> {
  if (!isRecordableSourceUrl(source.url)) {
    return
  }
  const db = await getWordSources()
  const next = mergeWordSource(db, term, source)
  if (next !== db) {
    await storage.setItem(WORD_SOURCES_STORAGE_KEY, next)
  }
}

export function watchWordSources(onChange: (db: WordSourcesDb) => void): () => void {
  return storage.watch<WordSourcesDb>(WORD_SOURCES_STORAGE_KEY, (value) => onChange(value ?? {}))
}
