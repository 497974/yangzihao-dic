/**
 * npm install 之后下载 Electron 程序本体（约 100 MB）。
 *
 * electron 包自己不再在安装时下载，第一次 `npm start` 才去拉，那时候再卡住很让人困惑，
 * 所以在这里提前下好。默认走 npmmirror 镜像（GitHub 在国内很慢）；想换源就自己设
 * ELECTRON_MIRROR 环境变量。下载完 electron 会按包里自带的校验和核对文件。
 */

process.env.ELECTRON_MIRROR ??= "https://npmmirror.com/mirrors/electron/"
require("electron/install.js")
