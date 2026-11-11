/**
 * dsh-tomorrow-schedule — Client 半边。
 *
 * 挂两个 slot(名字取自 DSH 客户端的 slot 目录,dsh-cordis-client-runner 里有全表):
 *
 *   sidebar.panellist  [list]  "Global panel icons" —— 侧边栏那个图标按钮
 *   main               [keyed] "Central panel selected by sidebar entry id"
 *
 * 两个用同一个 id('tomorrow-schedule'):**列表的 id 就是它选中的中央面板 key**。
 * 点了图标,中央栏就换成我们的页面 —— 这就是"点进去能用"。
 *
 * 提醒:客户端每 20 秒问一次 /pending。有该弹的就弹一个整屏遮罩,
 * 必须点「知道了」才关(顺便 POST /ack 记账)。DSH 没开着就不会弹 ——
 * 这一点和原来那版的原生弹窗不同,是刻意的取舍:避免在系统里放常驻进程。
 *
 * 主题一致:全部用 DSH 的 CSS 变量 --dsw-alias-*,和 dsh-session-delete 同一套。
 */

window.__ModuleLoader__.load({
  // 这个 id 必须和组合行(profile 的 cordis.patch.yml / package 名)完全一致,
  // 否则 loader 找不到它 —— session-delete 的注释里也写着同一条。
  id: 'dsh-tomorrow-schedule',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var React = null
    try {
      React = require('react')
    } catch (e) {
      React = null
    }

    var h = React ? React.createElement : null
    var PREFIX = '/dsh-tomorrow-schedule'
    var PANEL_ID = 'tomorrow-schedule'
    var POLL_MS = 20000

    // ---------- 网络 ----------

    function api(path, options) {
      return fetch(PREFIX + path, options).then(function (r) {
        return r.json().catch(function () {
          return { ok: false, code: 'bad-response' }
        })
      })
    }

    function postJson(path, body) {
      return api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    // ---------- 文案 ----------

    var MESSAGES = {
      'no-title': '标题不能为空',
      'title-too-long': '标题太长了',
      'bad-date': '只能安排今天或者明天',
      'no-such-event': '这条已经不在了',
      'bad-start': '开始时间格式不对',
      'bad-end': '结束时间格式不对',
      'end-before-start': '结束时间不能早于开始时间',
      'bad-lead': '提前提醒的分钟数不对',
      'note-too-long': '备注太长了',
      'bad-json': '请求格式错误',
      'bad-args': '参数不对',
    }

    function messageOf(code) {
      return MESSAGES[code] || '出错了:' + code
    }

    function timeRange(e) {
      return e.end ? e.start + ' – ' + e.end : e.start
    }

    // ---------- 样式 ----------
    //
    // 只用 DSH 主题里**确实存在**的那几个变量(和 dsh-session-delete 同一套),
    // 兜底值取浅色主题的近似值。
    //
    // 上一版踩过的坑:输入框用了 --dsw-alias-interactive-bg,这个变量在本主题里不存在,
    // 于是落到深色兜底 #17171b —— 在浅色页面上就是几个纯黑方块,字都看不见。
    // 兜底值必须和页面同色系,不能赌深色。

    var CSS = [
      '.tsched{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary,#1a1a1a);}',
      '.tsched-head{padding:18px 22px 8px;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;}',
      '.tsched-title{font-size:17px;font-weight:600;margin:0;}',
      '.tsched-date{font-size:13px;color:var(--dsw-alias-label-secondary,#555);}',
      // 页签:今天 / 明天。舰长的要求 —— 点哪个就切到哪一天,
      // 添加和列表都跟着当前这一天走。
      '.tsched-tabs{display:inline-flex;gap:3px;padding:3px;border-radius:9px;background:rgba(127,127,127,.10);border:1px solid var(--dsw-alias-border-l,rgba(0,0,0,.10));}',
      '.tsched-tab{height:26px;padding:0 13px;border:none;border-radius:7px;background:transparent;font-size:12px;font-family:inherit;color:var(--dsw-alias-label-secondary,#555);cursor:pointer;white-space:nowrap;}',
      '.tsched-tab:hover{color:var(--dsw-alias-label-primary,#1a1a1a);}',
      '.tsched-tab.is-active{background:var(--dsw-alias-button-elevated-fill,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.10);}',
      '.tsched-tab-date{opacity:.7;font-weight:400;margin-left:5px;}',
      '.tsched-hint{font-size:12px;color:var(--dsw-alias-label-secondary,#555);opacity:.76;margin:0 22px 10px;}',
      '.tsched-form{display:grid;grid-template-columns:minmax(140px,1fr) 104px 104px 100px auto;gap:8px;padding:0 22px 12px;align-items:center;}',
      '@media (max-width:860px){.tsched-form{grid-template-columns:1fr 1fr;}}',
      '.tsched-input,.tsched-note,.tsched-select{height:34px;padding:0 10px;border-radius:8px;font-size:13px;font-family:inherit;box-sizing:border-box;background:rgba(127,127,127,.10);color:inherit;border:1px solid var(--dsw-alias-border-l,rgba(0,0,0,.14));outline:none;min-width:0;}',
      '.tsched-note{grid-column:1/-1;height:auto;min-height:34px;padding:8px 10px;resize:vertical;max-height:110px;line-height:18px;}',
      '.tsched-input::placeholder,.tsched-note::placeholder{color:var(--dsw-alias-label-secondary,#555);opacity:.7;}',
      '.tsched-input:focus,.tsched-note:focus,.tsched-select:focus{border-color:#2f6fed;background:rgba(127,127,127,.15);}',
      '.tsched-btn{height:34px;padding:0 14px;border-radius:8px;font-size:13px;font-family:inherit;cursor:pointer;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l,rgba(0,0,0,.14));background:transparent;color:inherit;white-space:nowrap;}',
      '.tsched-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));}',
      '.tsched-btn-primary{background:#2f6fed;border-color:#2f6fed;color:#fff;}',
      '.tsched-btn-primary:hover{background:#2a63d4;border-color:#2a63d4;}',
      '.tsched-btn:disabled{opacity:.5;cursor:default;}',
      '.tsched-err{grid-column:1/-1;font-size:12px;color:var(--dsw-alias-state-error-primary,#d92d20);margin:0;}',
      '.tsched-list{flex:1;min-height:0;overflow-y:auto;padding:0 22px 22px;display:flex;flex-direction:column;gap:8px;}',
      '.tsched-empty{margin:24px 0;font-size:13px;color:var(--dsw-alias-label-secondary,#555);text-align:center;}',
      // 落在今天/明天之外的(正常不会有)—— 不藏起来,单放一栏
      '.tsched-other{margin-top:14px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l,rgba(0,0,0,.10));display:flex;flex-direction:column;gap:8px;}',
      '.tsched-other-head{font-size:12px;color:var(--dsw-alias-label-secondary,#555);margin:0;}',
      // 四列网格:时间 / 内容 / 状态 / 删除。每一行都对齐。
      '.tsched-row{display:grid;grid-template-columns:104px 1fr 62px auto 28px;gap:12px;align-items:start;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-button-elevated-fill,rgba(127,127,127,.07));border:1px solid var(--dsw-alias-border-l,rgba(0,0,0,.10));}',
      '.tsched-row.is-missed{opacity:.62;}',
      '.tsched-time{font-variant-numeric:tabular-nums;font-size:13px;font-weight:600;line-height:20px;white-space:nowrap;}',
      '.tsched-body{min-width:0;}',
      '.tsched-item-title{font-size:14px;line-height:20px;margin:0 0 2px;word-break:break-word;}',
      '.tsched-item-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#555);margin:0;white-space:pre-wrap;word-break:break-word;max-height:54px;overflow-y:auto;}',
      '.tsched-item-lead{font-size:11px;color:var(--dsw-alias-label-secondary,#555);opacity:.76;margin-top:4px;}',
      '.tsched-badge{justify-self:start;font-size:11px;line-height:18px;height:18px;padding:0 7px;border-radius:9px;white-space:nowrap;}',
      '.tsched-badge-pending{background:rgba(127,127,127,.16);color:var(--dsw-alias-label-secondary,#555);}',
      '.tsched-badge-reminded{background:rgba(47,111,237,.15);color:#2f6fed;}',
      '.tsched-badge-missed{background:rgba(217,45,32,.14);color:var(--dsw-alias-state-error-primary,#d92d20);}',
      '.tsched-del{justify-self:end;width:26px;height:26px;border-radius:7px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#555);cursor:pointer;font-size:16px;line-height:1;padding:0;}',
      '.tsched-del:hover{background:var(--dsw-alias-state-error-primary,#d92d20);color:#fff;}',
      // 「挪到另一天」:页签点错了的时候,一键挪回去,不用删了重加。
      '.tsched-move{justify-self:end;height:24px;padding:0 9px;border-radius:7px;font-size:11px;font-family:inherit;cursor:pointer;white-space:nowrap;border:1px solid var(--dsw-alias-border-l,rgba(0,0,0,.14));background:transparent;color:var(--dsw-alias-label-secondary,#555);}',
      '.tsched-move:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#1a1a1a);}',
      '.tsched-move:disabled{opacity:.45;cursor:default;}',

      // 弹窗
      '.tsched-overlay{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px;}',
      '.tsched-modal{width:min(460px,100%);max-height:min(72vh,560px);display:flex;flex-direction:column;border-radius:14px;padding:20px;background:var(--dsw-alias-button-elevated-fill,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);border:1px solid var(--dsw-alias-border-l,rgba(0,0,0,.12));box-shadow:0 18px 60px rgba(0,0,0,.35);}',
      '.tsched-modal-kicker{font-size:11px;letter-spacing:.08em;color:#2f6fed;margin:0 0 6px;}',
      '.tsched-modal-title{font-size:18px;font-weight:600;margin:0 0 6px;word-break:break-word;}',
      '.tsched-modal-time{font-size:13px;color:var(--dsw-alias-label-secondary,#555);margin:0 0 12px;font-variant-numeric:tabular-nums;}',
      '.tsched-modal-note{flex:1;min-height:0;overflow-y:auto;font-size:13px;line-height:20px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary,#555);margin:0 0 14px;padding-right:4px;}',
      '.tsched-modal-foot{display:flex;justify-content:flex-end;align-items:center;gap:10px;}',
    ].join('\n')

    function injectStyle() {
      var tag = document.createElement('style')
      tag.setAttribute('data-plugin', 'tomorrow-schedule')
      tag.textContent = CSS
      document.head.appendChild(tag)
      return tag
    }

    // ---------- 侧边栏图标 ----------

    function makeIcon(active) {
      // 一个日历轮廓。用 currentColor,跟着主题走。
      return h(
        'svg',
        {
          viewBox: '0 0 20 20',
          width: 18,
          height: 18,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: active ? 1.7 : 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('rect', { x: 3, y: 4.5, width: 14, height: 12, rx: 2.5 }),
        h('path', { d: 'M3 8.5h14' }),
        h('path', { d: 'M6.75 3v3M13.25 3v3' }),
        h('path', { d: 'M7 11.75h2.2M7 14.25h5.5' }),
      )
    }

    function PanelIcon(props) {
      var size = props && typeof props.size === 'number' ? props.size : 18
      var active = !!(props && props.active)
      return h(
        'span',
        {
          className: 'tsched-icon',
          style: {
            width: size + 'px',
            height: size + 'px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          },
          title: '日程',
        },
        makeIcon(active),
      )
    }

    // ---------- 主面板 ----------

    var LEAD_OPTIONS = [0, 5, 10, 15, 30, 60]

    /**
     * 排一下顺序。
     *
     * 服务端已经排过了,这里再排一次是双保险 ——
     * 舰长的要求是"不论添加顺序是什么,列表里的事件总是按时间顺序排列",
     * 那就别让显示顺序依赖任何一环是不是恰好做了。
     */
    function byTime(a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1
      if (a.start !== b.start) return a.start < b.start ? -1 : 1
      return 0
    }

    function Panel() {
      var s = React.useState({
        loading: true,
        events: [],
        tomorrow: '',
        today: '',
        error: '',
        busy: false,
        // 当前看的是哪一天:'today' 或 'tomorrow'。
        // 舰长的要求:点「今天」就切到当天,点「明天」就切到明天,
        // 添加和已有列表都跟着当前这一天走 —— 两边同步。
        //
        // 默认是**今天**:打开日程是想看"我要做什么",不是想看明天的计划。
        // 之前默认是明天,舰长说"从习惯上来讲,应该显示今天页面更好"。
        day: 'today',
      })
      var state = s[0]
      var setState = s[1]

      var form = React.useState({ title: '', start: '', end: '', note: '', leadMinutes: 10 })
      var f = form[0]
      var setF = form[1]

      var refresh = React.useCallback(function () {
        return api('/list')
          .then(function (r) {
            if (r && r.ok) {
              setState(function (prev) {
                return {
                  loading: false,
                  events: (r.events || []).slice().sort(byTime),
                  tomorrow: r.tomorrow || '',
                  today: r.today || '',
                  error: prev.error,
                  busy: prev.busy,
                  day: prev.day,
                }
              })
            } else {
              setState(function (prev) {
                return Object.assign({}, prev, { loading: false, error: '读不到日程' })
              })
            }
          })
          .catch(function () {
            setState(function (prev) {
              return Object.assign({}, prev, { loading: false, error: '连不上日程服务' })
            })
          })
      }, [])

      React.useEffect(function () {
        refresh()
      }, [refresh])

      // 每分钟拉一次。
      //
      // 两个原因:一是跨过零点之后"今天/明天"会变,页签上的日期得跟着换;
      // 二是另一个窗口改了日程,这边也该看到。
      React.useEffect(function () {
        var id = setInterval(refresh, 60000)
        return function () {
          clearInterval(id)
        }
      }, [refresh])

      // 当前页签对应的那一天。
      var selectedDate = state.day === 'today' ? state.today : state.tomorrow

      function switchDay(day) {
        setState(function (p) {
          return Object.assign({}, p, { day: day })
        })
      }

      function submit() {
        if (state.busy) return
        // 日期还没读到的时候不能加。
        //
        // 服务端把"没传日期"当成明天 —— 所以在 /list 回来之前点添加,
        // 东西会莫名其妙落到明天去。宁可等一下。
        if (!selectedDate) {
          setState(function (p) {
            return Object.assign({}, p, { error: '还没读到日期,稍等一下' })
          })
          return
        }
        setState(function (p) {
          return Object.assign({}, p, { busy: true, error: '' })
        })
        postJson('/add', {
          title: f.title,
          start: f.start,
          end: f.end,
          note: f.note,
          leadMinutes: Number(f.leadMinutes),
          // 加到当前页签那一天
          date: selectedDate,
        })
          .then(function (r) {
            if (r && r.ok) {
              setF({ title: '', start: '', end: '', note: '', leadMinutes: f.leadMinutes })
              setState(function (p) {
                return Object.assign({}, p, { busy: false })
              })
              refresh()
            } else {
              setState(function (p) {
                return Object.assign({}, p, { busy: false, error: messageOf(r && r.code) })
              })
            }
          })
          .catch(function () {
            setState(function (p) {
              return Object.assign({}, p, { busy: false, error: '添加失败,连不上服务' })
            })
          })
      }

      function remove(id) {
        postJson('/remove', { id: id }).then(refresh).catch(function () {})
      }

      /**
       * 把一条挪到另一天。
       *
       * 页签是"今天 / 明天",点错了东西就落错天了。
       * 以前只能删了重加 —— 重加会换 id、清掉"已提醒"的记录,时刻还得重敲。
       */
      function moveTo(id, date) {
        postJson('/move', { id: id, date: date })
          .then(function (r) {
            if (r && r.ok) refresh()
            else {
              setState(function (p) {
                return Object.assign({}, p, { error: messageOf(r && r.code) })
              })
            }
          })
          .catch(function () {
            setState(function (p) {
              return Object.assign({}, p, { error: '挪动失败,连不上服务' })
            })
          })
      }

      function onKey(e) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
      }

      var BADGES = {
        reminded: { cls: 'tsched-badge-reminded', text: '已提醒' },
        missed: { cls: 'tsched-badge-missed', text: '错过' },
        pending: { cls: 'tsched-badge-pending', text: '待提醒' },
      }

      // 列表按当前页签的那一天过滤。
      //
      // 落在今天/明天之外的事件(正常不会出现 —— addEvent 只允许这两天,
      // prunePast 又把更早的删了)单独放一栏,免得有东西被悄悄藏起来。
      var todayEvents = []
      var tomorrowEvents = []
      var otherEvents = []
      state.events.forEach(function (e) {
        if (e.date === state.today) todayEvents.push(e)
        else if (e.date === state.tomorrow) tomorrowEvents.push(e)
        else otherEvents.push(e)
      })
      var shown = state.day === 'today' ? todayEvents : tomorrowEvents

      function rowFor(e) {
        var badge = BADGES[e.status] || BADGES.pending
        // 挪到另一天:今天是 <今天> 就挪到明天,反之挪到今天
        var otherDate = e.date === state.today ? state.tomorrow : state.today
        var otherLabel = e.date === state.today ? '明天' : '今天'
        return h(
          'div',
          { className: 'tsched-row' + (e.status === 'missed' ? ' is-missed' : ''), key: e.id },
          h('div', { className: 'tsched-time' }, timeRange(e)),
          h(
            'div',
            { className: 'tsched-body' },
            h('p', { className: 'tsched-item-title' }, e.title),
            e.note ? h('p', { className: 'tsched-item-note' }, e.note) : null,
            h(
              'div',
              { className: 'tsched-item-lead' },
              Number(e.leadMinutes) > 0 ? '提前 ' + e.leadMinutes + ' 分钟提醒' : '不提醒',
            ),
          ),
          h('span', { className: 'tsched-badge ' + badge.cls }, badge.text),
          h(
            'button',
            {
              className: 'tsched-move',
              title: '挪到' + otherLabel,
              disabled: !otherDate,
              onClick: function () {
                moveTo(e.id, otherDate)
              },
            },
            '挪到' + otherLabel,
          ),
          h(
            'button',
            { className: 'tsched-del', title: '删除', onClick: function () { remove(e.id) } },
            '×',
          ),
        )
      }

      var rows = shown.map(rowFor)

      var TABS = [
        { key: 'today', label: '今天', date: state.today },
        { key: 'tomorrow', label: '明天', date: state.tomorrow },
      ]

      return h(
        'div',
        { className: 'tsched' },
        h(
          'div',
          { className: 'tsched-head' },
          h('h1', { className: 'tsched-title' }, '日程'),
          h(
            'div',
            { className: 'tsched-tabs' },
            TABS.map(function (t) {
              return h(
                'button',
                {
                  className: 'tsched-tab' + (state.day === t.key ? ' is-active' : ''),
                  key: t.key,
                  title: t.date,
                  onClick: function () {
                    switchDay(t.key)
                  },
                },
                t.label,
                h('span', { className: 'tsched-tab-date' }, t.date ? t.date.slice(5) : ''),
              )
            }),
          ),
        ),
        h(
          'p',
          { className: 'tsched-hint' },
          state.day === 'today'
            ? '今天的事。这一天过完,这一页就清空。'
            : '明天的事。今天(' + (state.today || '—') + ')过完,今天那页就清空。',
        ),
        h(
          'div',
          { className: 'tsched-form' },
          h('input', {
            className: 'tsched-input',
            placeholder: '要做什么',
            value: f.title,
            maxLength: 200,
            onChange: function (e) { setF(Object.assign({}, f, { title: e.target.value })) },
            onKeyDown: onKey,
          }),
          h('input', {
            className: 'tsched-input',
            type: 'time',
            title: '开始时刻',
            value: f.start,
            onChange: function (e) { setF(Object.assign({}, f, { start: e.target.value })) },
          }),
          h('input', {
            className: 'tsched-input',
            type: 'time',
            title: '结束时刻(可选)',
            value: f.end,
            onChange: function (e) { setF(Object.assign({}, f, { end: e.target.value })) },
          }),
          h(
            'select',
            {
              className: 'tsched-select',
              value: f.leadMinutes,
              title: '提前多久提醒',
              onChange: function (e) { setF(Object.assign({}, f, { leadMinutes: Number(e.target.value) })) },
            },
            LEAD_OPTIONS.map(function (m) {
              return h('option', { key: m, value: m }, m > 0 ? '提前 ' + m + ' 分' : '不提醒')
            }),
          ),
          h(
            'button',
            {
              className: 'tsched-btn tsched-btn-primary',
              // 日期还没读到之前不让加 —— 否则会落到明天去(服务端把"没传日期"当明天)
              disabled: state.busy || !selectedDate,
              onClick: submit,
            },
            state.day === 'today' ? '加到今天' : '加到明天',
          ),
          h('textarea', {
            className: 'tsched-note',
            placeholder: '备注(可选)',
            value: f.note,
            rows: 2,
            maxLength: 4000,
            onChange: function (e) { setF(Object.assign({}, f, { note: e.target.value })) },
          }),
          state.error ? h('p', { className: 'tsched-err' }, state.error) : null,
        ),
        h(
          'div',
          { className: 'tsched-list' },
          state.loading
            ? h('p', { className: 'tsched-empty' }, '读取中…')
            : rows.length
              ? rows
              : h(
                  'p',
                  { className: 'tsched-empty' },
                  state.day === 'today' ? '今天还没有安排。' : '明天还没有安排。',
                ),
          otherEvents.length
            ? h(
                'div',
                { className: 'tsched-other' },
                h('p', { className: 'tsched-other-head' }, '其他日期'),
                otherEvents.map(rowFor),
              )
            : null,
        ),
      )
    }

    // ---------- 提醒弹窗(纯 DOM) ----------
    //
    // 为什么不用 React:这个弹窗挂在 body 上,不属于任何 slot。
    // 要用 React 就得先拿到 react-dom 的 createRoot —— react 包里没有它,
    // 而 client 侧能不能 require('react-dom/client') 是没保证的。
    // 一个标题加一个按钮,用 DOM 直接写反而更稳。

    function createReminderHost() {
      var queue = []
      var seen = Object.create(null)
      var overlay = null
      var noteEl = null
      var timer = null
      var stopped = false

      function render() {
        if (!queue.length) {
          if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay)
          overlay = null
          return
        }
        var e = queue[0]

        if (!overlay) {
          overlay = document.createElement('div')
          overlay.className = 'tsched-overlay'
          overlay.setAttribute('data-plugin', 'tomorrow-schedule')
          document.body.appendChild(overlay)
        }
        overlay.textContent = ''

        var modal = document.createElement('div')
        modal.className = 'tsched-modal'
        modal.setAttribute('role', 'dialog')
        modal.setAttribute('aria-modal', 'true')

        var kicker = document.createElement('p')
        kicker.className = 'tsched-modal-kicker'
        kicker.textContent = '日程提醒'

        var title = document.createElement('h2')
        title.className = 'tsched-modal-title'
        title.textContent = e.title

        var when = document.createElement('p')
        when.className = 'tsched-modal-time'
        when.textContent = e.date + '  ' + timeRange(e) + (e.end ? '' : ' 开始')

        noteEl = document.createElement('div')
        noteEl.className = 'tsched-modal-note'
        noteEl.textContent = e.note || ''
        if (!e.note) noteEl.style.flex = '0 0 0'

        var foot = document.createElement('div')
        foot.className = 'tsched-modal-foot'

        if (queue.length > 1) {
          var more = document.createElement('span')
          more.className = 'tsched-date'
          more.textContent = '还有 ' + (queue.length - 1) + ' 条'
          foot.appendChild(more)
        }

        var ok = document.createElement('button')
        ok.className = 'tsched-btn tsched-btn-primary'
        ok.textContent = '知道了'
        ok.addEventListener('click', function () {
          dismiss(e.id)
        })
        foot.appendChild(ok)

        modal.appendChild(kicker)
        modal.appendChild(title)
        modal.appendChild(when)
        modal.appendChild(noteEl)
        modal.appendChild(foot)
        overlay.appendChild(modal)

        // 必须手动确认:点遮罩不关,Esc 也不关
        ok.focus()
      }

      function dismiss(id) {
        queue = queue.filter(function (x) {
          return x.id !== id
        })
        render()
        postJson('/ack', { id: id }).catch(function () {})
      }

      function tick() {
        api('/pending')
          .then(function (r) {
            if (stopped || !r || !r.ok) return
            var fresh = (r.events || []).filter(function (e) {
              return !seen[e.id]
            })
            if (!fresh.length) return
            fresh.forEach(function (e) {
              seen[e.id] = true
            })

            // 分诊:DSH 在前台就弹界面里的窗口(和主题一致);
            // 不在前台(窗口被别的程序挡住、或者标签页被切走)就请宿主开一个
            // 置顶的原生窗口 —— 浏览器里的东西这时候是看不见的。
            var hidden = false
            try {
              hidden = document.hidden === true || document.visibilityState === 'hidden' || !document.hasFocus()
            } catch (e) {
              hidden = false
            }

            if (hidden) {
              postJson('/notify', {
                ids: fresh.map(function (e) {
                  return e.id
                }),
              }).catch(function () {})
              return
            }

            queue = queue.concat(fresh)
            render()
          })
          .catch(function () {})
      }

      tick()
      timer = setInterval(tick, POLL_MS)

      return function stop() {
        stopped = true
        if (timer !== null) clearInterval(timer)
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay)
        overlay = null
        queue = []
      }
    }

    // ---------- 注册 ----------

    function apply(ctx) {
      if (typeof document === 'undefined' || document.body === null) return
      if (!React || !h) {
        // 没有 react 就画不出 slot 组件。宁可什么都不挂,也不要挂一个会崩的图标。
        console.warn('[tomorrow-schedule] 拿不到 react,界面不挂载')
        return
      }

      var styleTag = injectStyle()
      var slots = ctx.slots || (typeof ctx.get === 'function' ? ctx.get('slots') : undefined)
      if (!slots) {
        console.warn('[tomorrow-schedule] 拿不到 slots 服务,界面不挂载')
        return
      }

      var disposers = []

      try {
        disposers.push(
          slots.inject('sidebar.panellist', function () {
            return slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: 120, label: '日程' },
              PanelIcon,
            )
          }),
        )
      } catch (e) {
        console.warn('[tomorrow-schedule] 侧边栏图标注册失败', e)
      }

      try {
        disposers.push(
          slots.inject('main', function () {
            return slots.register({ name: 'main', key: PANEL_ID }, Panel)
          }),
        )
      } catch (e) {
        console.warn('[tomorrow-schedule] 主面板注册失败', e)
      }

      // 提醒弹窗挂在 body 上 —— 它不属于任何 slot,是全局的。
      //
      // 只让一个实例负责轮询:某些启动路径会把同一个 bundle 挂载两次
      // (boot loader + cordis 组合各一次)。槽位重复注册是幂等的,
      // 但两个轮询会各自弹一次 —— 实测同一条提醒会开出两个窗口。
      var REMINDER_FLAG = '__dshTomorrowScheduleReminder'
      if (!window[REMINDER_FLAG]) {
        window[REMINDER_FLAG] = createReminderHost()
      }
      var stopReminders = function () {
        var stop = window[REMINDER_FLAG]
        if (typeof stop === 'function') stop()
        window[REMINDER_FLAG] = null
      }

      ctx.effect(
        function () {
          return function () {
            for (var i = 0; i < disposers.length; i++) {
              try {
                if (typeof disposers[i] === 'function') disposers[i]()
              } catch (e) {
                /* ignore */
              }
            }
            try {
              stopReminders()
            } catch (e) {
              /* ignore */
            }
            if (styleTag.parentNode) styleTag.parentNode.removeChild(styleTag)
          }
        },
        'tomorrow-schedule client cleanup',
      )

      console.log('[tomorrow-schedule] client ready')
    }

    exports.apply = apply
    // slot 服务要靠这个声明才会注入进来(见 DSH 的 slot 目录示例)。
    exports.inject = ['slots']
    return module.exports
  },
})
