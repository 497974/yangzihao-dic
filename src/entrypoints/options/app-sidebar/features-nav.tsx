/** 侧边栏的功能菜单：学习 / 阅读与翻译 / 取词工具三组，内容见 nav-model.ts */

import { NavMenuGroup } from "./nav-menu"
import { buildFeatureNavGroups } from "./nav-model"

export function FeaturesNav() {
  return (
    <>
      {buildFeatureNavGroups().map((group) => (
        <NavMenuGroup key={group.label} group={group} />
      ))}
    </>
  )
}
