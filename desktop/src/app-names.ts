/**
 * 前台程序的可执行文件 → 给人看的名字，比如 QQ.exe → QQ。
 *
 * 查词时会告诉扩展"这段文字来自哪个程序"，弹窗上也显示「来自 QQ」。
 * 故意不用窗口标题：QQ、微信的窗口标题是聊天对象的名字，Word 的是文档名，
 * 这些没必要发给大模型。
 */

const KNOWN_APPS: Record<string, string> = {
  "qq.exe": "QQ",
  "tim.exe": "TIM",
  "weixin.exe": "微信",
  "wechat.exe": "微信",
  "wxwork.exe": "企业微信",
  "dingtalk.exe": "钉钉",
  "feishu.exe": "飞书",
  "lark.exe": "飞书",
  "discord.exe": "Discord",
  "telegram.exe": "Telegram",
  "notepad.exe": "记事本",
  "winword.exe": "Word",
  "excel.exe": "Excel",
  "powerpnt.exe": "PowerPoint",
  "onenote.exe": "OneNote",
  "outlook.exe": "Outlook",
  "wps.exe": "WPS",
  "et.exe": "WPS 表格",
  "wpp.exe": "WPS 演示",
  "acrobat.exe": "Adobe Acrobat",
  "acrord32.exe": "Adobe Acrobat",
  "sumatrapdf.exe": "SumatraPDF",
  "code.exe": "VS Code",
  "chrome.exe": "Chrome",
  "msedge.exe": "Edge",
  "firefox.exe": "Firefox",
}

export function friendlyAppName(exePath: string | null | undefined): string | null {
  if (!exePath) {
    return null
  }
  const fileName = exePath.split(/[\\/]/).pop() ?? ""
  if (!fileName) {
    return null
  }
  return KNOWN_APPS[fileName.toLowerCase()] ?? fileName.replace(/\.exe$/i, "")
}
