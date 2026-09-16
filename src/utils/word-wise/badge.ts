/**
 * 页面难度角标：右下角一个小浮层，「本页约 94% 的词在你的水平内」。
 * 放在 Shadow DOM 里，网页的样式碰不到它；可以点 × 关掉（只关这一页）。
 */

import type { PageCoverage } from "./coverage"
import { describeCoverage } from "./coverage"

const BADGE_TAG = "yzh-difficulty-badge"

const STYLE = `
:host{all:initial}
.badge{position:fixed;right:16px;bottom:16px;z-index:2147483646;display:flex;align-items:center;gap:10px;
  max-width:340px;padding:9px 10px 9px 14px;border-radius:12px;background:#fff;color:#18181b;
  border:1px solid #e4e4e7;box-shadow:0 6px 24px rgba(0,0,0,.14);
  font:13px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.percent{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.detail{color:#52525b}
.close{margin-left:2px;border:0;background:none;color:#a1a1aa;font-size:16px;line-height:1;
  cursor:pointer;padding:2px 4px;border-radius:6px}
.close:hover{background:#f4f4f5;color:#52525b}
@media (prefers-color-scheme:dark){
  .badge{background:#27272a;color:#fafafa;border-color:#3f3f46}
  .detail{color:#a1a1aa}
  .close:hover{background:#3f3f46;color:#e4e4e7}
}
`

/** 角标上的文字（纯函数，方便测试） */
export function badgeText(coverage: PageCoverage, levelLabel: string) {
  const percent = Math.round(coverage.coverage * 100)
  return {
    percent: `${percent}%`,
    detail:
      `的词在你的水平（${levelLabel}）内 · ${describeCoverage(coverage.coverage)}` +
      (coverage.hardWords > 0 ? ` · 超纲词 ${coverage.hardWords} 个` : ""),
  }
}

/** 显示角标，返回移除函数；再次调用会替换掉旧的 */
export function showDifficultyBadge(
  doc: Document,
  coverage: PageCoverage,
  levelLabel: string,
): () => void {
  doc.querySelector(BADGE_TAG)?.remove()
  const host = doc.createElement(BADGE_TAG)
  const shadow = host.attachShadow({ mode: "open" })
  const style = doc.createElement("style")
  style.textContent = STYLE

  const text = badgeText(coverage, levelLabel)
  const badge = doc.createElement("div")
  badge.className = "badge"
  badge.setAttribute("role", "status")
  const percent = doc.createElement("span")
  percent.className = "percent"
  percent.textContent = text.percent
  const detail = doc.createElement("span")
  detail.className = "detail"
  detail.textContent = text.detail
  const close = doc.createElement("button")
  close.className = "close"
  close.type = "button"
  close.textContent = "×"
  close.setAttribute("aria-label", "关闭本页的难度提示")
  close.addEventListener("click", () => host.remove())
  badge.append(percent, detail, close)

  shadow.append(style, badge)
  doc.documentElement.append(host)
  return () => host.remove()
}
