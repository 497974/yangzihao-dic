/**
 * 「本产品完全免费 · 由 Yang Zihao 开发」标识。
 *
 * 抽成组件而不是各处手写，是为了改一次全站同步 —— 侧边栏、复习页、造句练习页
 * 都挂了这块。variant 只影响排版密度，文案始终一致。
 */

export function FreeProductBadge({ variant = "inline" }: { variant?: "inline" | "sidebar" }) {
  if (variant === "sidebar") {
    return (
      <div className="px-2 pb-1 text-center text-[11px] leading-relaxed text-muted-foreground group-data-[state=collapsed]:hidden">
        <div className="font-medium text-foreground/70">本产品完全免费</div>
        <div>由 Yang Zihao 开发</div>
      </div>
    )
  }

  return (
    <div className="text-center text-xs text-muted-foreground">
      本产品<span className="font-medium text-foreground/70">完全免费</span> · 由 Yang Zihao 开发
    </div>
  )
}
