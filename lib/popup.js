/**
 * 原生提醒窗口。
 *
 * 为什么需要它:浏览器里的弹窗只在 DSH 是前台窗口时看得见。
 * 舰长要的是"DSH 在后面也要看到",所以这里用 WinForms 开一个置顶窗口 ——
 * 和旧版那个 ReminderForm.dll 是同一个思路,只是不再编译 DLL,
 * 直接用 PowerShell 现开。
 *
 * 约束(舰长的原话):
 *   - "和dsh主题一致"  -> 主题那个由客户端弹窗负责;这个原生窗口负责"一定看得见"
 *   - "必须手动确认关闭" -> 不设自动关闭定时器,只能点「知道了」
 *   - 内容多了要能滚   -> 备注区是只读多行 TextBox,带垂直滚动条
 */

import { spawn } from 'node:child_process'

/** PowerShell 单引号字符串:内部单引号翻倍,其余原样。 */
function psQuote(s) {
  return "'" + String(s ?? '').replace(/'/g, "''") + "'"
}

/** -EncodedCommand 要的是 UTF-16LE 的 base64。 */
function encodeCommand(script) {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/**
 * 生成那个 PowerShell 脚本。
 *
 * 单独抽出来是为了能测:脚本里有大量引号和脚本块,
 * 一旦写错,用户只会看到窗口一闪然后什么都没有 —— 无从排查。
 * 测试里用 PowerShell 自己的 Parser 检查它能不能解析。
 */
/**
 * 系统通知(toast)的脚本 —— **单独一个进程**。
 *
 * 为什么单独:通知和窗口放同一个脚本里,实测会互相拖累 ——
 * 后台启动时通知那段会卡住,连带窗口都开不出来(卡在通知,窗口还没建)。
 * 拆开之后:通知发不出去顶多是少一条提示,窗口照开。
 *
 * 为什么需要通知:置顶窗口在**独占全屏**的程序面前是盖不住的 ——
 * 视频网站全屏播放走的就是独占全屏,那一层在置顶窗口之上,
 * 窗口明明存在、可见、置顶,人就是看不见。
 * 系统通知走通知层,Windows 专门为"游戏全屏时也要能提示"准备的,全屏也盖不住。
 */
export function buildToastScript(event) {
  const title = String(event?.title ?? '').slice(0, 120) || '(无标题)'
  const when =
    String(event?.date ?? '') + '  ' + String(event?.start ?? '') + (event?.end ? ' – ' + event.end : ' 开始')
  return [
    'try {',
    '  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    '  $tx = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
    '  $tn = $tx.GetElementsByTagName("text")',
    '  $tn.Item(0).AppendChild($tn.Item(0).OwnerDocument.CreateTextNode("日程提醒")) | Out-Null',
    `  $tn.Item(1).AppendChild($tn.Item(0).OwnerDocument.CreateTextNode(${psQuote(title + '  ' + when)})) | Out-Null`,
    '  $tt = [Windows.UI.Notifications.ToastNotification]::new($tx)',
    '  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Microsoft.Windows.PowerShell").Show($tt)',
    '  Write-Output "TOAST_OK"',
    '} catch {',
    '  Write-Output ("TOAST_FAIL " + $_.Exception.Message)',
    '}',
  ].join('\n')
}

export function buildReminderScript(event, options = {}) {
  const title = String(event?.title ?? '').slice(0, 120) || '(无标题)'
  const when =
    String(event?.date ?? '') + '  ' + String(event?.start ?? '') + (event?.end ? ' – ' + event.end : ' 开始')
  const note = String(event?.note ?? '')
  const idx = Math.max(0, Number(options.offsetIndex) || 0)

  // 用换行分隔,不用分号 —— 里面全是脚本块。
  return [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    // 硬置顶要靠这几个 API。
    //
    // 只写 $f.TopMost = $true 是不够的:实测枚举窗口拿到的是 topmost=False,
    // 窗口整个压在最大化窗口下面 —— 开着 B 站的时候根本看不见。
    // 所以显示之后用 SetWindowPos(HWND_TOPMOST) 硬来一次,并且每秒重申,
    // 免得被别的程序抢走置顶。
    'Add-Type @\"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class TSchedWin {',
    '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
    '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);',
    '  [DllImport("user32.dll")] public static extern bool FlashWindow(IntPtr h, bool on);',
    '}',
    '\"@',

    '$f = New-Object System.Windows.Forms.Form',
    `$f.Text = ${psQuote('日程提醒 — ' + title)}`,
    '$f.ClientSize = New-Object System.Drawing.Size(500, 330)',
    // 位置交给 CenterScreen —— 本机屏幕只有 1229x768,写死坐标会顶出右边缘。
    '$f.StartPosition = "CenterScreen"',
    '$f.FormBorderStyle = "FixedDialog"',
    '$f.MaximizeBox = $false',
    '$f.MinimizeBox = $false',
    '$f.ShowInTaskbar = $true',
    '$f.BackColor = [System.Drawing.Color]::FromArgb(255, 250, 250, 252)',
    '$f.ForeColor = [System.Drawing.Color]::FromArgb(255, 24, 24, 28)',

    '$kicker = New-Object System.Windows.Forms.Label',
    '$kicker.Text = "日程提醒"',
    '$kicker.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)',
    '$kicker.ForeColor = [System.Drawing.Color]::FromArgb(255, 120, 120, 130)',
    '$kicker.Location = New-Object System.Drawing.Point(22, 16)',
    '$kicker.Size = New-Object System.Drawing.Size(460, 20)',
    '$f.Controls.Add($kicker)',

    '$t = New-Object System.Windows.Forms.Label',
    `$t.Text = ${psQuote(title)}`,
    '$t.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 15, [System.Drawing.FontStyle]::Bold)',
    '$t.ForeColor = [System.Drawing.Color]::FromArgb(255, 24, 24, 28)',
    '$t.AutoSize = $false',
    '$t.Location = New-Object System.Drawing.Point(22, 38)',
    '$t.Size = New-Object System.Drawing.Size(452, 58)',
    '$f.Controls.Add($t)',

    '$w = New-Object System.Windows.Forms.Label',
    `$w.Text = ${psQuote(when)}`,
    '$w.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 10)',
    '$w.ForeColor = [System.Drawing.Color]::FromArgb(255, 60, 60, 70)',
    '$w.AutoSize = $false',
    '$w.Location = New-Object System.Drawing.Point(22, 98)',
    '$w.Size = New-Object System.Drawing.Size(452, 24)',
    '$f.Controls.Add($w)',

    // 备注:只读多行 + 垂直滚动条,内容多了能滚
    '$n = New-Object System.Windows.Forms.TextBox',
    '$n.Multiline = $true',
    '$n.ReadOnly = $true',
    '$n.ScrollBars = "Vertical"',
    '$n.BorderStyle = "FixedSingle"',
    '$n.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 10)',
    `$n.Text = ${psQuote(note)}`,
    '$n.Location = New-Object System.Drawing.Point(22, 128)',
    '$n.Size = New-Object System.Drawing.Size(452, 136)',
    '$n.BackColor = [System.Drawing.Color]::FromArgb(255, 244, 244, 248)',
    '$f.Controls.Add($n)',
    'if ($n.Text -eq "") { $n.Visible = $false }',

    // 只有这一个按钮,没有自动关闭 —— 必须手动点
    '$ok = New-Object System.Windows.Forms.Button',
    '$ok.Text = "知道了"',
    '$ok.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 10)',
    '$ok.Size = New-Object System.Drawing.Size(120, 36)',
    '$ok.Location = New-Object System.Drawing.Point(354, 276)',
    '$ok.Add_Click({ $f.Close() })',
    '$f.Controls.Add($ok)',
    '$f.AcceptButton = $ok',

    // 显示之后:硬置顶。
    //
    // 只写属性不保险 —— 所以显示之后再用 SetWindowPos 硬来一次。
    // 这里刻意只留这一个调用:之前把 ShowWindow/SetForegroundWindow/FlashWindow
    // 也塞进来,实测窗口反而开不出来了(枚举不到),分不清是哪个出的问题,
    // 先把能验的留下来。
    '$f.TopMost = $true',
    '$f.Add_Shown({',
    '  try { [TSchedWin]::SetWindowPos($f.Handle, [IntPtr](-1), 0, 0, 0, 0, 0x0003) } catch { }',
    '  $f.TopMost = $true',
    '})',

    // 每秒重申一次置顶 —— 别的程序抢了就抢回来
    '$keep = New-Object System.Windows.Forms.Timer',
    '$keep.Interval = 1000',
    '$keep.Add_Tick({',
    '  if (-not $f.IsDisposed -and $f.Visible) {',
    '    [TSchedWin]::SetWindowPos($f.Handle, [IntPtr](-1), 0, 0, 0, 0, 0x0003)',
    '  }',
    '})',
    '$keep.Start()',
    '$f.Add_FormClosing({ $keep.Stop() })',

    '[void]$f.ShowDialog()',
  ].join('\n')
}

/**
 * 弹一个置顶的日程提醒,同时发一条系统通知。
 *
 * 不 await 窗口关闭 —— 它可能挂很久(用户离开电脑)。
 * 调用方只需要知道"开出去了"。
 *
 * options.onOutput:子进程的输出会一句句回调过来
 *   (脚本里会打印 TOAST_OK / TOAST_FAIL,这是唯一能知道通知发没发出去的证据)。
 */
export function showReminder(event, options = {}) {
  const script = buildReminderScript(event, options)
  const onOutput = typeof options.onOutput === 'function' ? options.onOutput : null

  return new Promise((resolve) => {
    let child
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodeCommand(script)],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      )
    } catch (e) {
      resolve({ ok: false, error: String((e && e.message) || e) })
      return
    }

    const collect = (chunk) => {
      const text = String(chunk || '')
      if (!onOutput) return
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim()
        if (t) onOutput(t)
      }
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.on('error', (e) => resolve({ ok: false, error: String((e && e.message) || e) }))
    // 开出去了就算成功;窗口本身是用户自己关的
    child.unref()
    resolve({ ok: true })
  })
}

/**
 * 单独发一条系统通知。
 *
 * 独立进程、独立生命周期 —— 通知发不出去也不影响窗口,
 * 而且通知进程发完就退,不留残余。
 */
export function showToast(event, options = {}) {
  const script = buildToastScript(event)
  const onOutput = typeof options.onOutput === 'function' ? options.onOutput : null
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodeCommand(script)],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      )
    } catch (e) {
      resolve({ ok: false, error: String((e && e.message) || e) })
      return
    }
    const collect = (chunk) => {
      const text = String(chunk || '')
      if (!onOutput) return
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim()
        if (t) onOutput(t)
      }
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.on('error', (e) => resolve({ ok: false, error: String((e && e.message) || e) }))
    child.on('close', () => resolve({ ok: true }))
    child.unref()
  })
}
