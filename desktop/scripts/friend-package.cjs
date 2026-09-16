/**
 * 生成发给朋友的安装包，放在桌面：
 *   桌面\大傻豪词典-发给朋友\       解压好的样子（自己也可以直接双击里面的「一键安装」）
 *   桌面\大傻豪词典-发给朋友.zip    发给别人的压缩包
 *
 * 用之前先把两样东西打好：
 *   1. 仓库根目录 pnpm build           → .output/chrome-mv3（浏览器扩展）
 *   2. desktop 目录 npm run package    → desktop/release/大傻豪词典桌面版（桌面版）
 * 这里只负责组装：一键安装脚本、说明书网页、扩展、桌面版；扫一遍有没有夹带 API Key；再打压缩包。
 *
 * 桌面版不是整个文件夹放进去，而是压成 desktop-app.tar.xz（安装时由 install.ps1 解开）：
 * Electron 有 320 MB，zip 用的 deflate 压不动它，xz 能压到 100 MB 左右——
 * 发给朋友的压缩包因此小了三分之一。
 *
 * 用法：desktop 目录 npm run friend-package
 */

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFileSync } = require("node:child_process")

const desktopProject = path.join(__dirname, "..")
const repo = path.join(desktopProject, "..")
const installerDir = path.join(desktopProject, "installer")
const extensionBuild = path.join(repo, ".output", "chrome-mv3")
const desktopBuild = path.join(desktopProject, "release", "大傻豪词典桌面版")
const desktopReleaseDir = path.dirname(desktopBuild)
/** 归档名和归档里的顶层目录名都用纯英文，见 packDesktop */
const DESKTOP_ARCHIVE = "desktop-app.tar.xz"
const DESKTOP_ARCHIVE_ROOT = "desktop-app"
/** 非 ASCII 字符：中文文件名压进 tar 会乱码，见 packDesktop */
const NON_ASCII = /[^ -~]/
const userDesktop = path.join(os.homedir(), "Desktop")
const PACKAGE_NAME = "大傻豪词典-发给朋友"
const outDir = path.join(userDesktop, PACKAGE_NAME)
const zipPath = path.join(userDesktop, `${PACKAGE_NAME}.zip`)

const BOM = "﻿"
const crlf = (text) => text.replace(/\r?\n/g, "\r\n")

/** 发出去之前必须查的：明文 API Key、从浏览器拷出来的存储备份（见发版流程） */
const KEY_PATTERN = /sk-[A-Za-z0-9]{20,}/
const TEXT_EXTENSIONS = new Set([
  ".js",
  ".json",
  ".html",
  ".css",
  ".txt",
  ".md",
  ".ps1",
  ".cmd",
  ".yml",
  ".map",
  "",
])

function fail(message) {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      visit(full, true)
      walk(full, visit)
    } else {
      visit(full, false)
    }
  }
}

function folderSizeMb(dir) {
  let total = 0
  walk(dir, (file, isDir) => {
    if (!isDir) total += fs.statSync(file).size
  })
  return (total / 1024 / 1024).toFixed(1)
}

async function buildManualHtml(version) {
  const { marked } = await import("marked")
  const markdown = fs.readFileSync(path.join(repo, "安装与使用说明书.md"), "utf8")
  const body = marked.parse(markdown)
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>大傻豪学习翻译词典 · 安装与使用说明书</title>
<style>
:root{--bg:#fdfdfc;--fg:#26262b;--muted:#6b6b76;--line:#e6e6e2;--accent:#2f6f4e;--code:#f4f4f1}
*{box-sizing:border-box}
body{margin:0;padding:0;background:var(--bg);color:var(--fg);
 font:16px/1.85 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:56px 24px 96px}
h1{font-size:1.9rem;line-height:1.35;margin:0 0 .6em;letter-spacing:-.01em}
h2{font-size:1.32rem;margin:2.4em 0 .7em;padding-bottom:.35em;border-bottom:2px solid var(--line)}
h3{font-size:1.08rem;margin:1.8em 0 .5em;color:var(--accent)}
h4{font-size:1rem;margin:1.4em 0 .4em}
p{margin:.75em 0}
ul,ol{margin:.7em 0;padding-left:1.5em}li{margin:.35em 0}
code{background:var(--code);padding:.15em .42em;border-radius:4px;
 font:.88em/1.5 ui-monospace,"Cascadia Code",Consolas,monospace;word-break:break-all}
pre{background:var(--code);padding:14px 16px;border-radius:8px;overflow-x:auto;border:1px solid var(--line)}
pre code{background:none;padding:0;font-size:.9rem}
kbd{border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;padding:0 .35em;font-size:.85em;background:var(--code)}
blockquote{margin:1.1em 0;padding:.8em 1.1em;background:#f6f8f6;
 border-left:4px solid var(--accent);border-radius:0 6px 6px 0;color:#3c3c44}
table{border-collapse:collapse;width:100%;margin:1.1em 0;font-size:.94rem;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:9px 12px;text-align:left;vertical-align:top}
th{background:#f4f4f1;font-weight:600;white-space:nowrap}
hr{border:0;border-top:1px solid var(--line);margin:2.6em 0}
a{color:var(--accent)}
.banner{background:#eef6f1;border:1px solid #bcdcc9;border-left:5px solid #2f6f4e;
 border-radius:8px;padding:16px 20px;margin-bottom:32px}
@media (prefers-color-scheme:dark){
 :root{--bg:#1b1b1f;--fg:#e6e6e6;--muted:#a0a0aa;--line:#33333a;--accent:#7fc9a0;--code:#26262c}
 blockquote{background:#222623;color:#d6d6d6}
 th{background:#26262c}
 .banner{background:#1f2a23;border-color:#35523f}
}
</style></head><body><div class="wrap">
<div class="banner">
<strong style="font-size:1.05rem">双击文件夹中的「一键安装」即可完成安装（v${version}）</strong><br>
安装程序会装好桌面版、把浏览器扩展放到固定位置，并打开扩展管理页，提示你完成最后三步。
此前安装过的会在原位置更新，生词本不会丢失。详细说明见第二章。
</div>
${body}
</div></body></html>
`
}

function readme(version) {
  return `大傻豪学习翻译词典 v${version}
========================================

【怎么装】
1. 先把压缩包解压出来（右键 → 全部解压缩）
2. 双击「一键安装」
   Windows 提示「来自网络，是否运行」的话，点「运行」（或「更多信息 → 仍要运行」）
3. 按弹出窗口里写的三步，把浏览器扩展加载进 Chrome 或 Edge（浏览器规定扩展只能手动加载）

装好以后这个文件夹和压缩包都可以删掉。

【装了什么】
- 浏览器扩展：划词翻译、查词、生词本、闪卡复习、网页生词高亮……
- 桌面版（Windows）：在 QQ、微信、Word 里选词查词；三下空格翻译；Ctrl+Alt+S 截图查词

【以前装过的】
直接运行一键安装：它会找到你原来的扩展文件夹就地更新，
再到扩展管理页点一下刷新按钮 ⟳ 就行，生词本和复习进度都在。

【不用 Windows / 只想装扩展】
手动加载 files\\浏览器扩展 这个文件夹，步骤见「安装与使用说明书.html」第二章。

【卸载桌面版】
开始菜单 →「大傻豪词典」→「卸载大傻豪词典桌面版」（浏览器扩展和生词本不受影响）
`
}

/** 扫一个目录里有没有夹带 API Key、存储备份 */
function scanForKeys(root, label, problems) {
  walk(root, (file, isDir) => {
    const relative = label + path.relative(root, file)
    if (isDir) {
      if (/_storage-backup/i.test(path.basename(file))) problems.push(`存储备份文件夹：${relative}`)
      return
    }
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) return
    if (KEY_PATTERN.test(fs.readFileSync(file, "utf8"))) problems.push(`疑似 API Key：${relative}`)
  })
}

/**
 * 把桌面版压成 tar.xz 放进安装包。
 *
 * 关于中文名：Windows 自带的 tar 按**系统代码页**存文件名，不是 UTF-8——
 * 中文名的文件压进去、解出来会变成乱码（实测如此）。所以归档里从里到外一个中文都不许有：
 *   - 目录名：构建目录临时改名成 desktop-app（同盘改名是瞬间的，不复制）
 *   - 文件名：那两个中文名的文件临时改成英文，装的时候由 install.ps1 改回来
 * 传给 tar 的参数也全是相对路径、纯英文，免得命令行本身被转码。
 */
const DESKTOP_ASCII_NAMES = [
  ["大傻豪词典桌面版.exe", "app.exe"],
  ["使用说明.txt", "readme.txt"],
]

function packDesktop(target) {
  const staging = path.join(desktopReleaseDir, DESKTOP_ARCHIVE_ROOT)
  const tempArchive = path.join(desktopReleaseDir, DESKTOP_ARCHIVE)
  fs.rmSync(staging, { recursive: true, force: true })
  fs.rmSync(tempArchive, { force: true })
  fs.renameSync(desktopBuild, staging)
  try {
    for (const [chinese, ascii] of DESKTOP_ASCII_NAMES) {
      const from = path.join(staging, chinese)
      if (fs.existsSync(from)) fs.renameSync(from, path.join(staging, ascii))
    }
    // 兜底：以后再有中文名的文件混进来就直接报错，而不是打出一个装完一堆乱码的包
    const leftover = []
    walk(staging, (file) => {
      const relative = path.relative(staging, file)
      if (NON_ASCII.test(relative)) leftover.push(relative)
    })
    if (leftover.length > 0) {
      fail(
        [
          "桌面版里有中文名的文件，压进 tar 会变乱码：",
          ...leftover,
          "把它们加进 friend-package.cjs 的 DESKTOP_ASCII_NAMES 和 install.ps1 的 renameBack",
        ].join("\n  "),
      )
    }
    console.log("压缩桌面版（xz，320 MB 压到 100 MB 左右）…")
    execFileSync("tar.exe", ["-cJf", DESKTOP_ARCHIVE, DESKTOP_ARCHIVE_ROOT], {
      cwd: desktopReleaseDir,
      stdio: "inherit",
    })
  } finally {
    for (const [chinese, ascii] of DESKTOP_ASCII_NAMES) {
      const from = path.join(staging, ascii)
      if (fs.existsSync(from)) fs.renameSync(from, path.join(staging, chinese))
    }
    fs.renameSync(staging, desktopBuild)
  }
  fs.renameSync(tempArchive, target)
  const mb = (fs.statSync(target).size / 1024 / 1024).toFixed(1)
  console.log(`  ${DESKTOP_ARCHIVE}（${mb} MB）`)
}

async function main() {
  const version = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version
  const manifestPath = path.join(extensionBuild, "manifest.json")
  if (!fs.existsSync(manifestPath)) fail("找不到浏览器扩展的打包结果：先在仓库根目录 pnpm build")
  const manifestVersion = JSON.parse(fs.readFileSync(manifestPath, "utf8")).version
  if (manifestVersion !== version) {
    fail(`扩展打包结果是 v${manifestVersion}，package.json 是 v${version}：先重新 pnpm build`)
  }
  if (!fs.existsSync(path.join(desktopBuild, "大傻豪词典桌面版.exe"))) {
    fail("找不到桌面版的打包结果：先在 desktop 目录 npm run package")
  }

  console.log(`组装 ${PACKAGE_NAME}（v${version}）…`)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.rmSync(zipPath, { force: true })
  const files = path.join(outDir, "files")
  fs.mkdirSync(files, { recursive: true })

  fs.cpSync(extensionBuild, path.join(files, "浏览器扩展"), { recursive: true })
  packDesktop(path.join(files, DESKTOP_ARCHIVE))
  for (const script of ["install.ps1", "uninstall.ps1"]) {
    // PowerShell 5.1 要带 BOM 才认中文；换行统一成 CRLF
    const text = fs.readFileSync(path.join(installerDir, script), "utf8").replace(/^﻿/, "")
    fs.writeFileSync(path.join(files, script), BOM + crlf(text), "utf8")
  }
  const cmd = fs.readFileSync(path.join(installerDir, "一键安装.cmd"), "utf8")
  if (/[^\x00-\x7f]/.test(cmd)) fail("一键安装.cmd 里只能有英文字符（cmd 按系统代码页读它）")
  fs.writeFileSync(path.join(outDir, "一键安装.cmd"), crlf(cmd), "ascii")
  fs.writeFileSync(
    path.join(outDir, "安装与使用说明书.html"),
    await buildManualHtml(version),
    "utf8",
  )
  fs.writeFileSync(path.join(outDir, "先看我.txt"), BOM + crlf(readme(version)), "utf8")
  for (const legal of ["LICENSE", "NOTICE"]) {
    fs.copyFileSync(path.join(repo, legal), path.join(outDir, legal))
  }

  console.log("检查有没有夹带 API Key…")
  const problems = []
  // 桌面版已经压进 tar.xz 里扫不到了，所以直接扫它的构建目录
  for (const [root, label] of [
    [outDir, ""],
    [desktopBuild, "桌面版/"],
  ]) {
    scanForKeys(root, label, problems)
  }
  if (problems.length > 0) fail(`发现敏感内容，没有打压缩包：\n  ${problems.join("\n  ")}`)
  console.log("  没有发现")

  console.log("打压缩包（中文文件名用 Windows 自带的压缩，别的工具会乱码）…")
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -LiteralPath '${outDir}' -DestinationPath '${zipPath}' -CompressionLevel Optimal`,
    ],
    { stdio: "inherit" },
  )

  const zipMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)
  console.log(`\n完成：\n  ${outDir}（${folderSizeMb(outDir)} MB）\n  ${zipPath}（${zipMb} MB）`)
}

main().catch((error) => fail(error?.stack ?? String(error)))
