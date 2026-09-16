@echo off
rem Yang Zihao Dic one-click installer: runs files\install.ps1 next to this file.
rem Keep this file ASCII only: cmd.exe reads it in the system code page.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0files\install.ps1"
if errorlevel 1 pause
