# Yang Zihao Dic desktop: read the selected text and the paragraph around it
# through UI Automation, without touching the clipboard.
#
# Protocol (one line each way, UTF-8):
#   stdin : "<id>"          -> use the focused control
#           "<id> <hwnd>"   -> use the control with this window handle (for tests)
#   stdout: {"id":"<id>","selection":"...","text":"<paragraph>","error":null}
#
# Uses the native UI Automation COM API (UIAutomationCore). The .NET wrapper
# (System.Windows.Automation) cannot read classic Win32 text boxes without
# client-side proxies, and registering those fails on current Windows.
#
# Keep this file ASCII only: Windows PowerShell 5.1 misreads UTF-8 scripts without a BOM.

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace Yzh {
  // Only the vtable slots up to the methods we call are declared, in order.
  [ComImport, Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IUIAutomation {
    void CompareElements();
    void CompareRuntimeIds();
    void GetRootElement();
    [PreserveSig] int ElementFromHandle(IntPtr hwnd, out IUIAutomationElement element);
    void ElementFromPoint();
    [PreserveSig] int GetFocusedElement(out IUIAutomationElement element);
  }

  [ComImport, Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IUIAutomationElement {
    void SetFocus();
    void GetRuntimeId();
    void FindFirst();
    void FindAll();
    void FindFirstBuildCache();
    void FindAllBuildCache();
    void BuildUpdatedCache();
    void GetCurrentPropertyValue();
    void GetCurrentPropertyValueEx();
    void GetCachedPropertyValue();
    void GetCachedPropertyValueEx();
    void GetCurrentPatternAs();
    void GetCachedPatternAs();
    [PreserveSig] int GetCurrentPattern(int patternId, [MarshalAs(UnmanagedType.IUnknown)] out object pattern);
  }

  [ComImport, Guid("32eba289-3583-42c9-9c59-3b6d9a1e9b6a"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IUIAutomationTextPattern {
    void RangeFromPoint();
    void RangeFromChild();
    [PreserveSig] int GetSelection(out IUIAutomationTextRangeArray ranges);
  }

  [ComImport, Guid("ce4ae76a-e717-4c98-81ea-47371d028eb6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IUIAutomationTextRangeArray {
    [PreserveSig] int get_Length(out int length);
    [PreserveSig] int GetElement(int index, out IUIAutomationTextRange range);
  }

  [ComImport, Guid("a543cc6a-f4ae-494b-8239-c814481187a8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IUIAutomationTextRange {
    [PreserveSig] int Clone(out IUIAutomationTextRange clone);
    void Compare();
    void CompareEndpoints();
    [PreserveSig] int ExpandToEnclosingUnit(int unit);
    void FindAttribute();
    void FindText();
    void GetAttributeValue();
    void GetBoundingRectangles();
    void GetEnclosingElement();
    [PreserveSig] int GetText(int maxLength, [MarshalAs(UnmanagedType.BStr)] out string text);
  }

  [ComImport, Guid("ff48dba4-60ef-4201-aa87-54103eef594e")]
  class CUIAutomation {}

  public static class SelectionContext {
    const int TextPatternId = 10014;
    const int TextUnitParagraph = 3;
    static IUIAutomation automation;

    // Returns the paragraph; the selected text itself comes back in "selection".
    public static string Read(long hwnd, out string selection, out string error) {
      selection = null;
      error = null;
      if (automation == null) {
        automation = (IUIAutomation)new CUIAutomation();
      }
      IUIAutomationElement element;
      int hr = hwnd == 0
        ? automation.GetFocusedElement(out element)
        : automation.ElementFromHandle(new IntPtr(hwnd), out element);
      if (hr != 0 || element == null) { error = "no_element"; return null; }

      object raw;
      if (element.GetCurrentPattern(TextPatternId, out raw) != 0 || raw == null) {
        error = "no_text_pattern";
        return null;
      }
      IUIAutomationTextPattern pattern = (IUIAutomationTextPattern)raw;

      IUIAutomationTextRangeArray ranges;
      int length = 0;
      if (pattern.GetSelection(out ranges) != 0 || ranges == null
          || ranges.get_Length(out length) != 0 || length == 0) {
        error = "no_selection";
        return null;
      }
      IUIAutomationTextRange range;
      IUIAutomationTextRange paragraph;
      if (ranges.GetElement(0, out range) != 0 || range == null) {
        error = "no_selection";
        return null;
      }
      string selected;
      if (range.GetText(20000, out selected) == 0) {
        selection = selected;
      }
      if (range.Clone(out paragraph) != 0) { error = "get_text_failed"; return null; }
      paragraph.ExpandToEnclosingUnit(TextUnitParagraph);
      string text;
      if (paragraph.GetText(5000, out text) != 0) { error = "get_text_failed"; return null; }
      return text;
    }
  }
}
"@

$utf8 = New-Object System.Text.UTF8Encoding $false
$stdout = New-Object System.IO.StreamWriter ([Console]::OpenStandardOutput()), $utf8
$stdout.AutoFlush = $true
$stdin = New-Object System.IO.StreamReader ([Console]::OpenStandardInput()), $utf8

# Tell the desktop app the helper is loaded
$stdout.WriteLine('{"id":"ready","selection":null,"text":null,"error":null}')

while ($true) {
  $line = $stdin.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Trim().Split(' ')
  $reply = [ordered]@{ id = $parts[0]; selection = $null; text = $null; error = $null }
  try {
    $hwnd = [Int64]0
    if ($parts.Length -gt 1) { $hwnd = [Int64]$parts[1] }
    $sel = $null
    $err = $null
    $reply.text = [Yzh.SelectionContext]::Read($hwnd, [ref]$sel, [ref]$err)
    $reply.selection = $sel
    $reply.error = $err
  } catch {
    $reply.error = $_.Exception.Message
  }
  $stdout.WriteLine(($reply | ConvertTo-Json -Compress))
}
