/**
 * 笔记库页
 *
 * 上游把笔记库放在官网，本项目的数据完全存在 chrome.storage 里，没有服务器。
 * 之前"打开笔记库"指向 WXT_API_URL（本机临时起的服务器），分发给别人时对方
 * 机器上根本没有那个服务，点了只会连接失败，而且那个地址读的是另一份数据，
 * 会出现"明明保存成功了却看不到新词"的假象 —— 所以改为扩展自带的页面。
 *
 * 视觉沿用原来那个本地生词本网页的样式（暖色调 + 置顶表头 + 导出按钮）。
 * CSS 变量一律加 `nb-` 前缀并限定在 .nb-root 内，避免和设置页自己的主题变量打架。
 */

import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { useParams } from "react-router"
import { cellToText } from "@/utils/notebase/cell-text"
import { orpcClient } from "@/utils/orpc/client"

const STYLES = `
.nb-root{
  --nb-bg:#faf9f7; --nb-panel:#fff; --nb-border:#e6e2dc; --nb-text:#1f1d1a;
  --nb-muted:#7c766c; --nb-accent:#b8934a; --nb-accent-soft:#f5efe1;
  background:var(--nb-bg); color:var(--nb-text); min-height:100%;
  font:15px/1.6 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
}
@media (prefers-color-scheme:dark){
  .nb-root{
    --nb-bg:#171614; --nb-panel:#201e1b; --nb-border:#33302b; --nb-text:#ece8e1;
    --nb-muted:#9a938a; --nb-accent:#d4ae63; --nb-accent-soft:#2c2620;
  }
}
.nb-root *{box-sizing:border-box}
.nb-header{padding:22px 28px;border-bottom:1px solid var(--nb-border);display:flex;
  align-items:baseline;gap:16px;flex-wrap:wrap;background:var(--nb-panel)}
.nb-header h1{margin:0;font-size:20px;font-weight:650;letter-spacing:.01em}
.nb-stat{color:var(--nb-muted);font-size:13px}
.nb-stat b{color:var(--nb-accent);font-variant-numeric:tabular-nums}
.nb-main{padding:22px 28px}
.nb-bar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap}
.nb-search{flex:1;min-width:220px;padding:9px 13px;border:1px solid var(--nb-border);
  border-radius:8px;background:var(--nb-panel);color:var(--nb-text);font-size:14px}
.nb-search:focus{outline:2px solid var(--nb-accent);outline-offset:-1px;border-color:transparent}
.nb-btn{padding:9px 15px;border:1px solid var(--nb-border);border-radius:8px;
  background:var(--nb-panel);color:var(--nb-text);cursor:pointer;font-size:14px}
.nb-btn:hover{border-color:var(--nb-accent);color:var(--nb-accent)}
.nb-btn:disabled{opacity:.5;cursor:default}
.nb-btn.nb-primary{background:var(--nb-accent);color:#fff;border-color:var(--nb-accent)}
.nb-btn.nb-primary:hover{opacity:.9;color:#fff}
.nb-wrap{overflow-x:auto;border:1px solid var(--nb-border);border-radius:10px;background:var(--nb-panel)}
.nb-table{border-collapse:collapse;width:100%;font-size:14px}
.nb-table th,.nb-table td{padding:10px 13px;text-align:left;
  border-bottom:1px solid var(--nb-border);vertical-align:top;max-width:290px}
.nb-table th{background:var(--nb-accent-soft);font-weight:600;font-size:12px;letter-spacing:.04em;
  text-transform:uppercase;color:var(--nb-muted);position:sticky;top:0;white-space:nowrap}
.nb-table tr:last-child td{border-bottom:none}
.nb-table tr:hover td{background:var(--nb-accent-soft)}
.nb-table td:first-child{font-weight:600;white-space:nowrap}
.nb-empty{padding:70px 20px;text-align:center;color:var(--nb-muted)}
.nb-dot{display:inline-block;width:8px;height:8px;border-radius:50%;
  background:#4a9d5f;margin-right:6px;vertical-align:middle}
`

interface Column {
  id: string
  name: string
  position: number
}
interface Row {
  id: string
  cells?: Record<string, unknown>
  position: number
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function toCsvCell(value: unknown): string {
  return `"${cellToText(value).replace(/"/g, '""')}"`
}

export function NotebasePage() {
  const { notebaseId: routeId } = useParams<{ notebaseId?: string }>()
  const [keyword, setKeyword] = useState("")

  const { data: notebases, isPending: notebasesPending } = useQuery({
    queryKey: ["local-notebases"],
    queryFn: () => orpcClient.notebase.list({}),
  })

  // 深链带 id 就用它；从侧边栏进来就取第一个（本地版通常只有一个库）
  const notebaseId = routeId ?? notebases?.[0]?.id

  const {
    data: notebase,
    isPending: detailPending,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["local-notebase-detail", notebaseId],
    queryFn: () => orpcClient.notebase.get({ id: notebaseId! }),
    enabled: !!notebaseId,
  })

  /**
   * react-query v5 里 `enabled: false` 的查询 isPending 恒为 true。新装机的用户
   * 还没有笔记库，详情查询被禁用 —— 直接用它当加载态，页面会永远停在"加载中…"，
   * 连"怎么添加第一个词"的引导都看不到。没有笔记库时不算加载中。
   */
  const isPending = notebasesPending || (!!notebaseId && detailPending)

  const columns = useMemo(
    () =>
      [...((notebase?.notebaseColumns ?? []) as Column[])].sort((a, b) => a.position - b.position),
    [notebase],
  )

  const rows = useMemo(
    () => [...((notebase?.notebaseRows ?? []) as Row[])].sort((a, b) => a.position - b.position),
    [notebase],
  )

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return rows
    return rows.filter((row) =>
      Object.values(row.cells ?? {}).some((v) => cellToText(v).toLowerCase().includes(kw)),
    )
  }, [rows, keyword])

  const exportCsv = () => {
    const header = columns.map((c) => toCsvCell(c.name)).join(",")
    const body = rows
      .map((r) => columns.map((c) => toCsvCell(r.cells?.[c.id])).join(","))
      .join("\n")
    // 带 BOM，Excel 打开中文才不乱码
    download("生词本.csv", `﻿${header}\n${body}`, "text/csv")
  }

  const exportJson = () => {
    download("生词本.json", JSON.stringify(notebase ?? {}, null, 2), "application/json")
  }

  return (
    <div className="nb-root">
      <style>{STYLES}</style>

      <header className="nb-header">
        <h1>本地生词本</h1>
        <span className="nb-stat">
          <span className="nb-dot" />
          存在本机 · 无需联网
        </span>
        <span className="nb-stat">
          {notebase ? `${notebase.name} · ${rows.length} 条（无上限）` : ""}
        </span>
      </header>

      <main className="nb-main">
        <div className="nb-bar">
          <input
            type="search"
            className="nb-search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索词条、释义、例句…"
          />
          <button type="button" className="nb-btn" onClick={exportCsv} disabled={!rows.length}>
            导出 CSV
          </button>
          <button type="button" className="nb-btn" onClick={exportJson} disabled={!notebase}>
            导出 JSON
          </button>
          <button
            type="button"
            className="nb-btn nb-primary"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? "刷新中…" : "刷新"}
          </button>
        </div>

        {isPending ? (
          <div className="nb-empty">加载中…</div>
        ) : !notebase ? (
          <div className="nb-empty">
            还没有笔记库。
            <br />
            <br />
            在网页上划词 → 词典 → <b>保存到笔记库</b>，第一个生词会自动为你建好。
          </div>
        ) : (
          <>
            <div className="nb-wrap">
              <table className="nb-table">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c.id}>{c.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      {columns.map((c) => (
                        <td key={c.id}>{cellToText(r.cells?.[c.id])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filtered.length === 0 && (
              <div className="nb-empty">
                {rows.length === 0 ? (
                  <>
                    还没有笔记。
                    <br />
                    <br />
                    在网页上划词 → 词典 → <b>保存到笔记库</b>，就会写到这里。
                  </>
                ) : (
                  `没有匹配「${keyword.trim()}」的记录`
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
