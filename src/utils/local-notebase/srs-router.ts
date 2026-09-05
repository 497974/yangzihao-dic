/**
 * 本地闪卡与间隔重复 · 契约实现
 *
 * 实现 card / cardTemplate / srs / stats 四个路由，数据全在 chrome.storage。
 * 上游把这些接口放在云端并与订阅绑定，本项目改为完全本地。
 */

import type { LocalCard, LocalCardTemplate } from "./srs-storage"
import { implement } from "@orpc/server"
import { contract } from "@read-frog/api-contract"
import { DEFAULT_SRS_SCHEDULING_PARAMS } from "@read-frog/definitions"
import {
  cardStateToScheduleStatus,
  initialCardMemory,
  renderPattern,
  scheduleReview,
} from "./srs-scheduler"
import { mutateSrsDb, nextSrsTxid, readSrsDb } from "./srs-storage"
import { readDb } from "./storage"

const os = implement(contract)

function uuid() {
  return crypto.randomUUID()
}

function nowIso() {
  return new Date().toISOString()
}

function serializeCard(c: LocalCard) {
  return {
    ...c,
    dueAt: new Date(c.dueAt),
    lastReviewTime: c.lastReviewTime ? new Date(c.lastReviewTime) : null,
    buriedAt: c.buriedAt ? new Date(c.buriedAt) : null,
    createdAt: new Date(c.createdAt),
    updatedAt: new Date(c.updatedAt),
  }
}

function serializeTemplate(t: LocalCardTemplate) {
  return { ...t, createdAt: new Date(t.createdAt), updatedAt: new Date(t.updatedAt) }
}

/**
 * 笔记库若还没有卡片模板，按它的列自动建一个：
 * 正面 = 主列（词条），背面 = 其余列。
 * 否则用户存完词还要先手动配模板才能复习，多一道坎。
 */
function defaultTemplateConfig(columns: { id: string; name: string; isPrimary: boolean }[]) {
  const sorted = [...columns]
  const primary = sorted.find((c) => c.isPrimary) ?? sorted[0]
  const rest = sorted.filter((c) => c.id !== primary?.id)
  return {
    type: "basic" as const,
    frontPattern: `{{${primary?.name ?? ""}}}`,
    backPattern: rest.map((c) => `{{${c.name}}}`).join("\n"),
  }
}

async function ensureTemplate(notebaseId: string): Promise<LocalCardTemplate> {
  const srs = await readSrsDb()
  const existing = Object.values(srs.templates).find((t) => t.notebaseId === notebaseId)
  if (existing) return existing

  const nbDb = await readDb()
  const nb = nbDb.notebases[notebaseId]
  const cols = (nb?.notebaseColumns ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    isPrimary: c.isPrimary,
  }))
  const ts = nowIso()
  const tpl: LocalCardTemplate = {
    id: uuid(),
    notebaseId,
    name: "默认卡片",
    config: defaultTemplateConfig(cols),
    createdAt: ts,
    updatedAt: ts,
  }
  await mutateSrsDb((db) => {
    db.templates[tpl.id] = tpl
    nextSrsTxid(db)
  })
  return tpl
}

/** 给笔记库里还没有卡片的行补齐卡片 */
async function generateCards(notebaseId: string, templateId?: string) {
  const tpl = templateId
    ? (await readSrsDb()).templates[templateId]
    : await ensureTemplate(notebaseId)
  if (!tpl) return { created: 0, txid: 0 }

  const nbDb = await readDb()
  const nb = nbDb.notebases[notebaseId]
  if (!nb) return { created: 0, txid: 0 }

  return mutateSrsDb((db) => {
    const have = new Set(
      Object.values(db.cards)
        .filter((c) => c.templateId === tpl.id)
        .map((c) => c.notebaseRowId),
    )
    const now = new Date()
    let created = 0
    for (const row of nb.notebaseRows) {
      if (have.has(row.id)) continue
      const id = uuid()
      db.cards[id] = {
        id,
        notebaseId,
        notebaseRowId: row.id,
        templateId: tpl.id,
        variantKey: "basic",
        ...initialCardMemory(now),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      created++
    }
    return { created, txid: nextSrsTxid(db) }
  })
}

async function renderCard(c: LocalCard) {
  const srs = await readSrsDb()
  const tpl = srs.templates[c.templateId]
  const nbDb = await readDb()
  const nb = nbDb.notebases[c.notebaseId]
  const row = nb?.notebaseRows.find((r) => r.id === c.notebaseRowId)
  const cols = (nb?.notebaseColumns ?? []).map((x) => ({ id: x.id, name: x.name }))
  const cells = row?.cells ?? {}
  return {
    ...serializeCard(c),
    front: tpl ? renderPattern(tpl.config.frontPattern, cells, cols) : "",
    back: tpl ? renderPattern(tpl.config.backPattern, cells, cols) : "",
  }
}

/* ───────────────────────── card ───────────────────────── */

const cardRouter = os.card.router({
  list: os.card.list.handler(async ({ input }) => {
    // 先补齐卡片：用户存了新词就该能复习，不用手动点"生成"
    await generateCards(input.notebaseId, input.templateId)
    const db = await readSrsDb()
    let cards = Object.values(db.cards).filter((c) => c.notebaseId === input.notebaseId)
    if (input.templateId) cards = cards.filter((c) => c.templateId === input.templateId)
    cards.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
    const start = input.offset ?? 0
    const page = cards.slice(start, start + (input.limit ?? cards.length))
    return Promise.all(page.map(renderCard))
  }),

  get: os.card.get.handler(async ({ input, errors }) => {
    const db = await readSrsDb()
    const c = db.cards[input.id]
    if (!c) throw errors.CARD_NOT_FOUND()
    return renderCard(c)
  }),

  generate: os.card.generate.handler(async ({ input }) =>
    generateCards(input.notebaseId, input.templateId),
  ),
})

/* ────────────────────── cardTemplate ────────────────────── */

const cardTemplateRouter = os.cardTemplate.router({
  list: os.cardTemplate.list.handler(async ({ input }) => {
    await ensureTemplate(input.notebaseId)
    const db = await readSrsDb()
    return Object.values(db.templates)
      .filter((t) => t.notebaseId === input.notebaseId)
      .map(serializeTemplate)
  }),

  get: os.cardTemplate.get.handler(async ({ input, errors }) => {
    const db = await readSrsDb()
    const t = db.templates[input.id]
    if (!t) throw errors.CARD_TEMPLATE_NOT_FOUND()
    return serializeTemplate(t)
  }),

  create: os.cardTemplate.create.handler(async ({ input }) =>
    mutateSrsDb((db) => {
      const id = input.id ?? uuid()
      const ts = nowIso()
      const tpl: LocalCardTemplate = {
        id,
        notebaseId: input.notebaseId,
        name: input.name,
        config: input.config,
        createdAt: ts,
        updatedAt: ts,
      }
      db.templates[id] = tpl
      return { ...serializeTemplate(tpl), txid: nextSrsTxid(db) }
    }),
  ),

  update: os.cardTemplate.update.handler(async ({ input, errors }) =>
    mutateSrsDb((db) => {
      const t = db.templates[input.id]
      if (!t) throw errors.CARD_TEMPLATE_NOT_FOUND()
      if (input.name !== undefined) t.name = input.name
      if (input.config !== undefined) t.config = input.config
      t.updatedAt = nowIso()
      return { ...serializeTemplate(t), txid: nextSrsTxid(db) }
    }),
  ),

  delete: os.cardTemplate.delete.handler(async ({ input, errors }) =>
    mutateSrsDb((db) => {
      if (!db.templates[input.id]) throw errors.CARD_TEMPLATE_NOT_FOUND()
      delete db.templates[input.id]
      // 模板没了，它的卡片也留不得
      for (const [cid, c] of Object.entries(db.cards)) {
        if (c.templateId === input.id) delete db.cards[cid]
      }
      return { txid: nextSrsTxid(db) }
    }),
  ),
})

/* ───────────────────────── srs ───────────────────────── */

async function paramsFor(notebaseId: string) {
  const nbDb = await readDb()
  const nb = nbDb.notebases[notebaseId]
  return {
    desiredRetention: nb?.srsDesiredRetention ?? DEFAULT_SRS_SCHEDULING_PARAMS.desiredRetention,
    maximumInterval: nb?.srsMaximumInterval ?? DEFAULT_SRS_SCHEDULING_PARAMS.maximumInterval,
    enableShortTerm: nb?.srsEnableShortTerm ?? DEFAULT_SRS_SCHEDULING_PARAMS.enableShortTerm,
    learningSteps: (nb?.srsLearningSteps as unknown as string[]) ?? [
      ...DEFAULT_SRS_SCHEDULING_PARAMS.learningSteps,
    ],
    relearningSteps: (nb?.srsRelearningSteps as unknown as string[]) ?? [
      ...DEFAULT_SRS_SCHEDULING_PARAMS.relearningSteps,
    ],
    enableFuzz: nb?.srsEnableFuzz ?? DEFAULT_SRS_SCHEDULING_PARAMS.enableFuzz,
    weights: nb?.srsWeights ?? undefined,
  }
}

const srsRouter = os.srs.router({
  review: os.srs.review.handler(async ({ input, errors }) => {
    const pre = await readSrsDb()
    const card0 = pre.cards[input.cardId]
    if (!card0) throw errors.CARD_NOT_FOUND()

    // 幂等重放：同一 id 已记过就直接返回，不重复推进调度
    if (input.id) {
      const dup = pre.revlogs.find((r) => r.id === input.id)
      if (dup) {
        const cur = pre.cards[input.cardId]!
        return {
          card: serializeCard(cur),
          revlog: {
            ...dup,
            reviewedAt: new Date(dup.reviewedAt),
            createdAt: new Date(dup.createdAt),
          },
          txid: pre.txid,
          created: false,
        }
      }
    }

    const params = await paramsFor(card0.notebaseId)
    const reviewedAt = new Date()
    const { card: nextState, snapshot } = scheduleReview(card0, input.rating, params, reviewedAt)

    return mutateSrsDb((db) => {
      const card = db.cards[input.cardId]!
      const before = { ...card }
      Object.assign(card, nextState, { updatedAt: nowIso() })

      const revlog = {
        id: input.id ?? uuid(),
        notebaseId: card.notebaseId,
        cardId: card.id,
        rating: input.rating,
        state: before.state,
        stability: before.stability,
        afterScheduleStatus: card.scheduleStatus,
        afterStability: card.stability,
        reviewedAt: reviewedAt.toISOString(),
        durationMs: input.durationMs,
        fsrsReviewLogSnapshot: snapshot,
        createdAt: nowIso(),
        beforeCard: before,
      }
      db.revlogs.push(revlog)

      return {
        card: serializeCard(card),
        revlog: { ...revlog, reviewedAt, createdAt: new Date(revlog.createdAt) },
        txid: nextSrsTxid(db),
        created: true,
      }
    })
  }),

  rollbackReview: os.srs.rollbackReview.handler(async ({ input, errors }) =>
    mutateSrsDb((db) => {
      // 找该卡最后一条复习记录，把状态整个还原回去
      let idx = -1
      for (let i = db.revlogs.length - 1; i >= 0; i--) {
        if (db.revlogs[i]!.cardId === input.cardId) {
          idx = i
          break
        }
      }
      if (idx < 0) throw errors.CARD_NOT_FOUND()
      const log = db.revlogs[idx]!
      const card = db.cards[input.cardId]
      if (!card) throw errors.CARD_NOT_FOUND()

      Object.assign(card, log.beforeCard, { updatedAt: nowIso() })
      db.revlogs.splice(idx, 1)
      return {
        card: serializeCard(card),
        rolledBackRevlogId: log.id,
        txid: nextSrsTxid(db),
      }
    }),
  ),

  listCardRevlogs: os.srs.listCardRevlogs.handler(async ({ input }) => {
    const db = await readSrsDb()
    return {
      items: db.revlogs
        .filter((r) => r.cardId === input.cardId)
        .map(({ fsrsReviewLogSnapshot: _s, beforeCard: _b, ...rest }) => ({
          ...rest,
          reviewedAt: new Date(rest.reviewedAt),
          createdAt: new Date(rest.createdAt),
        })),
    }
  }),

  scheduleStatusStats: os.srs.scheduleStatusStats.handler(async ({ input }) => {
    const nbDb = await readDb()
    const ids = input.notebaseIds ?? Object.keys(nbDb.notebases)
    // 统计前先补卡，否则新存的词不计入待学数量
    for (const id of ids) await generateCards(id)

    const db = await readSrsDb()
    const out: Record<string, Record<string, number>> = {}
    for (const id of ids) {
      const counts = { new: 0, learning: 0, review: 0 }
      for (const c of Object.values(db.cards)) {
        if (c.notebaseId !== id) continue
        if (c.scheduleStatus === "suspended" || c.scheduleStatus === "buried") continue
        // 只数到期的
        if (c.scheduleStatus !== "new" && new Date(c.dueAt) > new Date()) continue
        counts[cardStateToScheduleStatus(c.state)]++
      }
      out[id] = counts
    }
    return out
  }),

  setCardBuried: os.srs.setCardBuried.handler(async ({ input, errors }) =>
    mutateSrsDb((db) => {
      const c = db.cards[input.cardId]
      if (!c) throw errors.CARD_NOT_FOUND()
      c.buriedAt = input.enabled ? nowIso() : null
      c.scheduleStatus = input.enabled ? "buried" : cardStateToScheduleStatus(c.state)
      c.updatedAt = nowIso()
      return { txid: nextSrsTxid(db) }
    }),
  ),

  setCardSuspended: os.srs.setCardSuspended.handler(async ({ input, errors }) =>
    mutateSrsDb((db) => {
      const c = db.cards[input.cardId]
      if (!c) throw errors.CARD_NOT_FOUND()
      c.scheduleStatus = input.enabled ? "suspended" : cardStateToScheduleStatus(c.state)
      c.updatedAt = nowIso()
      return { txid: nextSrsTxid(db) }
    }),
  ),
})

/* ──────────────────────── stats ──────────────────────── */

/**
 * 之前这三个接口的实现和真实契约（@read-frog/api-contract 的
 * statsInputSchema / activityStatsOutputSchema 等）对不上——输入少了必填的
 * to/timezone，输出形状也是瞎猜的 {items:[{date,count}]}，从写完就没被
 * 真正调用过，一调用就会在 schema 校验这关直接失败。这里按真实契约重写。
 */

/** 按调用方时区取"日"边界，而不是 UTC 日——否则跨时区用户的"今天"会算错。 */
function dayKeyInTz(d: Date, timezone: string): string {
  // en-CA 恰好格式化成 YYYY-MM-DD，省得手拼字符串
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
}

function inRange(dateKey: string, from: string | undefined, to: string) {
  return (!from || dateKey >= from) && dateKey <= to
}

const LONG_TERM_STABILITY_DAYS = 21 // 与 @read-frog/definitions 的 SRS_LONG_TERM_MEMORY_STABILITY_DAYS 一致

const statsRouter = os.stats.router({
  activity: os.stats.activity.handler(async ({ input }) => {
    const srsDb = await readSrsDb()
    const nbDb = await readDb()
    const { from, to, timezone, notebaseIds } = input
    const idSet = notebaseIds ? new Set(notebaseIds) : null

    const srsByDay = new Map<string, { answers: number; durationMs: number }>()
    for (const r of srsDb.revlogs) {
      if (idSet && !idSet.has(r.notebaseId)) continue
      const k = dayKeyInTz(new Date(r.reviewedAt), timezone)
      if (!inRange(k, from, to)) continue
      const acc = srsByDay.get(k) ?? { answers: 0, durationMs: 0 }
      acc.answers += 1
      acc.durationMs += r.durationMs
      srsByDay.set(k, acc)
    }

    const learnedCards = Object.values(srsDb.cards).filter(
      (c) => (!idSet || idSet.has(c.notebaseId)) && c.reps > 0,
    ).length

    const notebaseByDay = new Map<string, number>()
    for (const nb of Object.values(nbDb.notebases)) {
      if (idSet && !idSet.has(nb.id)) continue
      for (const row of nb.notebaseRows) {
        const k = dayKeyInTz(new Date(row.createdAt), timezone)
        if (!inRange(k, from, to)) continue
        notebaseByDay.set(k, (notebaseByDay.get(k) ?? 0) + 1)
      }
    }

    return {
      srs: {
        learnedCards,
        daily: [...srsByDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, v]) => ({ date, answers: v.answers, durationMs: v.durationMs })),
      },
      notebase: {
        daily: [...notebaseByDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, notes]) => ({ date, notes })),
      },
    }
  }),

  srsMemoryGrowth: os.stats.srsMemoryGrowth.handler(async ({ input }) => {
    const db = await readSrsDb()
    const { from, to, timezone, notebaseIds } = input
    const idSet = notebaseIds ? new Set(notebaseIds) : null

    // 净变化：同一天里，从"未达长期记忆"跨到"达标"记 +1，反向（复习失败掉出长期记忆）记 -1
    const deltaByDay = new Map<string, number>()
    let baseTotal = 0
    for (const r of db.revlogs) {
      if (idSet && !idSet.has(r.notebaseId)) continue
      const crossedUp =
        r.stability < LONG_TERM_STABILITY_DAYS && r.afterStability >= LONG_TERM_STABILITY_DAYS
      const crossedDown =
        r.stability >= LONG_TERM_STABILITY_DAYS && r.afterStability < LONG_TERM_STABILITY_DAYS
      if (!crossedUp && !crossedDown) continue

      const k = dayKeyInTz(new Date(r.reviewedAt), timezone)
      if (from && k < from) {
        // from 之前发生的跨越，累进基线而不是计入每日明细
        baseTotal += crossedUp ? 1 : -1
        continue
      }
      if (k > to) continue
      deltaByDay.set(k, (deltaByDay.get(k) ?? 0) + (crossedUp ? 1 : -1))
    }

    return {
      baseTotal: Math.max(baseTotal, 0),
      daily: [...deltaByDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, delta]) => ({ date, delta })),
    }
  }),

  notebaseRowGrowth: os.stats.notebaseRowGrowth.handler(async ({ input }) => {
    const nbDb = await readDb()
    const { from, to, timezone, notebaseIds } = input
    const idSet = notebaseIds ? new Set(notebaseIds) : null

    const deltaByDay = new Map<string, number>()
    let baseTotal = 0
    for (const nb of Object.values(nbDb.notebases)) {
      if (idSet && !idSet.has(nb.id)) continue
      for (const row of nb.notebaseRows) {
        const k = dayKeyInTz(new Date(row.createdAt), timezone)
        if (from && k < from) {
          baseTotal += 1
          continue
        }
        if (k > to) continue
        deltaByDay.set(k, (deltaByDay.get(k) ?? 0) + 1)
      }
    }

    return {
      baseTotal,
      daily: [...deltaByDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, delta]) => ({ date, delta })),
    }
  }),
})

export const localSrsRouter = {
  card: cardRouter,
  cardTemplate: cardTemplateRouter,
  srs: srsRouter,
  stats: statsRouter,
}
