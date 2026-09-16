/** 侧边栏最上面的「设置」组：供应商、偏好、快捷键，内容见 nav-model.ts */

import { NavMenuGroup } from "./nav-menu"
import { buildSettingsNavGroup } from "./nav-model"

export function SettingsNav() {
  return <NavMenuGroup group={buildSettingsNavGroup()} />
}
