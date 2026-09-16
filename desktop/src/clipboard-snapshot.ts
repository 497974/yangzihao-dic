/**
 * 取词前把剪贴板整份存下来，取完原样放回去。
 *
 * 用 Electron 的 clipboard.read()：它按格式（MIME 类型）把剪贴板里的每一份数据都读出来，
 * 文字、HTML、RTF、图片都在里面；放回去时一次写回，系统保证是整体替换。
 * 个别程序的私有格式（比如 QQ 里复制的整条消息）不一定读得到，那种情况会退化成其中的文字/图片。
 */

import type { ClipboardBookmark } from "electron"
import { clipboard, ClipboardItem } from "electron"

type Payload = Blob | ClipboardBookmark

export interface ClipboardSnapshot {
  /** 每个剪贴板条目：MIME 类型 → 数据 */
  items: Array<Record<string, Payload>>
}

export async function snapshotClipboard(): Promise<ClipboardSnapshot> {
  const items: ClipboardSnapshot["items"] = []
  for (const item of await clipboard.read()) {
    const record: Record<string, Payload> = {}
    for (const type of item.types) {
      try {
        record[type] = await item.getType(type)
      } catch {
        // 这一种格式读不出来就跳过，其余的照样保留
      }
    }
    if (Object.keys(record).length > 0) {
      items.push(record)
    }
  }
  return { items }
}

export async function restoreClipboard(snapshot: ClipboardSnapshot): Promise<void> {
  if (snapshot.items.length === 0) {
    clipboard.clear()
    return
  }
  await clipboard.write(snapshot.items.map((record) => new ClipboardItem(record)))
}
