/**
 * 本地笔记库 · 契约实现
 *
 * 按 api-contract 的 ORPC 契约实现全部笔记库接口，
 * 数据落在 chrome.storage.local，不经过任何服务器。
 */

import type { LocalNotebase, LocalNotebaseDb } from "./storage"
import { implement } from "@orpc/server"
import { contract } from "@read-frog/api-contract"
import { DEFAULT_SRS_SCHEDULING_PARAMS } from "@read-frog/definitions"
import { errs } from "./orpc-errors"
import { mutateSrsDb } from "./srs-storage"
import { mutateDb, nextTxid, nowIso, readDb } from "./storage"

const LOCAL_USER_ID = "local-user"

function uuid(): string {
  return crypto.randomUUID()
}

function requireNotebase(
  db: LocalNotebaseDb,
  id: string,
  errors: { NOTEBASE_NOT_FOUND: unknown },
): LocalNotebase {
  const nb = db.notebases[id]
  // 必须抛契约定义的类型化错误，否则调用方的 isORPCNotFoundError 判断失效，
  // 用户只会看到一个泛化的失败提示。
  if (!nb) throw errs(errors).NOTEBASE_NOT_FOUND()
  return nb
}

function findRow(db: LocalNotebaseDb, rowId: string, errors: { NOTEBASE_ROW_NOT_FOUND: unknown }) {
  for (const nb of Object.values(db.notebases)) {
    const idx = nb.notebaseRows.findIndex((r) => r.id === rowId)
    if (idx >= 0) return { nb, idx, row: nb.notebaseRows[idx]! }
  }
  throw errs(errors).NOTEBASE_ROW_NOT_FOUND()
}

function serialize(nb: LocalNotebase) {
  return {
    ...nb,
    createdAt: new Date(nb.createdAt),
    updatedAt: new Date(nb.updatedAt),
    notebaseColumns: nb.notebaseColumns.map((c) => ({
      ...c,
      createdAt: new Date(c.createdAt),
      updatedAt: new Date(c.updatedAt),
    })),
    notebaseRows: nb.notebaseRows.map((r) => ({
      ...r,
      createdAt: new Date(r.createdAt),
      updatedAt: new Date(r.updatedAt),
    })),
    notebaseViews: nb.notebaseViews ?? [],
  }
}

function makeNotebase(id: string, name: string): LocalNotebase {
  const ts = nowIso()
  return {
    id,
    userId: LOCAL_USER_ID,
    name,
    srsNewPerDay: DEFAULT_SRS_SCHEDULING_PARAMS.newPerDay,
    srsReviewsPerDay: DEFAULT_SRS_SCHEDULING_PARAMS.reviewsPerDay,
    srsDesiredRetention: DEFAULT_SRS_SCHEDULING_PARAMS.desiredRetention,
    srsEnableShortTerm: DEFAULT_SRS_SCHEDULING_PARAMS.enableShortTerm,
    srsMaximumInterval: DEFAULT_SRS_SCHEDULING_PARAMS.maximumInterval,
    srsLearningSteps: [...DEFAULT_SRS_SCHEDULING_PARAMS.learningSteps],
    srsRelearningSteps: [...DEFAULT_SRS_SCHEDULING_PARAMS.relearningSteps],
    srsLeechThreshold: DEFAULT_SRS_SCHEDULING_PARAMS.leechThreshold,
    srsEnableFuzz: DEFAULT_SRS_SCHEDULING_PARAMS.enableFuzz,
    srsWeights: null,
    createdAt: ts,
    updatedAt: ts,
    notebaseColumns: [],
    notebaseRows: [],
    notebaseViews: [],
  }
}

const os = implement(contract)

const notebaseRouter = os.notebase.router({
  list: os.notebase.list.handler(async () => {
    const db = await readDb()
    return Object.values(db.notebases).map((nb) => ({ id: nb.id, name: nb.name }))
  }),

  get: os.notebase.get.handler(async ({ input, errors }) => {
    const db = await readDb()
    return serialize(requireNotebase(db, input.id, errors))
  }),

  getSchema: os.notebase.getSchema.handler(async ({ input, errors }) => {
    const db = await readDb()
    const nb = requireNotebase(db, input.id, errors)
    return {
      id: nb.id,
      name: nb.name,
      updatedAt: new Date(nb.updatedAt),
      notebaseColumns: nb.notebaseColumns.map((c) => ({
        ...c,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
      })),
    }
  }),

  create: os.notebase.create.handler(async ({ input, errors }) =>
    mutateDb((db) => {
      const id = input.id ?? uuid()
      // 同 id 重复创建会静默覆盖既有笔记库（连同全部行），必须拒绝。
      const existing = db.notebases[id]
      if (existing) {
        throw errs(errors).CELL_VALIDATION_FAILED({
          message: `Notebase already exists with ${existing.notebaseRows.length} rows; refusing to overwrite.`,
        })
      }
      const nb = makeNotebase(id, input.name)
      const ts = nowIso()

      nb.notebaseColumns = (input.options?.initialColumns ?? []).map((c, i) => ({
        id: c.id,
        notebaseId: id,
        name: c.name,
        config: c.config,
        position: i,
        isPrimary: i === 0,
        width: null,
        wrap: false,
        createdAt: ts,
        updatedAt: ts,
      }))

      const initial =
        input.options?.initialRows ?? (input.options?.initialRow ? [input.options.initialRow] : [])
      nb.notebaseRows = initial.map((r, i) => ({
        id: r.id ?? uuid(),
        notebaseId: id,
        cells: r.cells ?? {},
        position: i,
        createdAt: ts,
        updatedAt: ts,
      }))

      db.notebases[id] = nb
      return { txid: nextTxid(db) }
    }),
  ),

  update: os.notebase.update.handler(async ({ input, errors }) =>
    mutateDb((db) => {
      const nb = requireNotebase(db, input.id, errors)
      if (input.name !== undefined) nb.name = input.name
      if (input.srsNewPerDay !== undefined) nb.srsNewPerDay = input.srsNewPerDay
      if (input.srsReviewsPerDay !== undefined) nb.srsReviewsPerDay = input.srsReviewsPerDay
      if (input.srsDesiredRetention !== undefined)
        nb.srsDesiredRetention = input.srsDesiredRetention
      nb.updatedAt = nowIso()
      return { txid: nextTxid(db) }
    }),
  ),

  delete: os.notebase.delete.handler(async ({ input, errors }) =>
    mutateDb((db) => {
      requireNotebase(db, input.id, errors)
      delete db.notebases[input.id]
      return { txid: nextTxid(db) }
    }),
  ),
})

const notebaseRowRouter = os.notebaseRow.router({
  create: os.notebaseRow.create.handler(async ({ input, errors }) =>
    mutateDb((db) => {
      const nb = requireNotebase(db, input.notebaseId, errors)
      const ts = nowIso()
      nb.notebaseRows.push({
        id: input.data.id ?? uuid(),
        notebaseId: nb.id,
        cells: input.data.cells ?? {},
        position: nb.notebaseRows.length,
        createdAt: ts,
        updatedAt: ts,
      })
      nb.updatedAt = ts
      return { txid: nextTxid(db) }
    }),
  ),

  createMany: os.notebaseRow.createMany.handler(async ({ input, errors }) =>
    mutateDb((db) => {
      const nb = requireNotebase(db, input.notebaseId, errors)
      const ts = nowIso()
      for (const r of input.rows) {
        nb.notebaseRows.push({
          id: r.id ?? uuid(),
          notebaseId: nb.id,
          cells: r.cells ?? {},
          position: nb.notebaseRows.length,
          createdAt: ts,
          updatedAt: ts,
        })
      }
      nb.updatedAt = ts
      return { txid: nextTxid(db) }
    }),
  ),

  update: os.notebaseRow.update.handler(async ({ input, errors }) =>
    mutateDb((db) => {
      const { nb, row } = findRow(db, input.notebaseRowId, errors)
      if (input.data.cells !== undefined) row.cells = input.data.cells
      row.updatedAt = nowIso()
      nb.updatedAt = row.updatedAt
      return {
        id: row.id,
        notebaseId: row.notebaseId,
        cells: row.cells,
        position: row.position,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
        txid: nextTxid(db),
      }
    }),
  ),

  delete: os.notebaseRow.delete.handler(async ({ input, errors }) => {
    const result = await mutateDb((db) => {
      const { nb, idx } = findRow(db, input.notebaseRowId, errors)
      nb.notebaseRows.splice(idx, 1)
      nb.notebaseRows.forEach((r, i) => {
        r.position = i
      })
      nb.updatedAt = nowIso()
      return { txid: nextTxid(db) }
    })

    // 连带清掉这条生词的闪卡与复习日志。
    //
    // 卡片的正反面是拿 notebaseRowId 回笔记库取单元格现渲染出来的
    // （见 srs-router 的 renderCard）。行没了但卡片还在的话，取不到单元格就
    // 渲染成空字符串——复习时会蹦出一张正反面全空的卡，既没法答也删不掉。
    // 所以删词必须同时收走它的卡片，否则留下的是幽灵卡。
    await mutateSrsDb((srs) => {
      const orphanCardIds = new Set(
        Object.values(srs.cards)
          .filter((c) => c.notebaseRowId === input.notebaseRowId)
          .map((c) => c.id),
      )
      if (orphanCardIds.size === 0) return
      for (const id of orphanCardIds) delete srs.cards[id]
      srs.revlogs = srs.revlogs.filter((log) => !orphanCardIds.has(log.cardId))
    })

    return result
  }),

  reorder: os.notebaseRow.reorder.handler(async ({ input, errors }) =>
    mutateDb((db) => {
      const nb = requireNotebase(db, input.notebaseId, errors)
      const byId = new Map(nb.notebaseRows.map((r) => [r.id, r]))
      const ordered = input.ids.map((id) => byId.get(id)).filter(Boolean) as typeof nb.notebaseRows
      for (const r of nb.notebaseRows) if (!input.ids.includes(r.id)) ordered.push(r)
      ordered.forEach((r, i) => {
        r.position = i
      })
      nb.notebaseRows = ordered
      nb.updatedAt = nowIso()
      return { txid: nextTxid(db) }
    }),
  ),
})

const notebaseColumnRouter = os.notebaseColumn.router({
  create: os.notebaseColumn.create.handler(async ({ input, errors }) =>
    mutateDb((db) => {
      const nb = requireNotebase(db, input.notebaseId, errors)
      const ts = nowIso()
      nb.notebaseColumns.push({
        id: input.data.id ?? uuid(),
        notebaseId: nb.id,
        name: input.data.name,
        config: input.data.config,
        position: nb.notebaseColumns.length,
        isPrimary: nb.notebaseColumns.length === 0,
        width: null,
        wrap: false,
        createdAt: ts,
        updatedAt: ts,
      })
      nb.updatedAt = ts
      return { txid: nextTxid(db) }
    }),
  ),

  update: os.notebaseColumn.update.handler(async ({ input, errors }) =>
    mutateDb((db) => {
      for (const nb of Object.values(db.notebases)) {
        const col = nb.notebaseColumns.find((c) => c.id === input.notebaseColumnId)
        if (!col) continue
        if (input.data.name !== undefined) col.name = input.data.name
        if (input.data.config !== undefined) col.config = input.data.config
        if (input.data.width !== undefined) col.width = input.data.width
        if (input.data.wrap !== undefined) col.wrap = input.data.wrap
        col.updatedAt = nowIso()
        nb.updatedAt = col.updatedAt
        return { txid: nextTxid(db) }
      }
      // 遍历完所有笔记库都没找到这一列——契约在这两个过程里只声明了
      // NOTEBASE_COLUMN_NOT_FOUND，用它才是运行时真实存在的构造器
      throw errs(errors).NOTEBASE_COLUMN_NOT_FOUND()
    }),
  ),

  delete: os.notebaseColumn.delete.handler(async ({ input, errors }) =>
    mutateDb((db) => {
      for (const nb of Object.values(db.notebases)) {
        const i = nb.notebaseColumns.findIndex((c) => c.id === input.notebaseColumnId)
        if (i < 0) continue
        nb.notebaseColumns.splice(i, 1)
        nb.notebaseColumns.forEach((c, k) => {
          c.position = k
          c.isPrimary = k === 0
        })
        nb.updatedAt = nowIso()
        return { txid: nextTxid(db) }
      }
      // 遍历完所有笔记库都没找到这一列——契约在这两个过程里只声明了
      // NOTEBASE_COLUMN_NOT_FOUND，用它才是运行时真实存在的构造器
      throw errs(errors).NOTEBASE_COLUMN_NOT_FOUND()
    }),
  ),

  reorder: os.notebaseColumn.reorder.handler(async ({ input, errors }) =>
    mutateDb((db) => {
      const nb = requireNotebase(db, input.notebaseId, errors)
      const byId = new Map(nb.notebaseColumns.map((c) => [c.id, c]))
      const ordered = input.ids
        .map((id) => byId.get(id))
        .filter(Boolean) as typeof nb.notebaseColumns
      for (const c of nb.notebaseColumns) if (!input.ids.includes(c.id)) ordered.push(c)
      ordered.forEach((c, i) => {
        c.position = i
        c.isPrimary = i === 0
      })
      nb.notebaseColumns = ordered
      nb.updatedAt = nowIso()
      return { txid: nextTxid(db) }
    }),
  ),
})

const userRouter = os.user.router({
  ensureTimezone: os.user.ensureTimezone.handler(() => ({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
    // 本地实现不落库，只是把浏览器时区报回去，所以从来没有"写入"这一说
    updated: false,
  })),
  updateTimezone: os.user.updateTimezone.handler(({ input }) => ({
    timezone: input.timezone,
  })),
})

export const localNotebaseRouter = {
  notebase: notebaseRouter,
  notebaseRow: notebaseRowRouter,
  notebaseColumn: notebaseColumnRouter,
  user: userRouter,
}
