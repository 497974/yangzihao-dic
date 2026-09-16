<#
  大傻豪学习翻译词典 · 一键安装（Windows）

  - 桌面版装到 %LOCALAPPDATA%\大傻豪词典\桌面版，桌面和开始菜单放快捷方式，装完启动一次
  - 浏览器扩展：
    · 以前装过的：浏览器是按文件夹认扩展的（换个文件夹加载就成了另一个扩展，生词本就"丢"了），
      所以找到原来加载的那个文件夹、就地更新，用户只要点一下刷新
    · 第一次装的：放到 %LOCALAPPDATA%\大傻豪词典\浏览器扩展，打开扩展管理页，教用户加载
  - 不需要管理员权限，不改系统设置

  测试：-InstallRoot <临时目录> -Quiet
  （不建真的快捷方式、不启动、不弹窗、不打开浏览器；找到的旧扩展只列出来，不更新）

  注意：这个文件必须存成带 BOM 的 UTF-8，Windows PowerShell 5.1 才认得出里面的中文。
#>
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA '大傻豪词典'),
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$appName = '大傻豪词典桌面版'
$desktopSource = Join-Path $here '桌面版'
# 新版安装包里桌面版是一个 tar.xz（Electron 有 320 MB，zip 压不动，xz 能压到 100 MB 左右）；
# 老版安装包里是解开的文件夹，两种都认
$desktopArchive = Join-Path $here 'desktop-app.tar.xz'
$desktopArchiveRoot = 'desktop-app'
$extensionSource = Join-Path $here '浏览器扩展'
$desktopTarget = Join-Path $InstallRoot '桌面版'
$extensionTarget = Join-Path $InstallRoot '浏览器扩展'

function Show-Message([string]$text, [string]$icon = 'Information') {
  if ($Quiet) {
    Write-Host $text
    return
  }
  # 挂在一个置顶的隐藏窗口上，免得弹窗被刚打开的浏览器挡住
  $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
  [void][System.Windows.Forms.MessageBox]::Show($owner, $text, '大傻豪词典 · 安装', 'OK', $icon)
  $owner.Dispose()
}

<#
  把桌面版的 tar.xz 解开，返回解出来的文件夹路径。

  用 Windows 自带的 tar（Win10 1803 起就有）。所有传给它的参数都是纯英文的相对路径，
  工作目录用 Push-Location 切过去——朋友的用户名、解压位置都可能是中文，
  而 tar 是原生程序，命令行里的中文会不会被转码要看系统代码页，干脆不传。
  归档里面的中文文件名存的是 UTF-8，tar 能原样还原。
#>
function Expand-DesktopArchive([string]$archive) {
  if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) {
    throw '本机未找到 tar 命令（Windows 10 1803 及以上版本自带）。请更新系统后重试，或向安装包提供者索取免解压版本。'
  }
  $workDir = Split-Path -Parent $archive
  $unpacked = Join-Path $workDir $desktopArchiveRoot
  if (Test-Path -LiteralPath $unpacked) {
    Remove-Item -LiteralPath $unpacked -Recurse -Force
  }
  Write-Host '正在解压桌面版（约 300 MB，请稍候）……'
  Push-Location -LiteralPath $workDir
  try {
    & tar.exe -xf ([System.IO.Path]::GetFileName($archive))
    if ($LASTEXITCODE -ne 0) {
      throw "解压桌面版失败（tar 错误码 $LASTEXITCODE）。压缩包可能没下全，重新下载一次再试。"
    }
  } finally {
    Pop-Location
  }
  # 归档里的文件名全是英文（Windows 的 tar 按系统代码页存名字，中文名压进去会乱码），
  # 解出来之后在这里改回中文名
  $renameBack = @{ 'app.exe' = "$appName.exe"; 'readme.txt' = '使用说明.txt' }
  foreach ($ascii in $renameBack.Keys) {
    $from = Join-Path $unpacked $ascii
    if (Test-Path -LiteralPath $from) {
      Rename-Item -LiteralPath $from -NewName $renameBack[$ascii] -Force
    }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $unpacked "$appName.exe"))) {
    throw '解压出的桌面版文件不完整，压缩包可能未下载完整，请重新下载后再试。'
  }
  return $unpacked
}

# robocopy /MIR：新的补上、多余的删掉，更新时不留旧版的文件
function Copy-Folder([string]$from, [string]$to) {
  New-Item -ItemType Directory -Force -Path $to | Out-Null
  robocopy $from $to /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "复制文件失败（$from → $to），robocopy 错误码 $LASTEXITCODE"
  }
}

# 扩展真正显示出来的名字。清单里的 name 多半是 __MSG_extName__ 这种「按语言显示」的占位符，
# 很多扩展都这么写，不能拿它比——得去扩展默认语言的语言包里查出实际名字
# （本扩展是 Yang Zihao Dic - Translate & Learn）。查不到就返回 null，当成不是同一个扩展。
function Read-ExtensionName([string]$folder) {
  $manifest = Join-Path $folder 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifest)) { return $null }
  try {
    $data = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $name = [string]$data.name
    if ($name -notmatch '^__MSG_(\w+)__$') { return $name }
    $key = $Matches[1]
    $locale = if ($data.default_locale) { [string]$data.default_locale } else { 'en' }
    $messagesFile = Join-Path $folder "_locales\$locale\messages.json"
    if (-not (Test-Path -LiteralPath $messagesFile)) { return $null }
    $entry = (Get-Content -LiteralPath $messagesFile -Raw -Encoding UTF8 | ConvertFrom-Json).$key
    if (-not $entry -or -not $entry.message) { return $null }
    return [string]$entry.message
  } catch {
    return $null
  }
}

# 以前加载过的扩展文件夹：Chrome、Edge 的配置里记着每个「已解压扩展」的文件夹位置，
# 挑出实际名字和这次的扩展一样的。只读这些路径，不碰别的配置。
# 返回 @{ 文件夹 = 'chrome' 或 'edge' }
function Find-InstalledExtensionFolders([string]$extensionName) {
  $browsers = @(
    @{ Name = 'chrome'; Root = (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data') },
    @{ Name = 'edge'; Root = (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data') }
  )
  $found = @{}
  foreach ($browser in $browsers) {
    if (-not (Test-Path -LiteralPath $browser.Root)) { continue }
    $browserProfiles = Get-ChildItem -LiteralPath $browser.Root -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' }
    foreach ($browserProfile in $browserProfiles) {
      foreach ($fileName in @('Secure Preferences', 'Preferences')) {
        $prefs = Join-Path $browserProfile.FullName $fileName
        if (-not (Test-Path -LiteralPath $prefs)) { continue }
        try {
          $raw = [System.IO.File]::ReadAllText($prefs)
        } catch {
          continue
        }
        foreach ($match in [regex]::Matches($raw, '"path"\s*:\s*"((?:[^"\\]|\\.)*)"')) {
          try {
            $candidate = [regex]::Unescape($match.Groups[1].Value)
          } catch {
            continue
          }
          # 商店装的扩展记的是相对路径，跳过
          if (-not [System.IO.Path]::IsPathRooted($candidate)) { continue }
          if ((Read-ExtensionName $candidate) -ne $extensionName) { continue }
          $full = [System.IO.Path]::GetFullPath($candidate).TrimEnd('\')
          if (-not $found.ContainsKey($full)) { $found[$full] = $browser.Name }
        }
      }
    }
  }
  return $found
}

function Find-Browser([string]$prefer) {
  $candidates = @(
    @{ Name = 'chrome'; Exe = 'chrome.exe'; Page = 'chrome://extensions/' },
    @{ Name = 'edge'; Exe = 'msedge.exe'; Page = 'edge://extensions/' }
  )
  if ($prefer -eq 'edge') { [array]::Reverse($candidates) }
  foreach ($candidate in $candidates) {
    foreach ($hive in @('HKCU:', 'HKLM:')) {
      $key = "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$($candidate.Exe)"
      $value = (Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue).'(default)'
      if ($value -and (Test-Path -LiteralPath $value)) {
        return @{ Path = $value; Page = $candidate.Page }
      }
    }
  }
  return $null
}

try {
  $hasDesktop = (Test-Path -LiteralPath $desktopArchive) -or (Test-Path -LiteralPath $desktopSource)
  if (-not $hasDesktop -or -not (Test-Path -LiteralPath $extensionSource)) {
    throw '安装文件不完整。请先将整个压缩包解压（右键 → 全部解压缩），再运行解压后的「一键安装」。'
  }
  Write-Host '正在安装大傻豪词典，请稍等……'

  # 1. 桌面版：先关掉正在运行的旧版，再复制
  Get-Process -Name $appName -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 800
  $unpacked = $null
  if (Test-Path -LiteralPath $desktopArchive) {
    $unpacked = Expand-DesktopArchive $desktopArchive
    Copy-Folder $unpacked $desktopTarget
    # 解出来的这份有 300 MB，已经复制进安装目录了，别留在用户解压的文件夹里
    Remove-Item -LiteralPath $unpacked -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    Copy-Folder $desktopSource $desktopTarget
  }
  Copy-Item -LiteralPath (Join-Path $here 'uninstall.ps1') -Destination (Join-Path $InstallRoot 'uninstall.ps1') -Force

  # 2. 浏览器扩展：以前装过就就地更新，没装过就放到固定位置
  $extensionName = Read-ExtensionName $extensionSource
  # 连这次扩展自己的名字都读不出来就不做就地更新，宁可按第一次装处理，也不能认错文件夹覆盖掉别的扩展
  $existing = if ($extensionName) { Find-InstalledExtensionFolders $extensionName } else { @{} }
  $updated = New-Object System.Collections.ArrayList
  foreach ($folder in $existing.Keys) {
    if ($Quiet) {
      Write-Host "找到以前装的扩展（测试模式，不更新）：$folder（$($existing[$folder])）"
      continue
    }
    Copy-Folder $extensionSource $folder
    [void]$updated.Add($folder)
  }
  if ($updated.Count -eq 0) {
    Copy-Folder $extensionSource $extensionTarget
  }

  # 3. 解除「来自网络」的锁定，不然 Windows 会拦着不让桌面版运行
  Get-ChildItem -LiteralPath $InstallRoot -Recurse -File | Unblock-File
  foreach ($folder in $updated) {
    Get-ChildItem -LiteralPath $folder -Recurse -File | Unblock-File
  }

  # 4. 快捷方式：桌面、开始菜单（含卸载）
  $exe = Join-Path $desktopTarget "$($appName).exe"
  if ($Quiet) {
    $desktopDir = Join-Path $InstallRoot '_测试快捷方式'
    $menuDir = $desktopDir
  } else {
    $desktopDir = [Environment]::GetFolderPath('Desktop')
    $menuDir = Join-Path ([Environment]::GetFolderPath('Programs')) '大傻豪词典'
  }
  New-Item -ItemType Directory -Force -Path $desktopDir, $menuDir | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  function New-Shortcut([string]$path, [string]$target, [string]$arguments, [string]$description) {
    $link = $shell.CreateShortcut($path)
    $link.TargetPath = $target
    if ($arguments) { $link.Arguments = $arguments }
    $link.WorkingDirectory = $desktopTarget
    $link.IconLocation = "$exe,0"
    $link.Description = $description
    $link.Save()
  }
  $description = '在 QQ、微信、Word 等任何程序里选词查词'
  New-Shortcut (Join-Path $desktopDir "$($appName).lnk") $exe '' $description
  New-Shortcut (Join-Path $menuDir "$($appName).lnk") $exe '' $description
  $uninstallScript = Join-Path $InstallRoot 'uninstall.ps1'
  New-Shortcut (Join-Path $menuDir '卸载大傻豪词典桌面版.lnk') (Join-Path $PSHOME 'powershell.exe') `
    "-NoProfile -ExecutionPolicy Bypass -File `"$uninstallScript`"" '卸载桌面版（浏览器扩展和生词本不受影响）'

  if ($Quiet) {
    Write-Host "测试安装完成：$InstallRoot"
    exit 0
  }

  # 5. 启动桌面版，打开扩展管理页，告诉用户最后几步
  Start-Process -FilePath $exe
  $preferBrowser = if ($updated.Count -gt 0) { $existing[$updated[0]] } else { 'chrome' }
  $browser = Find-Browser $preferBrowser
  if ($browser) {
    Start-Process -FilePath $browser.Path -ArgumentList $browser.Page
    $openHint = '（扩展管理页已打开）'
  } else {
    $openHint = '（请打开 Chrome，在地址栏输入 chrome://extensions；Edge 输入 edge://extensions）'
  }

  if ($updated.Count -gt 0) {
    $folders = ($updated | ForEach-Object { "  $_" }) -join "`n"
    Show-Message (@(
      '安装完成。桌面版已在屏幕右下角的托盘中运行。',
      '',
      '检测到此前安装过的浏览器扩展，已在原位置更新：',
      $folders,
      '',
      "最后一步：在扩展管理页找到「大傻豪学习翻译词典」，点击卡片上的刷新按钮 ⟳。$openHint",
      '生词本与复习进度均已保留。',
      '',
      '首次使用桌面版：点击浏览器右上角的扩展图标 → 大傻豪学习翻译词典 → 设置，',
      '在左侧找到「桌面版」，打开「连接桌面版」。'
    ) -join "`n")
  } else {
    Set-Clipboard -Value $extensionTarget
    Show-Message (@(
      '桌面版已安装完成，正在屏幕右下角的托盘中运行。',
      '',
      "最后一步：将浏览器扩展加载到浏览器（浏览器规定扩展只能手动加载，共三步）$openHint",
      '',
      '1. 打开扩展管理页右上角的「开发者模式」',
      '2. 点击「加载已解压的扩展程序」，在弹出窗口顶部的地址栏按 Ctrl+V（扩展路径已复制到剪贴板），',
      '   回车后点击「选择文件夹」',
      '3. 点击浏览器右上角的扩展图标 → 大傻豪学习翻译词典 → 设置，在左侧找到「桌面版」，打开「连接桌面版」',
      '',
      "扩展放在：$extensionTarget",
      '（请勿删除该文件夹，浏览器每次都从这里读取扩展）'
    ) -join "`n")
  }
} catch {
  Show-Message "安装未完成：$($_.Exception.Message)`n`n可截图此窗口，反馈给安装包提供者。" 'Error'
  exit 1
}
