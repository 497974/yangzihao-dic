import type { OfflineQueueStore, QueuedWord, QueuedWordOutcome } from "../offline-queue"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  createFileQueueStore,
  createOfflineQueue,
  MAX_ATTEMPTS,
  MAX_QUEUED_WORDS,
} from "../offline-queue"

function memoryStore(initial: QueuedWord[] = []) {
  const state = { words: initial, saves: 0 }
  const store: OfflineQueueStore = {
    load: () => state.words.map((word) => ({ ...word })),
    save: (words) => {
      state.words = words.map((word) => ({ ...word }))
      state.saves += 1
    },
  }
  return { state, store }
}

const word = (text: string, actionId?: string) => ({
  text,
  source: "QQ",
  actionName: "词典",
  ...(actionId ? { actionId } : {}),
})

describe("离线收词队列", () => {
  it("记下来的词马上写进文件", () => {
    const { state, store } = memoryStore()
    const queue = createOfflineQueue(store, () => 42)

    expect(queue.add(word("  obtain "))).toBe("added")

    expect(state.words).toEqual([
      { text: "obtain", source: "QQ", actionName: "词典", addedAt: 42, attempts: 0 },
    ])
  })

  it("同一个动作的同一个词只记一次（不管大小写），不同动作可以各记一次", () => {
    const queue = createOfflineQueue(memoryStore().store)
    queue.add(word("Take off"))

    expect(queue.add(word("take   OFF"))).toBe("already_queued")
    expect(queue.add(word("take off", "action-2"))).toBe("added")
    expect(queue.size()).toBe(2)
  })

  it("清空后文件里也是空的", () => {
    const { state, store } = memoryStore()
    const queue = createOfflineQueue(store)
    queue.add(word("obtain"))

    queue.clear()

    expect(queue.size()).toBe(0)
    expect(state.words).toEqual([])
  })

  it("满了就不再收", () => {
    const queue = createOfflineQueue(memoryStore().store)
    for (let index = 0; index < MAX_QUEUED_WORDS; index++) {
      queue.add(word(`w${index}`))
    }

    expect(queue.add(word("one more"))).toBe("full")
  })

  it("连上后按顺序补查：存好的、本来就有的都从队列里拿掉", async () => {
    const { state, store } = memoryStore()
    const queue = createOfflineQueue(store)
    queue.add(word("obtain"))
    queue.add(word("confront"))
    const processed: string[] = []

    const summary = await queue.drain(async (queued) => {
      processed.push(queued.text)
      return queued.text === "obtain" ? "saved" : "duplicate"
    })

    expect(processed).toEqual(["obtain", "confront"])
    expect(summary).toEqual({ saved: 1, duplicate: 1, dropped: 0, remaining: 0 })
    expect(state.words).toEqual([])
  })

  it("扩展又断了：停下来，剩下的原样留到下次", async () => {
    const queue = createOfflineQueue(memoryStore().store)
    queue.add(word("obtain"))
    queue.add(word("confront"))
    const outcomes: QueuedWordOutcome[] = ["saved", "retry_later"]

    const summary = await queue.drain(async () => outcomes.shift()!)

    expect(summary).toMatchObject({ saved: 1, remaining: 1 })
    expect(queue.list()).toMatchObject([{ text: "confront", attempts: 0 }])
  })

  it("一个词反复失败，到了次数就放弃，不会每次都卡在它身上", async () => {
    const queue = createOfflineQueue(memoryStore().store)
    queue.add(word("broken"))
    queue.add(word("obtain"))

    for (let round = 1; round < MAX_ATTEMPTS; round++) {
      await queue.drain(async (queued) => (queued.text === "broken" ? "failed" : "retry_later"))
    }
    expect(queue.list()[0]).toMatchObject({ text: "broken", attempts: MAX_ATTEMPTS - 1 })

    const summary = await queue.drain(async (queued) =>
      queued.text === "broken" ? "failed" : "saved",
    )
    expect(summary).toEqual({ saved: 1, duplicate: 0, dropped: 1, remaining: 0 })
  })

  it("处理时抛出意外错误，当作这个词失败了一次", async () => {
    const queue = createOfflineQueue(memoryStore().store)
    queue.add(word("obtain"))

    await queue.drain(async () => {
      throw new Error("boom")
    })

    expect(queue.list()).toMatchObject([{ text: "obtain", attempts: 1 }])
  })

  it("正在补查时不会再跑一遍", async () => {
    const queue = createOfflineQueue(memoryStore().store)
    queue.add(word("obtain"))
    let release: () => void = () => {}
    const first = queue.drain(
      () =>
        new Promise<QueuedWordOutcome>((resolve) => {
          release = () => resolve("saved")
        }),
    )

    await expect(queue.drain(async () => "saved")).resolves.toBeNull()
    release()
    await expect(first).resolves.toMatchObject({ saved: 1 })
  })
})

describe("离线收词队列的文件", () => {
  it("存进去再读出来一样；文件坏了当空的；不像样的条目丢掉", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yzh-queue-"))
    const file = path.join(dir, "sub", "offline-queue.json")
    const store = createFileQueueStore(file)
    expect(store.load()).toEqual([])

    const saved: QueuedWord = {
      text: "obtain",
      source: null,
      actionName: "词典",
      addedAt: 1,
      attempts: 0,
    }
    store.save([saved])
    expect(store.load()).toEqual([saved])

    fs.writeFileSync(file, JSON.stringify([saved, { text: "" }, { oops: true }]))
    expect(store.load()).toEqual([saved])

    fs.writeFileSync(file, "{ not json")
    expect(store.load()).toEqual([])
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
