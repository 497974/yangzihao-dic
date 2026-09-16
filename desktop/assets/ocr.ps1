# Yang Zihao Dic desktop: recognize the text in an image with the Windows OCR engine
# (Windows.Media.Ocr, built into Windows 10/11, offline, no API key).
#
# Protocol (one line each way, UTF-8):
#   stdin : "<id> <png path>"
#   stdout: {"id":"<id>","language":"zh-Hans-CN",
#            "lines":[{"words":[{"text":"...","x":0,"y":0,"w":0,"h":0}]}],"error":null}
#
# Word boxes are returned instead of the engine's own line text: the Chinese engine puts a
# space between every Chinese character and sometimes splits an English word in two, so the
# desktop app joins the words itself by their positions (see src/ocr.ts).
#
# The user-profile engine is used first (the Chinese one also reads English). When an English
# engine is installed as well and the text is mostly Latin letters, it is read again in English.
#
# Keep this file ASCII only: Windows PowerShell 5.1 misreads UTF-8 scripts without a BOM.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime] | Out-Null
[Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime] | Out-Null

# WinRT async calls are awaited through the .NET AsTask bridge
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($operation, [Type]$type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($operation))
  $task.Wait(-1) | Out-Null
  $task.Result
}

$primary = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $primary) {
  $first = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Select-Object -First 1
  if ($null -ne $first) { $primary = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($first) }
}
$english = $null
$englishLanguage = New-Object Windows.Globalization.Language 'en-US'
if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($englishLanguage)) {
  $english = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($englishLanguage)
}

$utf8 = New-Object System.Text.UTF8Encoding $false
$stdout = New-Object System.IO.StreamWriter ([Console]::OpenStandardOutput()), $utf8
$stdout.AutoFlush = $true
$stdin = New-Object System.IO.StreamReader ([Console]::OpenStandardInput()), $utf8

$stdout.WriteLine('{"id":"ready","language":null,"lines":[],"error":null}')

while ($true) {
  $line = $stdin.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  $space = $line.IndexOf(' ')
  $reply = [ordered]@{ id = $line; language = $null; lines = (New-Object System.Collections.ArrayList); error = $null }
  $stream = $null
  try {
    if ($space -lt 0) { throw 'missing image path' }
    $reply.id = $line.Substring(0, $space)
    $path = $line.Substring($space + 1)
    if ($null -eq $primary) { throw 'no_ocr_engine' }

    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

    $engine = $primary
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    if ($null -ne $english -and $engine.RecognizerLanguage.LanguageTag -notlike 'en*') {
      $text = ($result.Lines | ForEach-Object { $_.Text }) -join ' '
      $latin = ([regex]::Matches($text, '[A-Za-z]')).Count
      $cjk = ([regex]::Matches($text, '[㐀-鿿]')).Count
      if ($latin -gt 0 -and $latin -gt ($cjk * 3)) {
        $engine = $english
        $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
      }
    }
    $reply.language = $engine.RecognizerLanguage.LanguageTag

    foreach ($ocrLine in $result.Lines) {
      $words = New-Object System.Collections.ArrayList
      foreach ($word in $ocrLine.Words) {
        $rect = $word.BoundingRect
        [void]$words.Add([ordered]@{
          text = $word.Text
          x = [math]::Round($rect.X, 1)
          y = [math]::Round($rect.Y, 1)
          w = [math]::Round($rect.Width, 1)
          h = [math]::Round($rect.Height, 1)
        })
      }
      [void]$reply.lines.Add([ordered]@{ words = $words })
    }
  } catch {
    $reply.error = "$($_.Exception.Message)"
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
  }
  $stdout.WriteLine(($reply | ConvertTo-Json -Compress -Depth 6))
}
