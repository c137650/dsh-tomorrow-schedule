/**
 * 日程的存储。
 *
 * 一个 JSON 文件,结构刻意和原来那版保持一致 ——
 * 旧数据(profiles/<profile>/day-schedule/events.json)可以直接读,不用迁移。
 *
 *   { "version": 1,
 *     "events": [ { id, title, note, date, start, end, leadMinutes,
 *                   createdAt, attempts, lastAttemptAt } ] }
 *
 * 三条硬规则(由 addEvent 保证,客户端再挡一次):
 *   1. 只能安排**今天和明天**。别的日期一律拒绝。
 *   2. 过了这一天就清空 —— 每次读写顺手把更早的删掉。
 *   3. start 必填,end / note 可选。
 *
 * 另外:**文件里始终按开始时刻排好序**。
 * 舰长的要求:"不论添加顺序是什么,列表里的事件总是按时间顺序排列"。
 * 读的时候排一次不够 —— 写进去的时候也排,这样文件本身就是有序的,
 * 拿记事本打开看也是整齐的。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const VERSION = 1

/** 本地日期 YYYY-MM-DD。用本地时间,不用 UTC —— 日程是给人看的。 */
export function localDate(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 今天是几号 / 明天是几号。 */
export function todayISO(now = Date.now()) {
  return localDate(new Date(now))
}
export function tomorrowISO(now = Date.now()) {
  return localDate(new Date(now + 86400_000))
}

/**
 * 允许安排的日子:今天和明天。
 *
 * 原来只能安排明天,后来舰长要能安排当天 ——
 * 于是从"一个日子"变成"两个",但仍然是**有限**的两天:
 * 再往后的日程没意义(隔天的事等隔天再记),再往前的已经过去了。
 */
export function allowedDates(now = Date.now()) {
  return [todayISO(now), tomorrowISO(now)]
}

/** "2026-11-05" + "09:30" -> 本地时间戳。 */
export function startMs(date, start) {
  const [y, m, d] = String(date).split('-').map(Number)
  const [hh, mm] = String(start).split(':').map(Number)
  if (![y, m, d, hh, mm].every((n) => Number.isFinite(n))) return NaN
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime()
}

/** HH:MM 格式检查。 */
function validTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}

export function loadEvents(file) {
  try {
    if (!existsSync(file)) return { version: VERSION, events: [] }
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const events = Array.isArray(raw?.events) ? raw.events : []
    return { version: VERSION, events: events.filter((e) => e && typeof e.id === 'string' && e.date && e.start) }
  } catch {
    // 文件坏了不能让整个插件不工作 —— 当作空的,但先备份一份
    try {
      const bad = readFileSync(file, 'utf8')
      writeFileSync(file + '.broken-' + Date.now(), bad, 'utf8')
    } catch {
      /* ignore */
    }
    return { version: VERSION, events: [] }
  }
}

export function saveEvents(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

/**
 * 清掉过期的日程。
 *
 * 舰长的要求:"每一天的日程会在过了这一天之后清空"。
 * 所以在任何读写之前都先跑一次 —— 不依赖"定时任务刚好跑过"。
 */
export function prunePast(data, now = Date.now()) {
  const today = todayISO(now)
  const before = data.events.length
  data.events = data.events.filter((e) => e.date >= today)
  return before - data.events.length
}

/**
 * 加一条日程。
 *
 * 日期只能是今天或明天 —— 由服务端定,不信客户端传来的日期。
 * 客户端不传日期时默认明天(兼容老客户端)。
 *
 * @returns {{ok:true, event:object} | {ok:false, code:string}}
 */
export function addEvent(data, input, now = Date.now()) {
  const allowed = allowedDates(now)
  const title = String(input?.title ?? '').trim()
  const start = String(input?.start ?? '').trim()
  const end = String(input?.end ?? '').trim()
  const note = String(input?.note ?? '').trim()
  const leadMinutes = Number(input?.leadMinutes ?? 10)
  const date = String(input?.date ?? '').trim() || allowed[1]

  if (!title) return { ok: false, code: 'no-title' }
  if (title.length > 200) return { ok: false, code: 'title-too-long' }
  if (!allowed.includes(date)) return { ok: false, code: 'bad-date' }
  if (!validTime(start)) return { ok: false, code: 'bad-start' }
  if (end && !validTime(end)) return { ok: false, code: 'bad-end' }
  if (end && end < start) return { ok: false, code: 'end-before-start' }
  if (!Number.isFinite(leadMinutes) || leadMinutes < 0 || leadMinutes > 720) {
    return { ok: false, code: 'bad-lead' }
  }
  if (note.length > 4000) return { ok: false, code: 'note-too-long' }

  const event = {
    id: 'evt-' + Date.now().toString(36) + '-' + randomUUID().slice(0, 6),
    title,
    note,
    date,
    start,
    end,
    leadMinutes: Math.round(leadMinutes),
    createdAt: new Date(now).toISOString(),
    attempts: 0,
    lastAttemptAt: 0,
  }
  data.events.push(event)
  // 写进去就排好序 —— 文件本身是整齐的,不只是读出来的时候排。
  data.events = sortEvents(data.events)
  return { ok: true, event }
}

/** 删一条。 */
export function removeEvent(data, id) {
  const before = data.events.length
  data.events = data.events.filter((e) => e.id !== id)
  return data.events.length !== before
}

/**
 * 把一条挪到另一天。
 *
 * 为什么要这个功能:页签是"今天 / 明天",点错了东西就落错天了。
 * 以前只能删了重加 —— 但重加会换 id、清掉"已提醒"的记录,
 * 而且时刻要重新敲一遍。自己挪一下就完了。
 *
 * 挪的目标也只允许今天和明天 —— 和 addEvent 同一套规矩。
 *
 * @returns {{ok:true, event:object} | {ok:false, code:string}}
 */
export function moveEvent(data, id, targetDate, now = Date.now()) {
  const allowed = allowedDates(now)
  const date = String(targetDate ?? '').trim()
  if (!allowed.includes(date)) return { ok: false, code: 'bad-date' }
  const e = data.events.find((x) => x.id === id)
  if (!e) return { ok: false, code: 'no-such-event' }
  e.date = date
  // 挪完重新排 —— 文件本身要保持按时间顺序
  data.events = sortEvents(data.events)
  return { ok: true, event: e }
}

/**
 * 按开始时刻排序,给界面用。
 *
 * 舰长的要求:"不论添加顺序是什么,列表里的事件总是按时间顺序排列"。
 *
 * 排序键是 (日期, 开始时刻) 两段分开比,而不是拼成字符串 ——
 * 拼起来也能用("2026-11-1208:00"),但分开比更不容易在将来改格式时踩坑。
 * 同一时刻的按加入顺序排(Array.prototype.sort 在 V8 里是稳定的)。
 */
export function sortEvents(events) {
  return [...events].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    if (a.start !== b.start) return a.start < b.start ? -1 : 1
    return 0
  })
}

/**
 * 一条日程现在是什么状态。
 *
 *   reminded  已经弹过(界面上标「已提醒」)
 *   missed    错过了 —— 开始超过 30 分钟还没弹成,以后也不再弹(界面上标「错过」)
 *   pending   还没到点,或者到点了还没弹
 *
 * 舰长的场景:电脑一直没开机,等开机时事情早就开始半小时了。
 * 这时候再弹一个"吃饭"没有意义,只该在界面上标一句错过。
 */
export const MISSED_AFTER_MS = 30 * 60_000

export function statusOf(e, now = Date.now()) {
  if (Number(e.attempts) > 0) return 'reminded'
  const s = startMs(e.date, e.start)
  if (!Number.isFinite(s)) return 'pending'
  if (now - s > MISSED_AFTER_MS) return 'missed'
  return 'pending'
}

/**
 * 现在该弹的提醒。
 *
 * 三条边界:
 *   - **开始超过 30 分钟就不再提醒**,交给界面标"错过"
 *   - **早已过期的不要弹**:DSH 关了一整夜,第二天开机不该把昨晚的提醒全倒出来
 *   - **弹过就不再弹**:attempts 记着弹过没有
 */
export function pendingReminders(data, now = Date.now(), options = {}) {
  const graceMs = options.graceMs ?? 12 * 3600_000
  const due = []
  for (const e of data.events) {
    const s = startMs(e.date, e.start)
    if (!Number.isFinite(s)) continue
    // 开始已经过了 30 分钟 —— 不提醒了
    if (now - s > MISSED_AFTER_MS) continue
    const remindAt = s - Math.max(0, Number(e.leadMinutes) || 0) * 60_000
    if (now < remindAt) continue
    if (now - remindAt > graceMs) continue
    if (Number(e.attempts) > 0) continue
    due.push({ ...e, remindAt })
  }
  return due.sort((a, b) => a.remindAt - b.remindAt)
}

/**
 * 客户端确认已看到。
 *
 * 幂等:已经记过就不再累加 —— 浏览器弹窗和原生窗口可能同时报备,
 * 那不该让一条日程被记成"提醒了两次"。
 */
export function ackReminder(data, id, now = Date.now()) {
  const e = data.events.find((x) => x.id === id)
  if (!e) return false
  if (Number(e.attempts) > 0) return true
  e.attempts = 1
  e.lastAttemptAt = now
  return true
}
