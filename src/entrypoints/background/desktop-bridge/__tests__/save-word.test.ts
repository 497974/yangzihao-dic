import type { Config } from "@/types/config/config"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { storage } from "#imports"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { getBuiltInDictionaryAction } from "@/utils/custom-actions"
import { readDb } from "@/utils/local-notebase/storage"

// 默认依赖里的 ensureInitializedConfig 会拉起整套配置初始化；这里用注入的配置代替
vi.mock("../../config", () => ({
  ensureInitializedConfig: vi.fn<(...args: any[]) => any>(),
}))

const { DesktopSaveError, saveWordForDesktop } = await import("../save-word")

/** 模拟一次查词结果：key 是词典字段名，与查词服务返回的 fields 一致 */
function lookupResultFor(term: string): Record<string, unknown> {
  const action = getBuiltInDictionaryAction(DEFAULT_CONFIG.selectionToolbar)
  return Object.fromEntries(
    action.outputSchema.map((field) => [field.name, `${term}·${field.name}`]),
  )
}

function createDeps(initial: Config) {
  const state = { config: structuredClone(initial) }
  const setConfig = vi.fn<(config: Config) => Promise<void>>(async (config) => {
    state.config = config
  })
  return {
    state,
    setConfig,
    deps: { getConfig: async () => state.config, setConfig },
  }
}

function dictionaryConnectionOf(config: Config) {
  return getBuiltInDictionaryAction(config.selectionToolbar).notebaseConnection
}

describe("桌面版存词服务", () => {
  beforeEach(async () => {
    await storage.removeItem("local:localNotebaseDb")
    await storage.removeItem("local:localSrsDb")
  })

  it("第一次存词：新建生词本，这个词是第一行，并把连接写回配置", async () => {
    const { state, deps, setConfig } = createDeps(DEFAULT_CONFIG)

    const result = await saveWordForDesktop(lookupResultFor("obtain"), deps)

    expect(result.createdNotebase).toBe(true)
    const nb = (await readDb()).notebases[result.notebaseId]!
    expect(nb.notebaseRows).toHaveLength(1)
    expect(Object.values(nb.notebaseRows[0]!.cells)).toContain(
      "obtain·" + nb.notebaseColumns[0]!.name,
    )
    // 连接写回了配置：之后网页和桌面都往这个生词本里存
    expect(setConfig).toHaveBeenCalledTimes(1)
    expect(dictionaryConnectionOf(state.config)?.notebaseId).toBe(result.notebaseId)
  })

  it("建出来的列就是词典的字段，和网页端首次存词完全一样", async () => {
    const { deps } = createDeps(DEFAULT_CONFIG)

    const result = await saveWordForDesktop(lookupResultFor("obtain"), deps)

    const nb = (await readDb()).notebases[result.notebaseId]!
    const fieldNames = getBuiltInDictionaryAction(DEFAULT_CONFIG.selectionToolbar).outputSchema.map(
      (field) => field.name,
    )
    expect(nb.notebaseColumns.map((column) => column.name)).toEqual(fieldNames)
  })

  it("已连着生词本：往里追加一行，不再新建", async () => {
    const { state, deps } = createDeps(DEFAULT_CONFIG)
    const first = await saveWordForDesktop(lookupResultFor("obtain"), deps)

    const second = await saveWordForDesktop(lookupResultFor("confront"), deps)

    expect(second).toEqual({
      notebaseId: first.notebaseId,
      createdNotebase: false,
      duplicate: false,
    })
    const db = await readDb()
    expect(Object.keys(db.notebases)).toHaveLength(1)
    const rows = db.notebases[first.notebaseId]!.notebaseRows
    expect(rows).toHaveLength(2)
    expect(JSON.stringify(rows[1]!.cells)).toContain("confront")
    expect(dictionaryConnectionOf(state.config)?.notebaseId).toBe(first.notebaseId)
  })

  it("同一个词再存一次：不加新行，告诉桌面已经在生词本里了", async () => {
    const { deps } = createDeps(DEFAULT_CONFIG)
    const first = await saveWordForDesktop(lookupResultFor("obtain"), deps)

    const again = await saveWordForDesktop(lookupResultFor("obtain"), deps)

    expect(again).toEqual({ notebaseId: first.notebaseId, createdNotebase: false, duplicate: true })
    expect((await readDb()).notebases[first.notebaseId]!.notebaseRows).toHaveLength(1)
  })

  it("连着的生词本被删了：重新建一个并改连，而不是报错", async () => {
    const { state, deps } = createDeps(DEFAULT_CONFIG)
    const first = await saveWordForDesktop(lookupResultFor("obtain"), deps)
    await storage.removeItem("local:localNotebaseDb")

    const second = await saveWordForDesktop(lookupResultFor("confront"), deps)

    expect(second.createdNotebase).toBe(true)
    expect(second.notebaseId).not.toBe(first.notebaseId)
    expect(dictionaryConnectionOf(state.config)?.notebaseId).toBe(second.notebaseId)
  })

  it("没有查词结果时报出原因", async () => {
    const { deps } = createDeps(DEFAULT_CONFIG)

    await expect(saveWordForDesktop({}, deps)).rejects.toBeInstanceOf(DesktopSaveError)
    await expect(saveWordForDesktop({}, deps)).rejects.toMatchObject({ code: "empty_result" })
  })
})
