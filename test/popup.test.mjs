/**
 * 原生弹窗脚本的语法检查。
 *
 * 不真的开窗口 —— 用 PowerShell 自己的 Parser 检查生成的脚本能不能解析。
 * 这一层必须测:脚本里全是引号和脚本块,写错了用户只会看到窗口一闪然后什么都没有,
 * 完全没有线索。
 */
import { execFileSync } from 'node:child_process'

import { buildReminderScript, buildToastScript } from '../lib/popup.js'

let failures = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log('  PASS  ' + name)
  else {
    failures++
    console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : ''))
  }
}

/** 让 PowerShell 解析脚本,返回 [错误数, 第一条错误]。 */
function parseErrors(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const checkScript = [
    '$ErrorActionPreference = "Stop"',
    `$src = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('${encoded}'))`,
    '$tokens = $null',
    '$errors = $null',
    '[void][System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$tokens, [ref]$errors)',
    'if ($errors.Count -eq 0) { "PARSE_OK" } else { "PARSE_ERR " + $errors.Count + " " + $errors[0].Message }',
  ].join('\n')
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(checkScript, 'utf16le').toString('base64')],
    { encoding: 'utf8', timeout: 30000 },
  ).trim()
  return out
}

console.log('=== 脚本能被 PowerShell 解析 ===')
{
  const plain = buildReminderScript({ title: '吃饭', date: '2026-11-04', start: '17:30' })
  check('普通内容', parseErrors(plain) === 'PARSE_OK', parseErrors(plain))
}

console.log('\n=== 引号和换行不会把脚本弄坏 ===')
{
  const nasty = buildReminderScript({
    title: "别让它'炸'了",
    date: '2026-11-04',
    start: '17:30',
    end: '18:00',
    note: '第一行\n第二行\n\n有单引号 \' 和双引号 " 还有 $dollar 和 `反引号',
  })
  check('带单引号/换行/美元符', parseErrors(nasty) === 'PARSE_OK', parseErrors(nasty))
}

console.log('\n=== 内容真的进了脚本 ===')
{
  const s = buildReminderScript({ title: '写JAVA', date: '2026-11-04', start: '18:40', end: '20:00', note: '记得复习' })
  check('标题在里面', s.includes('写JAVA'))
  check('时间段在里面', s.includes('18:40') && s.includes('20:00'))
  check('备注在里面', s.includes('记得复习'))
  check('只有一个按钮', (s.match(/New-Object System.Windows.Forms.Button/g) || []).length === 1)
  check('备注可滚动', s.includes('ScrollBars = "Vertical"'))
}

console.log('\n=== 必须在最上面(这条踩过坑)===')
{
  const s = buildReminderScript({ title: 'A', date: '2026-11-04', start: '10:00' })
  // 只写 $f.TopMost 不够:实测窗口会压在最大化窗口下面,开着别的程序就看不见。
  check('用 SetWindowPos 硬置顶', s.includes('SetWindowPos') && s.includes('[IntPtr](-1)'))
  check('显示后拉到前台', s.includes('SetForegroundWindow'))
  check('任务栏闪一下', s.includes('FlashWindow'))
  check('每秒重申置顶', s.includes('$keep.Interval = 1000'))
  // 位置不能写死:本机屏幕只有 1229x768,写死坐标会顶出边缘
  check('位置用屏幕居中', s.includes('StartPosition = "CenterScreen"'))
  check('没有写死坐标', !/\$f\.Location = New-Object/.test(s))
}

console.log('\n=== 系统通知(独占全屏时唯一能看见的路)===')
{
  const s = buildToastScript({ title: '吃早饭', date: '2026-11-05', start: '07:20' })
  check('发了 toast', s.includes('ToastNotificationManager') && s.includes('.Show($tt)'))
  check('通知标题是「日程提醒」', s.includes('CreateTextNode("日程提醒")'))
  check('通知带上标题和时间', s.includes('吃早饭') && s.includes('07:20'))
  check('通知失败会报出来', s.includes('TOAST_FAIL'))
  // 关键:通知必须和窗口分开进程。
  // 放同一个脚本里实测会互相拖累 —— 后台启动时通知那段会卡住,连带窗口都开不出来。
  const w = buildReminderScript({ title: '吃早饭', date: '2026-11-05', start: '07:20' })
  check('窗口脚本里没有通知', !w.includes('ToastNotificationManager'))
  check('通知脚本里没有窗口', !s.includes('System.Windows.Forms.Form'))
}

console.log('\n=== 不能自动关闭(必须手动确认)===')
{
  const s = buildReminderScript({ title: 'A', date: '2026-11-04', start: '10:00' })
  // 脚本里确实有一个 Timer,但那是"保持置顶"的,不是自动关窗的。
  // 所以判据是:关闭窗口的调用只有按钮那一次。
  const closes = (s.match(/\$f\.Close\(\)/g) || []).length
  check('只有一处关闭窗口(按钮)', closes === 1, '出现 ' + closes + ' 次')
  check('关闭在按钮的点击里', /Add_Click\(\{ \$f\.Close\(\) \}\)/.test(s))
  check('定时器不停窗', !/Add_Tick\(\{[^}]*\$f\.Close/.test(s))
}

console.log('\n=== 备注为空时不占地方 ===')
{
  const s = buildReminderScript({ title: 'A', date: '2026-11-04', start: '10:00' })
  check('空备注会隐藏', s.includes('if ($n.Text -eq "") { $n.Visible = $false }'))
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS')
if (failures) process.exit(1)
