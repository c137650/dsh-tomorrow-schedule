# dsh-tomorrow-schedule

给 DeepSeek Harness 加一个**日程**:侧边栏一个图标,点进去安排今天和明天的事;到点用和主题一致的弹窗提醒,必须手动确认关闭。

原来的版本把源码放在 `E:\deepseek_harness_workspace\dsh-tomorrow-schedule`,那个工作区被清空后代码没了(数据还在)。这是按需求重写的版本,数据结构与旧版一致,旧日程已自动搬过来。

## 它做什么

- **侧边栏多一个「日程」图标**,点了中央栏换成日程页面
- **能安排今天和明天**——页面上有两个页签,点「今天」就切到当天,点「明天」就切到明天;
  **添加和已有列表跟着当前这一天走**(两边同步)。日期由服务端定,客户端说什么都不算数
- **过了这一天就清空**——每次读写前先清掉更早的
- **不论按什么顺序添加,列表里的事件总是按开始时刻排列**——服务端排、客户端再排一次,文件里本身也是排好的
- 事件:**标题**(必填)、**开始时刻**(必填)、**结束时刻**(可选)、**备注**(可选)、**提前多少分钟提醒**
- 列表里每条带状态:**待提醒 / 已提醒 / 错过**
- **开始超过 30 分钟就不再提醒**,直接标「错过」——电脑一直没开机时,开机后不会倒出一堆过期提醒
- 提醒分两种,看 DSH 在不在前台:
  - 在前台 → 界面里的弹窗,和 DSH 主题同色,点遮罩和 Esc 都关不掉,只能点「知道了」
  - 不在前台(窗口被挡住 / 标签页切走)→ 宿主开一个 **WinForms 置顶窗口**,进任务栏,同样只能点「知道了」
- 列表、备注、弹窗里的备注都能滚

## 安装

```bash
dsh plugin --profile desktop add dsh-tomorrow-schedule
```

手工兜底(不用 CLI 时):

1. 在 profile 的 `package.json` 里加一条依赖,指向本目录:
   ```json
   "dsh-tomorrow-schedule": "link:E:/dsh-tomorrow-schedule"
   ```
2. 在 `dsh.profile.bundles` 里加 `dsh-tomorrow-schedule`
3. 重启 DSH

## 数据在哪

```
%DSH_HOME%/dsh-plugin-tomorrow-schedule/events.json
```

第一次启动时,如果这个文件不存在,会去 `%DSH_HOME%/profiles/<各个 profile>/day-schedule/events.json`
找旧版数据搬过来(只搬还没过期的)。

结构:

```json
{
  "version": 1,
  "events": [
    { "id": "evt-...", "title": "选课", "note": "", "date": "2026-11-04",
      "start": "20:00", "end": "", "leadMinutes": 10,
      "createdAt": "2026-11-03T15:24:31.648Z", "attempts": 0, "lastAttemptAt": 0 }
  ]
}
```

字段名和旧版完全一致,所以旧数据能直接读。

## 接口

客户端和宿主之间走同源 HTTP,全部注册在 `ctx.webServer` 的精确路径上:

| 路径 | 方法 | 作用 |
|---|---|---|
| `/dsh-tomorrow-schedule/list` | GET | 列出日程(顺便清过期),每条带 `status`。另外给 `today` / `tomorrow` / `days` |
| `/dsh-tomorrow-schedule/add` | POST | 加一条。`date` 只能是今天或明天(服务端验),不给就当明天 |
| `/dsh-tomorrow-schedule/remove` | POST | 删一条 |
| `/dsh-tomorrow-schedule/pending` | GET | 现在该弹的提醒 |
| `/dsh-tomorrow-schedule/ack` | POST | 确认已看到(幂等,重复调用不会重复计数) |
| `/dsh-tomorrow-schedule/notify` | POST | 开原生置顶窗口。客户端发现自己在后台时叫这个 |

`status` 有三个值:

```
pending   还没到点,或者到点了还没弹
reminded  已经弹过
missed    开始超过 30 分钟还没弹成 —— 以后也不再弹
```

## 挂在哪两个 slot 上

DSH 客户端有一份机器生成的 slot 目录(`dsh/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/client.js`)。
这里用了两个:

```
sidebar.panellist  [list]   侧边栏的那一列全局面板图标
main               [keyed]  中央面板,按 sidebar entry id 分发
```

两个用同一个 id `tomorrow-schedule`——**列表的 id 就是它选中的中央面板 key**,
所以点图标中央栏就换成日程页面。

## 原生窗口为什么这么写

这块踩过五个坑,都记在这里,免得以后又踩。

**一、只写 `$f.TopMost = $true` 不够。**
显示之后必须用 `SetWindowPos(HWND_TOPMOST)` 硬来一次,并且每秒重申
(别的程序会抢走置顶)。

**二、判"是不是置顶"的位是 `0x8`,不是 `0x20`。**
`WS_EX_TOPMOST = 0x00000008`;`0x20` 是 `WS_EX_TRANSPARENT`。
第一版判据写错,把在顶上的窗口判成"没在顶上",白查了两轮 ——
排查时这类"判据本身是错的"最费时间。

**三、坐标不要写死。**
本机屏幕只有 1229×768,早期写死 (700,360) 会让窗口右边缘超出 7 像素。
现在交给 `StartPosition = "CenterScreen"`。

**四、置顶窗口在独占全屏面前是盖不住的。**
视频网站全屏播放走的是独占全屏,那一层在置顶窗口之上 ——
窗口明明存在、可见、置顶,人就是看不见。
所以另加一条**系统通知**(toast):它走通知层,Windows 专门为
"游戏全屏时也要能提示"准备的,独占全屏也盖不住。
通知和窗口是**两个进程** —— 放同一个脚本里实测会互相拖累:
后台启动时通知那段会卡住,连带窗口都开不出来。

**五、node 起的子进程在另一个窗口站上,枚举不到交互式桌面。**
这条最费时间:从 node 起的枚举器返回 0 个窗口,从 PowerShell 起的返回 88 个。
于是"用 node 写的验证脚本"永远报"窗口不存在" —— 那是尺子坏了,不是东西坏了。
`test/verify-popup.ps1` 必须从**交互式终端**跑,不能从 node 跑。

`test/verify-popup.ps1` 就是用来盯前三条的:它弹一个窗口,
**从另一个进程**枚举顶层窗口,检查存在 / 置顶 / 有真实尺寸 / 完全在屏幕内。
这件事不能靠肉眼 —— 窗口压在别的窗口下面时,肉眼在别处一样看不见。

## 提醒走了哪条路

```
DSH 在前台        →  界面里的主题弹窗(和主题同色,点遮罩/Esc 都关不掉)
DSH 在后台        →  系统通知(toast)+ 置顶的原生窗口
```

每天的流水记在 `%DSH_HOME%/dsh-plugin-tomorrow-schedule/popup.log` ——
哪条路走了、窗口开没开、通知发没发出去,都在里面。
DSH 的 GUI 里看不到插件日志,这个文件就是唯一的线索。

## 已知限制

- **DSH 完全没开着就不会弹提醒。** 窗口在后台、被别的程序挡住、标签页被切走都没问题
  (会走原生置顶窗口 + 系统通知);但整个程序关掉之后没有任何进程在跑,自然也不会提醒 ——
  这版刻意没有在系统里驻留后台进程。开机后该触发但已错过 30 分钟的,会在界面上标「错过」。
- 原生窗口由 `powershell.exe` 现开(不编译 DLL)。窗口本身是用户自己点「知道了」关的,
  插件不追踪它的生命周期。
- 提醒的状态记在 `attempts`/`lastAttemptAt` 上,弹一次就记一次;不会重复弹同一条。

## 测试

```bash
node test/store.test.mjs      # 规则:今天/明天 / 参数校验 / 跨天清理 / 排序 / 读写
node test/status.test.mjs     # 状态:待提醒 / 已提醒 / 错过、30 分钟界线、ack 幂等
node test/popup.test.mjs      # 脚本内容:置顶 / 居中 / 只能手动关 / 通知与窗口分开 / 能被 PowerShell 解析
```

前三个不弹窗口。`popup.test.mjs` 用 PowerShell 自己的 Parser 检查生成的脚本 ——
脚本里全是引号和脚本块,写错了用户只会看到窗口一闪然后什么都没有。

要验"真的弹出来了吗",用这个(**必须从交互式终端跑**,理由见上面第五条):

```bash
node test/verify-popup.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File test/verify-popup.ps1
```

它会真的弹一个窗口出来(15 秒后自己关),然后从另一个进程枚举窗口,
核对存在 / 置顶 / 有真实尺寸 / 完全在屏幕内。
