/** 补测:状态标签(已提醒 / 错过)和幂等 ack。 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { statusOf, pendingReminders, ackReminder, MISSED_AFTER_MS, startMs } from '../lib/store.js'

let failures = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log('  PASS  ' + name)
  else {
    failures++
    console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : ''))
  }
}

const ev = (over) =>
  Object.assign(
    {
      id: 'e1',
      title: '吃饭',
      date: '2026-11-04',
      start: '17:30',
      end: '',
      leadMinutes: 10,
      attempts: 0,
      lastAttemptAt: 0,
    },
    over,
  )

const at = (hh, mm) => new Date(2026, 10, 4, hh, mm, 0).getTime()
const s = startMs('2026-11-04', '17:30')

console.log('=== 状态 ===')
{
  check('还没到点是 pending', statusOf(ev(), at(17, 0)) === 'pending', statusOf(ev(), at(17, 0)))
  check('该提醒了还是 pending', statusOf(ev(), at(17, 25)) === 'pending', statusOf(ev(), at(17, 25)))
  check('开始超过 30 分钟是 missed', statusOf(ev(), s + MISSED_AFTER_MS + 1) === 'missed', statusOf(ev(), s + MISSED_AFTER_MS + 1))
  check('刚好 30 分钟还算 pending', statusOf(ev(), s + MISSED_AFTER_MS) === 'pending', statusOf(ev(), s + MISSED_AFTER_MS))
  check('弹过就是 reminded', statusOf(ev({ attempts: 1 }), at(17, 25)) === 'reminded')
  check('弹过之后即使很久也是 reminded', statusOf(ev({ attempts: 1 }), s + 10 * 3600_000) === 'reminded')
}

console.log('\n=== 错过的不再弹 ===')
{
  const data = { events: [ev()] }
  check('刚开始半小时内还会弹', pendingReminders(data, s + 20 * 60_000).length === 1, String(pendingReminders(data, s + 20 * 60_000).length))
  check('超过半小时就不弹了', pendingReminders(data, s + MISSED_AFTER_MS + 60_000).length === 0)
}

console.log('\n=== 舰长的场景:电脑一直没开机,开机时已经过了半小时 ===')
{
  // 17:20 该提醒,但 18:40 才开机(开始后 70 分钟)
  const data = { events: [ev()] }
  const bootAt = at(18, 40)
  check('不弹', pendingReminders(data, bootAt).length === 0)
  check('界面标成错过', statusOf(data.events[0], bootAt) === 'missed', statusOf(data.events[0], bootAt))
}

console.log('\n=== ack 幂等 ===')
{
  const data = { events: [ev()] }
  ackReminder(data, 'e1', at(17, 25))
  check('第一次记成 1', data.events[0].attempts === 1, String(data.events[0].attempts))
  const firstAt = data.events[0].lastAttemptAt
  ackReminder(data, 'e1', at(17, 26))
  check('第二次不再累加', data.events[0].attempts === 1, String(data.events[0].attempts))
  check('时间戳也不被覆盖', data.events[0].lastAttemptAt === firstAt)
  check('ack 不存在的返回 false', ackReminder(data, 'nope') === false)
}

rmSync(join(tmpdir(), 'x'), { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS')
if (failures) process.exit(1)
