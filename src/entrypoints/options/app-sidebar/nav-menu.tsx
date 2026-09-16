/** 侧边栏菜单的渲染：功能组和设置组共用同一套，菜单长什么样只在 nav-model.ts 里定义 */

import type { NavGroup } from "./nav-model"
import { Icon } from "@iconify/react"
import { Link, useLocation } from "react-router"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/base-ui/sidebar"
import { isEntryActive } from "./nav-model"

export function NavMenuGroup({ group }: { group: NavGroup }) {
  const { pathname } = useLocation()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {group.items.map((entry) => (
            <SidebarMenuItem key={entry.to ?? entry.href}>
              <SidebarMenuButton
                render={
                  entry.to ? (
                    <Link to={entry.to} />
                  ) : (
                    <a href={entry.href} target="_blank" rel="noopener noreferrer" />
                  )
                }
                isActive={isEntryActive(entry, pathname)}
                tooltip={entry.label}
              >
                <Icon icon={entry.icon} />
                <span>{entry.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
