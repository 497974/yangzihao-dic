/**
 * 查词次数（优化清单第 11 条）：每查一次词典记一笔，弹窗里显示「第 3 次查这个词」。
 *
 * 查了好几次还记不住的词最该复习：一个已经存进生词本的词又被查了，
 * 就把它排在以后的复习卡提前到今天。
 *
 * 存在 chrome.storage.local；只记词（规范化后的）、次数和最后一次的时间，不记句子。
 * 网页词典经消息调用，桌面查词在后台里直接调用。
 */

import type { DictionaryLookupRecord } from "@/types/lookup-history"
import { storage } from "#imports"
import { mutateSrsDb, nextSrsTxid } from "@/utils/local-notebase/srs-storage"
import { readDb } from "@/utils/local-notebase/storage"
import { onMessage } from "@/utils/message"
import { findDuplicateNotebaseRow, normalizeNotebaseTerm } from "@/utils/notebase/duplicate"

export const LOOKUP_HISTORY_KEY = "local:dictionaryLookupHistory"
/** 记这么多个词就够了，再多先丢最久没查的 */
export const MAX_HISTORY_ENTRIES = 5_000
/** 这么长的多半是整句，不算"查词" */
const MAX_TERM_LENGTH = 60

interface HistoryEntry {
  count: number
  lastAt: number
}

type History = Record<string, HistoryEntry>

/** 在生词本里找这个词（只比词条列，规则和存词去重一样） */
async function findSavedRow(text: string) {
  const db = await readDb()
  for (const notebase of Object.values(db.notebases)) {
    const primary =
      notebase.notebaseColumns.find((column) => column.isPrimary) ??
      [...notebase.notebaseColumns].sort((a, b) => a.position - b.position)[0]
    if (!primary) {
      continue
    }
    const row = findDuplicateNotebaseRow(notebase.notebaseColumns, notebase.notebaseRows, {
      [primary.id]: text,
    })
    if (row) {
      return row
    }
  }
  return null
}

/** 这一行排在以后的复习卡提前到现在；新卡、已经到期的、暂停和搁置的不动 */
async function bumpReview(rowId: string, now: number): Promise<boolean> {
  return mutateSrsDb((db) => {
    let bumped = false
    const nowIso = new Date(now).toISOString()
    for (const card of Object.values(db.cards)) {
      if (card.notebaseRowId !== rowId) {
        continue
      }
      if (card.scheduleStatus !== "review" && card.scheduleStatus !== "learning") {
        continue
      }
      if (new Date(card.dueAt).getTime() <= now) {
        continue
      }
      card.dueAt = nowIso
      card.updatedAt = nowIso
      bumped = true
    }
    if (bumped) {
      nextSrsTxid(db)
    }
    return bumped
  })
}

/** 记一次查词；不像一个词（空的、太长的）就不记，返回 null */
export async function recordDictionaryLookup(
  text: string,
  now = Date.now(),
): Promise<DictionaryLookupRecord | null> {
  const term = normalizeNotebaseTerm(text)
  if (!term || term.length > MAX_TERM_LENGTH) {
    return null
  }

  const history = (await storage.getItem<History>(LOOKUP_HISTORY_KEY)) ?? {}
  const count = (history[term]?.count ?? 0) + 1
  history[term] = { count, lastAt: now }
  const entries = Object.entries(history)
  const kept =
    entries.length > MAX_HISTORY_ENTRIES
      ? Object.fromEntries(
          entries.sort(([, a], [, b]) => b.lastAt - a.lastAt).slice(0, MAX_HISTORY_ENTRIES),
        )
      : history
  await storage.setItem(LOOKUP_HISTORY_KEY, kept)

  const row = await findSavedRow(text)
  if (!row) {
    return { count, inNotebase: false, reviewBumped: false }
  }
  const reviewBumped = count >= 2 ? await bumpReview(row.id, now) : false
  return { count, inNotebase: true, reviewBumped }
}

export function setupLookupHistoryMessageHandlers() {
  onMessage("recordDictionaryLookup", (message) => recordDictionaryLookup(message.data.text))
}
