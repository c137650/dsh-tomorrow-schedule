/**
 * 把日程挪到另一天。
 *
 * 为什么需要:插件还没有"挪动"的功能,只有"加"和"删"。
 * 舰长在"今天"页签加的东西,因为宿主跑的是旧代码,全被写到了明天 ——
 * 那几条本来是今天的事,得挪回来。
 *
 * 直接改文件是有竞争的:宿主每 20 秒读一次写一次(events.json 很小,
 * 不缓存就是为了不有一致性问题)。所以写完要盯着,确认没被覆盖回去。
 *
 * 用法: node tools/move_events.mjs <日期> [id 前缀...]
 *        node tools/move_events.mjs --all <日期>     把所有事件都挪过去
 */
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = 'C:\\Users\\34230\\.dsh\\dsh-plugin-tomorrow-schedule\\events.json'
const args = process.argv.slice(2)
const all = args[0] === '--all'
const target = all ? args[1] : args[0]
const prefixes = all ? [] : args.slice(1)

if (!target) {
  console.error('用法: node tools/move_events.mjs <日期> [id 前缀...] | --all <日期>')
  process.exit(2)
}

const data = JSON.parse(readFileSync(FILE, 'utf8'))
console.log('挪之前:')
for (const e of data.events) console.log('  ' + e.date + ' ' + e.start + '  ' + e.title)

const moved = []
for (const e of data.events) {
  if (e.date === target) continue
  if (!all && !prefixes.some((p) => e.id.startsWith(p))) continue
  const from = e.date
  e.date = target
  moved.push(e.title + ' (' + from + ' → ' + target + ')')
}

// 挪完重新排 —— 文件本身要保持按时间顺序
data.events.sort((a, b) => {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  if (a.start !== b.start) return a.start < b.start ? -1 : 1
  return 0
})

writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8')

console.log('\n挪了 ' + moved.length + ' 条:')
for (const m of moved) console.log('  ' + m)
console.log('\n挪之后:')
for (const e of data.events) console.log('  ' + e.date + ' ' + e.start + '  ' + e.title)
