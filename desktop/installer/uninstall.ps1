<#
  卸载大傻豪词典桌面版。
  浏览器扩展、生词本、复习记录都在浏览器里，不受影响。
  注意：这个文件必须存成带 BOM 的 UTF-8，Windows PowerShell 5.1 才认得出里面的中文。
#>
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms

$appName = '大傻豪词典桌面版'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$title = '大傻豪词典 · 卸载'

$answer = [System.Windows.Forms.MessageBox]::Show(
  "要卸载$($appName)吗？`n`n浏览器扩展、生词本和复习记录都在浏览器里，不受影响。",
  $title, 'YesNo', 'Question')
if ($answer -ne 'Yes') { exit 0 }

Get-Process -Name $appName -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 800

# 在托盘里勾过「开机自动启动」的话，把那一项也删掉
$run = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
$entries = Get-ItemProperty -Path $run -ErrorAction SilentlyContinue
if ($entries) {
  foreach ($entry in $entries.PSObject.Properties) {
    if ("$($entry.Value)" -like "*$($appName).exe*") {
      Remove-ItemProperty -Path $run -Name $entry.Name -ErrorAction SilentlyContinue
    }
  }
}

Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) "$($appName).lnk") -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) '大傻豪词典') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $root '桌面版') -Recurse -Force -ErrorAction SilentlyContinue

[void][System.Windows.Forms.MessageBox]::Show(
  "$($appName)已经卸载了。`n`n浏览器扩展没有动：不想要了，可以在浏览器的扩展管理页把它移除。",
  $title, 'OK', 'Information')
