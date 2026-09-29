/**
 * 桌面版设置页（桌面版方案第 3 步）。
 *
 * 一个开关决定扩展要不要去连本机的桌面程序，外加实时的连接状态。
 * 开关默认关：没装桌面程序的人，扩展每次连接失败都会在控制台留一条错误，
 * 看起来像扩展坏了（详见 utils/constants/desktop-bridge.ts）。
 */

import type { DesktopBridgeStatus } from "@/utils/constants/desktop-bridge"
import { useEffect, useState } from "react"
import { storage } from "#imports"
import { Switch } from "@/components/ui/base-ui/switch"
import { PageLayout } from "@/entrypoints/options/components/page-layout"
import {
  DESKTOP_BRIDGE_ENABLED_KEY,
  DESKTOP_BRIDGE_PORT,
  DESKTOP_BRIDGE_STATUS_KEY,
} from "@/utils/constants/desktop-bridge"
import { ConfigItem } from "../../components/config-item"

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function StatusCard({ enabled, status }: { enabled: boolean; status: DesktopBridgeStatus | null }) {
  const connected = enabled && !!status?.connected

  let dotClass = "bg-muted-foreground/40"
  let title = "未开启"
  let detail = "打开上面的开关后，扩展才会去连接桌面程序。"

  if (connected) {
    dotClass = "bg-emerald-500"
    title = "已连接"
    detail = "在 QQ、微信、Word 里选中文字按快捷键，就能查词、存进这里的生词本。"
  } else if (enabled) {
    dotClass = "bg-amber-500"
    title = "正在等待桌面程序"
    detail =
      "请确认大傻豪词典桌面程序已经在运行（屏幕右下角的托盘里能看到它的图标）。" +
      "程序一打开，这里会自动连上，不用刷新。"
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className={`inline-block size-2.5 rounded-full ${dotClass}`} aria-hidden />
        <span>{title}</span>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">{detail}</p>
      {status?.lastConnectedAt ? (
        <p className="mt-2 text-xs text-muted-foreground">
          最近一次连上：{formatTime(status.lastConnectedAt)}
        </p>
      ) : null}
    </div>
  )
}

export function DesktopPage() {
  // null = 还在读取，避免开关先闪成"关"再跳到"开"
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [status, setStatus] = useState<DesktopBridgeStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void storage.getItem<boolean>(DESKTOP_BRIDGE_ENABLED_KEY).then((value) => {
      if (!cancelled) setEnabled(value ?? false)
    })
    void storage.getItem<DesktopBridgeStatus>(DESKTOP_BRIDGE_STATUS_KEY).then((value) => {
      if (!cancelled) setStatus(value)
    })
    // 连接状态由后台写入，这里订阅着，桌面程序一开一关页面立刻跟着变
    const unwatch = storage.watch<DesktopBridgeStatus>(DESKTOP_BRIDGE_STATUS_KEY, (value) => {
      setStatus(value)
    })
    return () => {
      cancelled = true
      unwatch()
    }
  }, [])

  const handleToggle = (checked: boolean) => {
    setEnabled(checked)
    void storage.setItem(DESKTOP_BRIDGE_ENABLED_KEY, checked)
  }

  return (
    <PageLayout
      title="桌面版"
      description="在 QQ、微信、Word 等任何程序里选中文字就能查词，存进同一个生词本"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <ConfigItem
          id="desktop-bridge-enabled"
          title="连接桌面版"
          description="装了大傻豪词典桌面程序再打开。没装的话请保持关闭。"
        >
          <Switch
            checked={enabled ?? false}
            disabled={enabled === null}
            onCheckedChange={handleToggle}
          />
        </ConfigItem>

        <StatusCard enabled={enabled ?? false} status={status} />

        {/* 快捷键单独列出来：桌面版没有主窗口，功能全靠快捷键和托盘菜单，不写在这里就没人知道 */}
        <section className="rounded-xl border bg-card p-4 text-sm leading-relaxed">
          <h3 className="mb-3 font-medium">常用操作</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                Ctrl+Alt+S
              </kbd>
            </dt>
            <dd className="text-muted-foreground">
              <span className="font-medium text-foreground">截图识别翻译</span>
              ：框选屏幕上复制不出来的字（图片、游戏画面、扫描版 PDF、视频字幕），
              认出一个词就查词典，一句话就翻译。也可以右键托盘图标，点菜单最上面的「截图识别翻译」
            </dd>
            <dt>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                Ctrl+Alt+D
              </kbd>
            </dt>
            <dd className="text-muted-foreground">
              <span className="font-medium text-foreground">查词</span>
              ：在任何程序里选中文字后按，直接查词典
            </dd>
            <dt>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                Ctrl+Alt+T
              </kbd>
            </dt>
            <dd className="text-muted-foreground">
              <span className="font-medium text-foreground">弹出划词工具栏</span>
              ：选中大段文字后按，旁边弹出翻译、朗读、词典等按钮。 自动弹出只认得拖动和双击三击，用
              Shift+点击、Ctrl+A 或者拖到一半页面自动滚动时可能不弹，按这个键一定弹
            </dd>
            <dt>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">空格 ×3</kbd>
            </dt>
            <dd className="text-muted-foreground">
              <span className="font-medium text-foreground">输入翻译</span>
              ：在 QQ、微信等输入框里打完字连按三下空格，翻译并替换
            </dd>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            快捷键被其他程序占用时，会自动改用加上 Shift 的组合（如 Ctrl+Shift+Alt+S），
            右键托盘图标可以看到实际生效的快捷键。
          </p>
        </section>

        <section className="rounded-xl border bg-card p-4 text-sm leading-relaxed">
          <h3 className="mb-2 font-medium">它是怎么工作的</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              桌面程序负责取词和弹窗；查词、存词都交给这个扩展做——用的是你在这里配好的 API Key
              和词典设置，存进的也是同一个生词本，闪卡、造句练习直接能用。
            </li>
            <li>
              两者只在本机通信（127.0.0.1:{DESKTOP_BRIDGE_PORT}
              ），不经过任何服务器，外网也连不进来。
            </li>
            <li>
              在 QQ、微信等浏览器以外的地方打完字，连按三下空格，会按「输入翻译」的设置翻译并替换
              （源语言为自动时译成英语）；浏览器里照旧由扩展自己翻。
            </li>
            <li>
              在浏览器以外的地方选中文字，旁边会弹出和这里一样的划词工具栏（翻译、朗读、词典等），
              按钮跟着「划词工具栏」的设置走。
            </li>
            <li>
              浏览器没开时查的词会先记在桌面版里，打开浏览器、连上之后自动查好存进生词本；
              翻译、朗读还是要浏览器开着。
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          桌面程序在「大傻豪词典-发给朋友」安装包里：双击「一键安装」会装好并启动，
          然后回到这里打开上面的「连接桌面版」开关。
        </section>
      </div>
    </PageLayout>
  )
}
