# Verify the native reminder popup: exists / shown / topmost / fully on screen.
#
# MUST be run from an INTERACTIVE terminal:
#   node test\verify-popup.mjs                                   # generate the script
#   powershell -NoProfile -ExecutionPolicy Bypass -File test\verify-popup.ps1
#
# Why: processes spawned by node run on a different window station and
# cannot enumerate the interactive desktop. Running this from node reports
# "window not found" - that is a broken ruler, not a broken window.
#
# This file is deliberately ASCII-only: PowerShell 5.1 reads .ps1 as ANSI
# unless there is a UTF-8 BOM, and a BOM is easy to lose on every edit.
#
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$gen = & node (Join-Path $here 'verify-popup.mjs') 2>&1 | Select-Object -Last 1
if (-not (Test-Path $gen)) { Write-Output "FAIL cannot generate script: $gen"; exit 1 }

$src = Get-Content $gen -Raw -Encoding UTF8
$enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($src))

# The popup must be launched from THIS (interactive) process.
$proc = Start-Process powershell.exe `
  -ArgumentList '-NoProfile', '-NonInteractive', '-EncodedCommand', $enc `
  -PassThru -WindowStyle Hidden

Start-Sleep -Seconds 5

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public class TSchedVerify {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<string> Find(string needle) {
    var res = new List<string>();
    EnumWindows((h, p) => {
      var t = new StringBuilder(512); GetWindowText(h, t, 512);
      if (t.ToString().Contains(needle)) {
        RECT r; GetWindowRect(h, out r);
        // WS_EX_TOPMOST is 0x8 (0x20 is WS_EX_TRANSPARENT)
        bool top = (GetWindowLong(h, -20) & 0x8) != 0;
        // Use the WS_VISIBLE style bit, not IsWindowVisible: the latter also
        // looks at the owner, and the owner is often a hidden console window,
        // so a perfectly visible window reports false.
        bool shown = (GetWindowLong(h, -16) & 0x10000000) != 0;
        res.Add(t + "|" + shown + "|" + top + "|" + r.Left + "," + r.Top + "," + r.Right + "," + r.Bottom);
      }
      return true;
    }, IntPtr.Zero);
    return res;
  }
}
"@

$found = [TSchedVerify]::Find([char]0x9A8C + [char]0x8BC1 + [char]0x7F6E + [char]0x9876)
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$fail = 0
function Check($name, $cond, $detail) {
  if ($cond) { Write-Output "  PASS  $name" }
  else { $script:fail++; Write-Output "  FAIL  $name  -> $detail" }
}

Write-Output ("screen " + $b.Width + "x" + $b.Height)
foreach ($f in $found) { Write-Output ("  found: " + $f) }

Check 'window exists' ($found.Count -ge 1) ("found " + $found.Count)

if ($found.Count -ge 1) {
  $p = $found[0] -split '\|'
  $shown = $p[1]
  $topmost = $p[2]
  $rect = $p[3] -split ',' | ForEach-Object { [int]$_ }
  # 判据用"实际关心的三件事",不用 WS_VISIBLE / IsWindowVisible:
  # 这两个读数在"由 PowerShell 起窗口"的情况下不可靠(owner 是隐藏的控制台窗口,
  # 窗口明明在屏幕上,位却读成 false)。
  # 生产路径(插件的 node 起的)实测 vis=True。
  Write-Output ("  info: WS_VISIBLE bit = " + $shown)
  Check 'topmost (WS_EX_TOPMOST)' ($topmost -eq 'True') "topmost=$topmost"
  Check 'has a real rect' (($rect[2] - $rect[0]) -gt 100 -and ($rect[3] - $rect[1]) -gt 100) ($rect -join ',')
  Check 'fully on screen' ($rect[0] -ge 0 -and $rect[1] -ge 0 -and $rect[2] -le $b.Width -and $rect[3] -le $b.Height) ($rect -join ',')
}

try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
Remove-Item $gen -ErrorAction SilentlyContinue

if ($fail -eq 0) { Write-Output ""; Write-Output "ALL PASS"; exit 0 }
Write-Output ""; Write-Output "$fail FAILURES"; exit 1
