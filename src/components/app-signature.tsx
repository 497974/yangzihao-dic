/**
 * 侧边栏底部的署名。
 *
 * 只在侧边栏出现一次。原来是一块「本产品完全免费」的标识，挂在每个功能页底部——
 * 同一句宣传语在设置页里反复出现，读起来像广告，也没给用户任何可操作的信息。
 * 产品是不是收费属于安装说明该讲的事，不该占据每一页的版面。
 */

export function AppSignature() {
  return (
    <div className="px-2 pb-1 text-center text-[11px] leading-relaxed text-muted-foreground group-data-[state=collapsed]:hidden">
      <div className="font-medium text-foreground/70">大傻豪学习翻译词典</div>
      <div>由 Yang Zihao 开发</div>
    </div>
  )
}
