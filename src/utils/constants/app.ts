import { browser } from "#imports"

// 本项目的内部标识名。用于生成自定义元素名、CSS 类前缀、导出文件名等。
// 必须以字母开头 —— 自定义元素名和 CSS 类名不允许数字打头。
// 界面上的显示名在 locales 的 extName 里，与此处无关。
export const APP_NAME = "YangZihao Dic"
const manifest = browser.runtime.getManifest()
export const EXTENSION_VERSION = manifest.version
