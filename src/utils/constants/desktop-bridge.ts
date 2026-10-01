/**
 * 桌面版连接桥的共享常量（见项目根目录的 桌面版方案.md）。
 *
 * 桌面程序做本机 WebSocket 服务端，扩展后台做客户端连过去。
 * 端口、路径、协议版本两边必须一致，改这里时桌面程序那边也要同步改。
 */

/** 桌面程序监听的本机端口 */
export const DESKTOP_BRIDGE_PORT = 47813

/** 只连 127.0.0.1：外网连不进来，也不会走到代理上 */
export const DESKTOP_BRIDGE_URL = `ws://127.0.0.1:${DESKTOP_BRIDGE_PORT}/yangzihao-dic`

/** 通信协议版本，握手时告诉桌面程序；协议有不兼容的改动时加一 */
export const DESKTOP_BRIDGE_PROTOCOL_VERSION = 1

/** 握手时自报家门，桌面程序据此确认连上来的是本扩展 */
export const DESKTOP_BRIDGE_CLIENT_ID = "yangzihao-dic-extension"

/**
 * 扩展能办的事，握手时告诉桌面程序。新加一种请求就在这里加一项、协议版本不用动：
 * 桌面程序看到扩展没有某一项，就提示用户更新扩展，而不是发过去干等。
 */
export const DESKTOP_BRIDGE_FEATURES = [
  "lookup",
  "lookupProgress",
  "save",
  "translate",
  // 划词工具栏：查询按钮、划词翻译（translate 的 selection 模式）、任意动作的查词和存词
  "toolbar",
  "selectionTranslate",
  "customActions",
  // 按扩展的朗读设置合成语音，桌面版和网页同一个声音
  "speak",
  // 复习提醒：今天有几个词该复习、打开闪卡复习页
  "reviewStatus",
  // 每日必学：目标没完成时桌面版锁屏答题，题目和判分由扩展出
  "dailyGoal",
] as const

/**
 * 用户是否开启了「连接桌面版」，默认关闭。
 *
 * 为什么默认关：没装桌面程序的人，扩展每次尝试连接失败，浏览器都会在扩展的控制台里
 * 记一条连接错误，chrome://extensions 上可能因此冒出红色的「错误」按钮，
 * 朋友们会以为扩展坏了。装了桌面版的人打开一次开关即可。
 *
 * 不放进 Config：这是个与翻译配置无关的开关，单独一个键就不用做配置迁移。
 */
export const DESKTOP_BRIDGE_ENABLED_KEY = "local:desktopBridgeEnabled" as const

/** 当前连接状态，设置页订阅它显示「已连接 / 未连接」；浏览器关掉就清空，本来也该清空 */
export const DESKTOP_BRIDGE_STATUS_KEY = "session:desktopBridgeStatus" as const

/** 唤醒定时器：后台被系统休眠后，靠它每分钟拉起一次并重连 */
export const DESKTOP_BRIDGE_ALARM = "desktop-bridge-reconnect"

export interface DesktopBridgeStatus {
  connected: boolean
  /** 最近一次连上的时间（毫秒时间戳），从没连上过为 null */
  lastConnectedAt: number | null
}
