/**
 * 桌面版存词服务（桌面版方案第 2 步）。
 *
 * 把桌面弹窗里查到的词存进生词本——和网页划词「保存到笔记库」走同一套规则：
 * 同一个内置词典动作、同一份列映射、同一个本地账号。所以桌面存的词和网页存的
 * 一模一样，闪卡、造句练习、学习统计直接可用。
 *
 * 为什么不直接用网页端的 orpcClient：它是经消息把请求交给后台的，这里本身就在后台，
 * 给自己发消息没有接收方。所以直接调用本地生词本的路由。
 *
 * 两种情况：
 * - 词典已经连着一个生词本 → 按列映射写一行
 * - 还没有生词本，或连着的那个已被删除 → 按词典字段新建一个，这个词作为第一行一起写入，
 *   再把连接写回配置（之后网页和桌面都往这个生词本里存）
 */

import type { Config } from "@/types/config/config"
import { call } from "@orpc/server"
import { setLocalConfig } from "@/utils/config/storage"
import { BUILT_IN_DICTIONARY_ACTION_ID } from "@/utils/constants/custom-action"
import { findSelectionToolbarAction } from "@/utils/custom-actions"
import { LOCAL_ACCOUNT } from "@/utils/local-notebase/intercept"
import { localNotebaseRouter } from "@/utils/local-notebase/router"
import {
  createNotebaseConnectedAccountSnapshot,
  refreshNotebaseConnectionAccountSnapshot,
  sanitizeCustomActionNotebaseConnection,
} from "@/utils/notebase/connection"
import { findDuplicateNotebaseRow } from "@/utils/notebase/duplicate"
import { isORPCNotFoundError } from "@/utils/notebase/errors"
import { buildNotebaseRowCells, validateNotebaseMappings } from "@/utils/notebase/mapping"
import {
  applyCreatedNotebaseConnectionToConfig,
  buildNotebaseCreateInputFromPending,
  createPendingNotebaseSave,
} from "@/utils/notebase/pending-save"
import { ensureInitializedConfig } from "../config"

export interface DesktopSaveResult {
  notebaseId: string
  /** 这次是否顺手新建了生词本（第一次存词，或原来那个被删了） */
  createdNotebase: boolean
  /** 生词本里已经有这个词了，这次没有再加一行 */
  duplicate: boolean
}

export type DesktopSaveErrorCode =
  | "empty_result"
  | "config_unavailable"
  | "mapping_invalid"
  | "action_unavailable"

/** 可以直接展示给用户的错误：message 就是给人看的原因 */
export class DesktopSaveError extends Error {
  constructor(
    readonly code: DesktopSaveErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "DesktopSaveError"
  }
}

interface SaveDeps {
  getConfig: () => Promise<Config | null | undefined>
  setConfig: (config: Config) => Promise<void>
}

const defaultDeps: SaveDeps = {
  getConfig: ensureInitializedConfig,
  setConfig: setLocalConfig,
}

/** 连接指向的生词本已被删除时返回 null，其余错误照常抛出 */
async function getSchemaOrNull(notebaseId: string) {
  try {
    return await call(localNotebaseRouter.notebase.getSchema, { id: notebaseId })
  } catch (error) {
    if (isORPCNotFoundError(error)) {
      return null
    }
    throw error
  }
}

/**
 * @param fields 查词结果，key 是字段名（与 lookupDictionaryForDesktop 返回的 fields 一致）
 * @param actionId 划词工具栏上的哪个动作；不传就是内置词典
 */
export async function saveWordForDesktop(
  fields: Record<string, unknown>,
  deps: SaveDeps = defaultDeps,
  actionId: string = BUILT_IN_DICTIONARY_ACTION_ID,
): Promise<DesktopSaveResult> {
  if (!fields || Object.keys(fields).length === 0) {
    throw new DesktopSaveError("empty_result", "没有可以存的查词结果")
  }

  const config = await deps.getConfig()
  if (!config) {
    throw new DesktopSaveError("config_unavailable", "扩展的配置还没准备好，请稍后再试")
  }

  const action = findSelectionToolbarAction(config.selectionToolbar, actionId)
  if (!action) {
    throw new DesktopSaveError("action_unavailable", "这个动作已经被删掉了，存不了它的结果")
  }
  // 与网页端同一个本地账号：网页登录会话里的用户就是它（见 local-notebase/intercept.ts），
  // 账号一致，两边存的词才不会被判成"别人的生词本"
  const account = createNotebaseConnectedAccountSnapshot(LOCAL_ACCOUNT)
  if (!account) {
    throw new DesktopSaveError("config_unavailable", "本地账号信息缺失")
  }

  const connection = sanitizeCustomActionNotebaseConnection(
    action.notebaseConnection,
    action.outputSchema,
  )

  if (connection) {
    const schema = await getSchemaOrNull(connection.notebaseId)
    if (schema) {
      const actionWithConnection = {
        ...action,
        notebaseConnection: refreshNotebaseConnectionAccountSnapshot(
          connection,
          account,
          schema.name,
        ),
      }
      const validation = validateNotebaseMappings(actionWithConnection, schema)
      if (validation.kind !== "valid") {
        throw new DesktopSaveError(
          "mapping_invalid",
          "生词本的列和词典字段对不上了（可能改过列名或删过列）。请在网页里划词存一次，按提示重新连接生词本",
        )
      }

      const { cells } = buildNotebaseRowCells(actionWithConnection, schema, fields)
      // 同一个词已经存过就不再加一行：生词本里一个词出现两遍，闪卡也会重复出两张
      const notebase = await call(localNotebaseRouter.notebase.get, { id: connection.notebaseId })
      if (findDuplicateNotebaseRow(notebase.notebaseColumns, notebase.notebaseRows, cells)) {
        return { notebaseId: connection.notebaseId, createdNotebase: false, duplicate: true }
      }
      await call(localNotebaseRouter.notebaseRow.create, {
        notebaseId: connection.notebaseId,
        data: { cells },
      })
      return { notebaseId: connection.notebaseId, createdNotebase: false, duplicate: false }
    }
    // 连着的生词本已被删除：落到下面，按第一次存词处理，新建并改连
  }

  // 建库时这个词作为第一行一起写入（notebase.create 的 initialRows），不能再单独存一次
  const pending = createPendingNotebaseSave(action, [fields])
  await call(localNotebaseRouter.notebase.create, buildNotebaseCreateInputFromPending(pending))

  const applied = applyCreatedNotebaseConnectionToConfig(config, pending, {
    connectedAccount: account,
    // 原来的连接已经失效（或本来就没有），直接换成新建的这个
    replaceExistingConnection: true,
  })
  if (applied.status === "valid" && applied.config) {
    await deps.setConfig(applied.config)
  }

  return { notebaseId: pending.notebaseId, createdNotebase: true, duplicate: false }
}
