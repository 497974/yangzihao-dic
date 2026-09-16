@echo off
chcp 65001 >nul
rem 开发阶段的启动方式（正式的免安装版在第 9 步打包）。
rem 双击运行；程序会待在屏幕右下角的托盘里，这个黑窗口会自己关掉。
cd /d "%~dp0"
if not exist "dist\main.js" (
  echo 第一次运行，先编译……
  call npm run build || pause
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
