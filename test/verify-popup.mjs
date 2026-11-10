/**
 * 生成要验证的弹窗脚本(只生成文件,不弹窗)。
 *
 * 单独拆出来是因为:验证必须从**交互式终端**跑。
 * node 起的子进程在另一个窗口站上,枚举不到交互式桌面 —— 那样量出来的
 * "窗口不存在"是尺子坏了,不是东西坏了。
 *
 * 用法: node test/verify-popup.mjs
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { buildReminderScript } from '../lib/popup.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const title = '验证置顶'
const base = buildReminderScript({ title, date: '2026-11-04', start: '10:00', note: '备注' })

// 加个 15 秒自动关,免得挂住
const script = base.replace(
  '[void]$f.ShowDialog()',
  `$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 15000
$timer.Add_Tick({ $timer.Stop(); $f.Close() })
$timer.Start()
[void]$f.ShowDialog()`,
)

const out = path.join(HERE, '_popup-script.ps1')
writeFileSync(out, script, 'utf8')
console.log(out)
