/**
 * 打免安装版（桌面版方案第 9 步 / 优化清单第 6 条）：
 *   release/大傻豪词典桌面版/                     解压就能用，双击 大傻豪词典桌面版.exe
 *   release/大傻豪词典桌面版-v<版本>-win-x64.zip  发给朋友的压缩包
 *
 * 不用 electron-builder：它要从 GitHub 下一堆打包工具，国内经常卡住。
 * 这里直接拿 node_modules 里已经下好的 Electron，把程序放进 resources/app——
 * 这就是 Electron 官方文档里的手动打包方式，不联网。
 *
 * 用法：npm run package（会先编译）
 */

const fs = require("node:fs")
const path = require("node:path")
const { execFileSync } = require("node:child_process")

const root = path.join(__dirname, "..")
const pkg = require(path.join(root, "package.json"))
const PRODUCT = "大傻豪词典桌面版"
const releaseDir = path.join(root, "release")
const outDir = path.join(releaseDir, PRODUCT)
const zipPath = path.join(releaseDir, `${PRODUCT}-v${pkg.version}-win-x64.zip`)
const electronDist = path.join(root, "node_modules", "electron", "dist")

function copy(from, to) {
  fs.cpSync(from, to, { recursive: true })
}

function folderSizeMb(dir) {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      total += fs.statSync(path.join(entry.parentPath, entry.name)).size
    }
  }
  return (total / 1024 / 1024).toFixed(1)
}

/** 改 exe 的图标和「文件说明」（任务管理器里显示的名字），不然看到的是 Electron */
async function brandExe(exePath) {
  let ResEdit
  try {
    const mod = await import("resedit")
    ResEdit = mod.default ?? mod
  } catch {
    console.warn("没装 resedit，exe 保留 Electron 的图标（npm install 后再打一次即可）")
    return
  }
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true })
  const resources = ResEdit.NtExecutableResource.from(exe)
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(root, "assets", "app.ico")))
  const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)
  for (const group of iconGroups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      resources.entries,
      group.id,
      group.lang,
      iconFile.icons.map((item) => item.data),
    )
  }
  const [versionInfo] = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)
  if (versionInfo) {
    const [major = 0, minor = 0, patch = 0] = pkg.version.split(".").map(Number)
    versionInfo.setFileVersion(major, minor, patch, 0)
    versionInfo.setProductVersion(major, minor, patch, 0)
    for (const language of versionInfo.getAllLanguagesForStringValues()) {
      versionInfo.setStringValues(language, {
        FileDescription: PRODUCT,
        ProductName: PRODUCT,
        InternalName: PRODUCT,
        OriginalFilename: `${PRODUCT}.exe`,
        CompanyName: "",
        FileVersion: pkg.version,
        ProductVersion: pkg.version,
      })
    }
    versionInfo.outputToResourceEntries(resources.entries)
  }
  resources.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))
}

const README = `大傻豪词典桌面版 v${pkg.version}
========================================

在 QQ、微信、Word、记事本等任何程序里选中文字，就能查词、翻译、存进浏览器扩展的生词本。

一、第一次用
1. 先装好浏览器扩展「大傻豪学习翻译词典」（见扩展的安装说明书）
2. 双击本文件夹里的「${PRODUCT}.exe」，屏幕右下角托盘里会出现图标
   想在桌面放个快捷方式：右键托盘图标 →「在桌面创建快捷方式」
3. 打开浏览器 → 点扩展图标 → 设置 → 左边「桌面版」→ 打开「连接桌面版」
   连上后托盘图标从灰色变成彩色

二、怎么用
- 用鼠标选中文字：旁边弹出一排按钮（翻译、朗读、词典……），点哪个做哪个
- 键盘选中文字后按 Ctrl+Alt+D：直接查词典
- 在 QQ、微信的输入框里打完中文，连按三下空格：翻译成英文
- 按 Ctrl+Alt+S：框选屏幕上复制不出来的字（游戏、图片、扫描版 PDF），认出来再查词或翻译
- 浏览器没开时查的词会先记下来，打开浏览器后自动查好、存进生词本

三、其它
- 右键托盘图标可以设置开机自启、关掉某个功能、查看日志
- 整个文件夹可以放在任何地方；不要只把 exe 单独拿出来
- 查词用的是扩展里配好的 AI / 翻译服务，桌面版本身不存任何密钥
`

async function main() {
  if (!fs.existsSync(path.join(electronDist, "electron.exe"))) {
    throw new Error("找不到 node_modules/electron/dist/electron.exe，先 npm install")
  }
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.rmSync(zipPath, { force: true })

  console.log("复制 Electron…")
  copy(electronDist, outDir)
  // 默认的示例程序：有了 resources/app 就用不上它
  fs.rmSync(path.join(outDir, "resources", "default_app.asar"), { force: true })
  // 界面全是中文：Chromium 自带 55 种界面语言包（右键菜单之类的文字），只留中文和英文（缺省兜底）
  const keepLocales = new Set(["zh-CN.pak", "zh-TW.pak", "en-US.pak"])
  const localesDir = path.join(outDir, "locales")
  for (const file of fs.readdirSync(localesDir)) {
    if (!keepLocales.has(file)) {
      fs.rmSync(path.join(localesDir, file))
    }
  }
  const exePath = path.join(outDir, `${PRODUCT}.exe`)
  fs.renameSync(path.join(outDir, "electron.exe"), exePath)

  console.log("复制程序…")
  const appDir = path.join(outDir, "resources", "app")
  copy(path.join(root, "dist"), path.join(appDir, "dist"))
  copy(path.join(root, "assets"), path.join(appDir, "assets"))
  // name 不能改：设置、日志、离线收词都存在 %APPDATA%\\<name> 下，改了就找不到开发时的数据
  const appPackage = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    license: pkg.license,
    main: pkg.main,
  }
  fs.writeFileSync(path.join(appDir, "package.json"), `${JSON.stringify(appPackage, null, 2)}\n`)

  // 运行时只用得到 ws 和 koffi；koffi 自带所有平台的原生文件（27 MB），只留 Windows x64 的
  const modules = path.join(appDir, "node_modules")
  copy(path.join(root, "node_modules", "ws"), path.join(modules, "ws"))
  const koffiFrom = path.join(root, "node_modules", "koffi")
  const koffiTo = path.join(modules, "koffi")
  for (const file of ["package.json", "index.js", "indirect.js", "index.d.ts", "LICENSE.txt"]) {
    if (fs.existsSync(path.join(koffiFrom, file))) {
      copy(path.join(koffiFrom, file), path.join(koffiTo, file))
    }
  }
  copy(
    path.join(koffiFrom, "build", "koffi", "win32_x64"),
    path.join(koffiTo, "build", "koffi", "win32_x64"),
  )

  console.log("换图标…")
  await brandExe(exePath)

  fs.writeFileSync(path.join(outDir, "使用说明.txt"), `﻿${README.replace(/\n/g, "\r\n")}`)

  console.log("打压缩包…")
  // 用 PowerShell 打：别的工具打出来的中文文件名在 Windows 上会乱码
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

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
