/**
 * 把连接桥接到真实环境：浏览器的 WebSocket、后台的查词存词服务、存储和唤醒定时器。
 *
 * 在后台入口里调用一次。监听器都在第一个同步回合里注册完，
 * 这样后台被定时器唤醒时事件不会丢。
 */

import type { BridgeSocket } from "./bridge"
import type { DesktopBridgeStatus } from "@/utils/constants/desktop-bridge"
import { browser, storage } from "#imports"
import { EXTENSION_VERSION } from "@/utils/constants/app"
import {
  DESKTOP_BRIDGE_ALARM,
  DESKTOP_BRIDGE_ENABLED_KEY,
  DESKTOP_BRIDGE_STATUS_KEY,
  DESKTOP_BRIDGE_URL,
} from "@/utils/constants/desktop-bridge"
import { createDesktopBridge } from "./bridge"
import { handleDailyGoal } from "./daily-goal"
import { lookupDictionaryForDesktop } from "./dictionary-lookup"
import { translateInputForDesktop } from "./input-translate"
import { getReviewStatusForDesktop, openReviewPageForDesktop } from "./review-status"
import { saveWordForDesktop } from "./save-word"
import { translateSelectionForDesktop } from "./selection-translate"
import { speakForDesktop } from "./speak"
import { getToolbarForDesktop } from "./toolbar"

/** 浏览器 WebSocket → 连接桥需要的最小接口 */
function createWebSocketAdapter(url: string): BridgeSocket {
  const ws = new WebSocket(url)
  const adapter: BridgeSocket = {
    get readyState() {
      return ws.readyState
    },
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
  }
  ws.addEventListener("open", () => adapter.onopen?.())
  ws.addEventListener("message", (event) => adapter.onmessage?.(event.data))
  // 连接失败时浏览器会先后触发 error 和 close，只在 close 里处理一次就够了
  ws.addEventListener("close", () => adapter.onclose?.())
  return adapter
}

export function setUpDesktopBridge(): void {
  const bridge = createDesktopBridge({
    url: DESKTOP_BRIDGE_URL,
    version: EXTENSION_VERSION,
    createSocket: createWebSocketAdapter,
    lookup: (request, options) => lookupDictionaryForDesktop(request, options),
    save: (fields, actionId) => saveWordForDesktop(fields, undefined, actionId),
    translate: (request) => translateInputForDesktop(request),
    translateSelection: (request, options) => translateSelectionForDesktop(request, options),
    getToolbar: () => getToolbarForDesktop(),
    speak: (request) => speakForDesktop(request),
    reviewStatus: () => getReviewStatusForDesktop(),
    openReview: () => openReviewPageForDesktop(),
    dailyGoal: (request) => handleDailyGoal(request),
    setStatus: (status: DesktopBridgeStatus) => {
      void storage.setItem(DESKTOP_BRIDGE_STATUS_KEY, status)
    },
    now: () => Date.now(),
  })

  const applyEnabled = (enabled: boolean | null) => {
    if (enabled) {
      bridge.start()
    } else {
      bridge.stop()
    }
  }
  void storage.getItem<boolean>(DESKTOP_BRIDGE_ENABLED_KEY).then(applyEnabled)
  // 设置页里拨动开关立刻生效，不用重启浏览器
  storage.watch<boolean>(DESKTOP_BRIDGE_ENABLED_KEY, applyEnabled)

  void browser.alarms.get(DESKTOP_BRIDGE_ALARM).then((existing) => {
    if (!existing) {
      void browser.alarms.create(DESKTOP_BRIDGE_ALARM, { periodInMinutes: 1 })
    }
  })
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === DESKTOP_BRIDGE_ALARM) {
      bridge.ensureConnected()
    }
  })
}
