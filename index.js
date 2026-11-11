/**
 * dsh-tomorrow-schedule — Host 半边。
 *
 * 舰长的要求:
 *   1. 侧边栏出现「日程」,点进去能用     —— 见 client.js(sidebar.panellist + main)
 *   2. 只能安排明天                      —— addEvent 用服务端的"明天",不信客户端
 *   3. 过了这一天就清空                  —— 每次读写前先 prunePast
 *   4. 标题 + 开始时刻 + 可选结束/备注   —— addEvent
 *   5. 提前 N 分钟提醒                   —— pendingReminders
 *   6. 和 DSH 主题一致的弹窗,手动关闭   —— 客户端弹窗,这里只算"该弹了没有"
 *   7. 列表和弹窗都能滚                  —— 客户端 CSS
 *
 * 数据文件:%DSH_HOME%/dsh-plugin-tomorrow-schedule/events.json
 *
 * 为什么不放回 <profile>/day-schedule/:
 *   profile 会换名字、会被重建,数据不该跟着插件的安装位置走。
 *   但第一次启动时会去 profiles/<各个 profile>/day-schedule/events.json
 *   找旧数据搬过来,所以老用户不会丢日程。
 */

import { readFileSync, existsSync, mkdirSync, readdirSync, appendFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  loadEvents,
  saveEvents,
  prunePast,
  addEvent,
  removeEvent,
  sortEvents,
  pendingReminders,
  ackReminder,
  statusOf,
  todayISO,
  tomorrowISO,
  allowedDates,
} from './lib/store.js'
import { showReminder, showToast } from './lib/popup.js'

const MODULE = '[dsh-tomorrow-schedule]'
const PREFIX = '/dsh-tomorrow-schedule'

function dshHome() {
  return process.env.DSH_HOME || path.join(homedir(), '.dsh')
}

function dataFile() {
  return path.join(dshHome(), 'dsh-plugin-tomorrow-schedule', 'events.json')
}

function log(...args) {
  console.log(MODULE, ...args)
}

/**
 * 把旧版数据搬过来。
 *
 * 旧版把 events.json 放在 <profile>/day-schedule/ 里。
 * 只在目标文件**不存在**时搬一次,而且只搬还没过期的。
 */
function migrateLegacy(target) {
  if (existsSync(target)) return 0
  const profilesDir = path.join(dshHome(), 'profiles')
  try {
    if (!existsSync(profilesDir)) return 0
    for (const name of readdirSync(profilesDir)) {
      const legacy = path.join(profilesDir, name, 'day-schedule', 'events.json')
      if (!existsSync(legacy)) continue
      const data = loadEvents(legacy)
      prunePast(data, Date.now())
      mkdirSync(path.dirname(target), { recursive: true })
      saveEvents(target, data)
      log('migrated', data.events.length, 'events from', legacy)
      return data.events.length
    }
  } catch (e) {
    log('migrate skipped:', String((e && e.message) || e))
  }
  return 0
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > 256 * 1024) {
        req.destroy()
        resolve(null)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? JSON.parse(text) : {})
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

export default {
  inject: ['webServer'],

  apply(ctx) {
    const file = dataFile()

    /**
     * 这个进程已经开过窗口的 id。
     *
     * 为什么需要:客户端的 bundle 在某些启动路径上会被挂载两次
     * (boot loader + cordis 组合各一次 —— theme-endfield 的源码注释里也写了这一条)。
     * 两个实例各自轮询 /pending,就会对同一条提醒各叫一次 /notify。
     *
     * 只靠文件里的 attempts 挡不住:两个请求可能先后读到 attempts=0,
     * 各自 ack 再各自开窗(读-改-写之间没有锁)。所以进程内存里再记一份。
     */
    const notified = new Set()

    /**
     * 提醒的流水日志。
     *
     * 为什么要有:提醒走了哪条路(界面弹窗 / 原生窗口 / 系统通知),
     * 之前只能靠猜 —— DSH 的 GUI 里看不到插件日志。
     * 现在每次弹窗都往这里写一行,排查时直接看这个文件。
     */
    const logFile = path.join(path.dirname(file), 'popup.log')
    function appendLog(line) {
      try {
        const stamp = new Date().toISOString()
        appendFileSync(logFile, stamp + ' ' + line + '\n', 'utf8')
        // 文件别无限长:留最近 300 行就够
        const raw = readFileSync(logFile, 'utf8').split('\n')
        if (raw.length > 320) {
          writeFileSync(logFile, raw.slice(raw.length - 300).join('\n'), 'utf8')
        }
      } catch {
        /* 日志写不出去也不能影响提醒 */
      }
    }
    appendLog('--- 插件启动 ' + new Date().toISOString() + ' ---')

    // 每次读写都从磁盘读一遍 —— 文件很小,不做缓存就不会有一致性问题。
    function withData(fn) {
      const data = loadEvents(file)
      prunePast(data, Date.now())
      const result = fn(data)
      saveEvents(file, data)
      return result
    }

    const routes = [
      {
        path: PREFIX + '/list',
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, code: 'method' })
            return
          }
          const out = withData((data) => {
            const now = Date.now()
            return {
              today: todayISO(),
              tomorrow: tomorrowISO(),
              // 可安排的日子:今天和明天。客户端的切换页就是照这个来的。
              days: allowedDates(),
              // 每条带上状态:界面要标「已提醒」/「错过」
              events: sortEvents(data.events).map((e) => ({ ...e, status: statusOf(e, now) })),
            }
          })
          sendJson(res, 200, { ok: true, ...out })
        },
      },
      {
        path: PREFIX + '/add',
        handler: async (req, res) => {
          const body = await readJsonBody(req)
          if (body === null) {
            sendJson(res, 400, { ok: false, code: 'bad-json' })
            return
          }
          const result = withData((data) => addEvent(data, body, Date.now()))
          if (!result.ok) {
            sendJson(res, 400, { ok: false, code: result.code })
            return
          }
          log('added', result.event.date, result.event.start, result.event.title.slice(0, 30))
          // date 是这条日程落在哪一天;tomorrow 保留是为了兼容老客户端。
          sendJson(res, 200, {
            ok: true,
            event: result.event,
            date: result.event.date,
            tomorrow: result.event.date,
          })
        },
      },
      {
        path: PREFIX + '/remove',
        handler: async (req, res) => {
          const body = await readJsonBody(req)
          if (body === null || typeof body.id !== 'string') {
            sendJson(res, 400, { ok: false, code: 'bad-args' })
            return
          }
          const removed = withData((data) => removeEvent(data, body.id))
          sendJson(res, removed ? 200 : 404, { ok: removed })
        },
      },
      {
        path: PREFIX + '/pending',
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, code: 'method' })
            return
          }
          const events = withData((data) => pendingReminders(data, Date.now()))
          sendJson(res, 200, { ok: true, events })
        },
      },
      {
        path: PREFIX + '/ack',
        handler: async (req, res) => {
          const body = await readJsonBody(req)
          if (body === null || typeof body.id !== 'string') {
            sendJson(res, 400, { ok: false, code: 'bad-args' })
            return
          }
          const ok = withData((data) => ackReminder(data, body.id, Date.now()))
          sendJson(res, 200, { ok })
        },
      },
      {
        // 原生置顶窗口。
        //
        // 什么时候用:DSH 不在前台(窗口在别的程序后面、或者标签页被切走)。
        // 浏览器弹窗这时候看不见,所以让客户端叫这里开一个 WinForms 窗口 ——
        // 置顶、进任务栏、只能点「知道了」关掉。
        //
        // 开出去就立刻记 attempts,免得同一个提醒被反复开窗。
        path: PREFIX + '/notify',
        handler: async (req, res) => {
          const body = await readJsonBody(req)
          const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === 'string') : []
          if (!ids.length) {
            sendJson(res, 400, { ok: false, code: 'bad-args' })
            return
          }
          const wanted = ids.filter((id) => !notified.has(id))
          if (!wanted.length) {
            sendJson(res, 200, { ok: true, opened: [], note: 'already-notified' })
            return
          }
          const picked = withData((data) => {
            const now = Date.now()
            const due = pendingReminders(data, now)
            const chosen = due.filter((e) => wanted.includes(e.id))
            for (const e of chosen) {
              ackReminder(data, e.id, now)
              notified.add(e.id)
            }
            return chosen
          })
          // 最多同时开 3 个窗口,再多就是骚扰了
          const opened = []
          for (let i = 0; i < Math.min(picked.length, 3); i++) {
            const ev = picked[i]
            // 两条路并行:
            //   系统通知 —— 独占全屏的视频窗口盖不住置顶窗口,只有通知层能穿透
            //   置顶窗口 —— 详情 + 只能手动关
            void showToast(ev, { onOutput: (line) => appendLog('  通知 ' + line) })
            const r = await showReminder(ev, {
              offsetIndex: i,
              onOutput: (line) => appendLog('  ' + line),
            })
            appendLog(
              `窗口 ${ev.id} ${ev.start} ${String(ev.title).slice(0, 24)} ` +
                `已开(ok=${r.ok !== false})`,
            )
            opened.push({ id: ev.id, ok: r.ok !== false })
          }
          if (picked.length) log('native popup:', opened.map((x) => x.id).join(','))
          sendJson(res, 200, { ok: true, opened })
        },
      },
    ]

    for (const r of routes) {
      ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: r.path, handler: r.handler }))
    }

    const migrated = migrateLegacy(file)
    log('host ready:', PREFIX + '/{list,add,remove,pending,ack,notify}', 'data=' + file, migrated ? `migrated=${migrated}` : '')
  },
}
