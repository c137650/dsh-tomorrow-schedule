/** 日程存储层的规则测试。不依赖 DSH,纯函数。 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  loadEvents,
  saveEvents,
  prunePast,
  addEvent,
  removeEvent,
  moveEvent,
  sortEvents,
  pendingReminders,
  ackReminder,
  todayISO,
  tomorrowISO,
  startMs,
} from '../lib/store.js'

let failures = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log('  PASS  ' + name)
  else {
    failures++
    console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : ''))
  }
}

const dir = mkdtempSync(join(tmpdir(), 'tsched-'))
const file = join(dir, 'events.json')
// 固定一个"现在":2026-11-04 21:30 本地时间
const NOW = new Date(2026, 10, 4, 21, 30, 0).getTime()
const DAY = 86400_000

console.log('=== 日期 ===')
check('今天是 2026-11-04', todayISO(NOW) === '2026-11-04', todayISO(NOW))
check('明天是 2026-11-05', tomorrowISO(NOW) === '2026-11-05', tomorrowISO(NOW))
check('跨月也对', tomorrowISO(new Date(2026, 10, 30, 10, 0).getTime()) === '2026-12-01', tomorrowISO(new Date(2026, 10, 30, 10, 0).getTime()))

console.log('\n=== 只能安排今天和明天(默认还是明天) ===')
{
  const data = loadEvents(file)
  const ok = addEvent(data, { title: '选课', start: '20:00' }, NOW)
  check('加一条成功', ok.ok === true, JSON.stringify(ok))
  check('不传日期就是明天', ok.event?.date === '2026-11-05', ok.event?.date)
  check('默认提前 10 分钟', ok.event?.leadMinutes === 10, String(ok.event?.leadMinutes))
  check('end/note 可以留空', ok.event?.end === '' && ok.event?.note === '', JSON.stringify(ok.event))
}

console.log('\n=== 参数校验 ===')
{
  const data = loadEvents(file)
  const cases = [
    [{ title: '', start: '10:00' }, 'no-title'],
    [{ title: '   ', start: '10:00' }, 'no-title'],
    [{ title: 'x', start: '' }, 'bad-start'],
    [{ title: 'x', start: '25:00' }, 'bad-start'],
    [{ title: 'x', start: '9:00' }, 'bad-start'],
    [{ title: 'x', start: '10:00', end: '09:00' }, 'end-before-start'],
    [{ title: 'x', start: '10:00', end: 'bad' }, 'bad-end'],
    [{ title: 'x', start: '10:00', leadMinutes: -1 }, 'bad-lead'],
    [{ title: 'x', start: '10:00', leadMinutes: 9999 }, 'bad-lead'],
  ]
  let allOk = true
  for (const [input, code] of cases) {
    const r = addEvent(data, input, NOW)
    if (r.ok || r.code !== code) {
      allOk = false
      console.log('    ' + code + ' 没被挡住:' + JSON.stringify(input) + ' -> ' + JSON.stringify(r))
    }
  }
  check('九种坏输入都被挡住', allOk)
}

console.log('\n=== 过了这一天就清空 ===')
{
  const data = loadEvents(file)
  addEvent(data, { title: '明天的', start: '09:00' }, NOW)
  // 手动塞一条"今天"和一条"前天",模拟跨天之后的样子
  data.events.push({ id: 'a', title: '今天的', date: '2026-11-04', start: '08:00', leadMinutes: 0, attempts: 0 })
  data.events.push({ id: 'b', title: '前天的', date: '2026-11-02', start: '08:00', leadMinutes: 0, attempts: 0 })
  const removed = prunePast(data, NOW)
  check('只删掉 1 条过期的', removed === 1, String(removed))
  check('明天的还在', data.events.some((e) => e.date === '2026-11-05'))
  // 今天的事要留到"今天过完"才清 —— 这是"过了这一天之后清空"的含义
  check('今天的还在(还没过完)', data.events.some((e) => e.title === '今天的'), JSON.stringify(data.events.map((e) => e.title)))
  check('前天的没了', !data.events.some((e) => e.title === '前天的'))
  check('剩两条', data.events.length === 2, JSON.stringify(data.events.map((e) => e.title)))

  // 明天再看:今天的应该被清掉,只剩明天的
  const later = (function () {
    const copy = { events: data.events.map((e) => ({ ...e })) }
    prunePast(copy, NOW + 24 * 3600_000)
    return copy
  })()
  check('到了第二天,今天那条被清掉', later.events.length === 1, JSON.stringify(later.events.map((e) => e.title)))
  check('第二天时"明天的"变成了今天,仍保留', later.events[0].title === '明天的')
}

console.log('\n=== 能安排今天和明天 ===')
{
  const data = loadEvents(file)
  const t = addEvent(data, { title: '今天的事', start: '20:00', date: '2026-11-04' }, NOW)
  check('加到今天成功', t.ok === true, JSON.stringify(t))
  check('日期就是今天', t.event?.date === '2026-11-04', t.event?.date)

  const m = addEvent(data, { title: '明天的事', start: '20:00', date: '2026-11-05' }, NOW)
  check('加到明天成功', m.ok === true, JSON.stringify(m))
  check('日期就是明天', m.event?.date === '2026-11-05', m.event?.date)

  const legacy = addEvent(data, { title: '不传日期', start: '20:00' }, NOW)
  check('不传日期默认明天(兼容老客户端)', legacy.event?.date === '2026-11-05', legacy.event?.date)

  // 别的日期一律拒绝
  const bad = [
    ['2026-11-03', '前天'],
    ['2026-11-06', '后天'],
    ['2027-01-01', '明年'],
    ['乱写', '不是日期'],
  ]
  let allBlocked = true
  for (const [d, why] of bad) {
    const r = addEvent(data, { title: 'x', start: '10:00', date: d }, NOW)
    if (r.ok || r.code !== 'bad-date') {
      allBlocked = false
      console.log('    ' + why + ' 没被挡住:' + JSON.stringify(r))
    }
  }
  check('今天/明天以外都挡住', allBlocked)
}

console.log('\n=== 不论添加顺序,列表总是按时间排 ===')
{
  const data = loadEvents(file)
  // 乱着加
  addEvent(data, { title: '晚', start: '20:00', date: '2026-11-05' }, NOW)
  addEvent(data, { title: '早', start: '08:00', date: '2026-11-05' }, NOW)
  addEvent(data, { title: '中', start: '12:00', date: '2026-11-05' }, NOW)
  addEvent(data, { title: '今天早上', start: '07:00', date: '2026-11-04' }, NOW)
  addEvent(data, { title: '今天晚上', start: '21:00', date: '2026-11-04' }, NOW)

  const order = data.events.map((e) => e.title).join(',')
  check(
    '文件里就是排好的(今天的在前,各自按时间)',
    order === '今天早上,今天晚上,早,中,晚',
    order,
  )

  const sorted = sortEvents(data.events).map((e) => e.title).join(',')
  check('sortEvents 也是同一个顺序', sorted === '今天早上,今天晚上,早,中,晚', sorted)

  // 同一时刻的按加入顺序排(稳定)
  const same = {
    events: [
      { id: 'a', date: '2026-11-05', start: '10:00', title: '先' },
      { id: 'b', date: '2026-11-05', start: '10:00', title: '后' },
    ],
  }
  check('同一时刻保持加入顺序', sortEvents(same.events).map((e) => e.title).join(',') === '先,后')
}

console.log('\n=== 挪到另一天 ===')
{
  const data = loadEvents(file)
  const a = addEvent(data, { title: '要挪的', start: '10:00', date: '2026-11-04' }, NOW)
  const id = a.event.id
  const m = moveEvent(data, id, '2026-11-05', NOW)
  check('挪成功', m.ok === true, JSON.stringify(m))
  check('日期变成明天', m.event?.date === '2026-11-05', m.event?.date)
  check('库里的也是明天', data.events[0].date === '2026-11-05', data.events[0].date)

  check('挪到不存在的日子被挡', moveEvent(data, id, '2026-11-09', NOW).code === 'bad-date')
  check('挪不存在的条目被挡', moveEvent(data, 'nope', '2026-11-05', NOW).code === 'no-such-event')

  // 挪完仍然按时间排
  const b = addEvent(data, { title: '早的', start: '08:00', date: '2026-11-05' }, NOW)
  check('挪完仍然按时间排', data.events.map((e) => e.start).join(',') === '08:00,10:00', data.events.map((e) => e.start).join(','))
}

console.log('\n=== 排序 ===')
{
  const data = { events: [
    { id: '1', date: '2026-11-05', start: '20:00', title: '晚' },
    { id: '2', date: '2026-11-05', start: '08:00', title: '早' },
    { id: '3', date: '2026-11-05', start: '12:00', title: '中' },
  ] }
  check('按开始时间排', sortEvents(data.events).map((e) => e.title).join(',') === '早,中,晚', sortEvents(data.events).map((e) => e.title).join(','))
}

console.log('\n=== 提醒什么时候弹 ===')
{
  // 明天 10:00 的事,提前 10 分钟 -> 09:50 该弹
  const base = {
    id: 'e1',
    title: '开会',
    date: '2026-11-05',
    start: '10:00',
    end: '',
    leadMinutes: 10,
    attempts: 0,
    lastAttemptAt: 0,
  }
  const data = { events: [base] }
  const remindAt = startMs('2026-11-05', '10:00') - 10 * 60_000
  check('提前一分钟还不弹', pendingReminders(data, remindAt - 60_000).length === 0)
  check('到点就弹', pendingReminders(data, remindAt).length === 1, String(pendingReminders(data, remindAt).length))
  check('开始之后还在宽限内也弹', pendingReminders(data, remindAt + 30 * 60_000).length === 1)

  // 关了一夜:提醒时刻已经过去 13 小时 -> 不再倒出来
  check('过了 12 小时不再弹', pendingReminders(data, remindAt + 13 * 3600_000).length === 0)
  // 开始后 3 小时也不弹
  check('开始后超过 2 小时不再弹', pendingReminders(data, remindAt + 3 * 3600_000).length === 0)

  check('确认后不再弹', (function () {
    ackReminder(data, 'e1', remindAt)
    return pendingReminders(data, remindAt + 60_000).length === 0
  })(), JSON.stringify(data.events[0]))

  // 不提醒的
  const noLead = { events: [Object.assign({}, base, { id: 'e2', leadMinutes: 0, attempts: 0 })] }
  check('提前 0 分钟就是到点弹', pendingReminders(noLead, startMs('2026-11-05', '10:00')).length === 1)
  check('提前 0 分钟在开始前不弹', pendingReminders(noLead, startMs('2026-11-05', '10:00') - 60_000).length === 0)
}

console.log('\n=== 删除 ===')
{
  const data = loadEvents(file)
  addEvent(data, { title: '要删的', start: '10:00' }, NOW)
  const id = data.events[0].id
  check('删掉返回 true', removeEvent(data, id) === true)
  check('删光了', data.events.length === 0)
  check('删不存在的返回 false', removeEvent(data, 'nope') === false)
}

console.log('\n=== 读写文件 ===')
{
  const data = loadEvents(file)
  addEvent(data, { title: '写盘', start: '10:00' }, NOW)
  saveEvents(file, data)
  const back = loadEvents(file)
  check('读回来还在', back.events.length === 1 && back.events[0].title === '写盘', JSON.stringify(back.events))
}

console.log('\n=== 文件坏了不炸 ===')
{
  writeFileSync(file, '{ 这不是 json', 'utf8')
  const back = loadEvents(file)
  check('当成空库', Array.isArray(back.events) && back.events.length === 0)
}

rmSync(dir, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS')
if (failures) process.exit(1)
