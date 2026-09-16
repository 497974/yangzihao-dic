/** 编译后把弹窗页面的 HTML、CSS 复制到 dist/popup（tsc 只管 .ts） */

const fs = require("node:fs")
const path = require("node:path")

const from = path.join(__dirname, "..", "src", "popup")
const to = path.join(__dirname, "..", "dist", "popup")
fs.mkdirSync(to, { recursive: true })
for (const file of fs.readdirSync(from)) {
  if (file.endsWith(".html") || file.endsWith(".css")) {
    fs.copyFileSync(path.join(from, file), path.join(to, file))
  }
}
