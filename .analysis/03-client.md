# dsh-purge 1.1.71 前端/客户端注入层解剖

被测对象：`client.js`（磁盘 507,616 B / UTF-8 476,582 字符 / 8,737 行）、`scripts/build-client.mjs`（74 行）、`scripts/patch-client-dock.mjs`（454 行）、`scripts/embed-default-prompt.mjs`（33 行）、`lib/redteam/client.js`（4,219 行 / 281,726 B）、`package.json`、`screenshots.json`。

---

## 1. client.js 是源码还是构建产物

**结论：外层是手写源码，中间 48% 是由脚本拼进去的构建产物；两者被塞进同一个文件，靠两个注释标记分隔。**

源码形态证据：

| 判据 | 实测 |
|---|---|
| 压缩 | 无。制表符缩进、中文注释、`function` 有名字（如 `client.js:17,40,60`） |
| 行长 | 平均 54.5 B/行（压缩产物通常 >200）；最长 6,820 B 的长行只有 CSS 常量与 `AUTH_LEGAL_HTML`（`client.js:7696`） |
| 源映射 | `sourceMappingURL` 命中 0 次 |
| `eval` | 0 次 |
| 行尾 | CRLF（`\r\n`），不是构建器常见的 LF |

但**不是纯源码**：

- `/* __DSH_PURGE_DRILL_BEGIN__ */`（`client.js:3476`）与 `/* __DSH_PURGE_DRILL_END__ */`（`client.js:7688`）之间 4,213 行，是 `scripts/build-client.mjs:55-72` 从 `lib/redteam/client.js` 切片后 `slice(0,beginAt)+fragment+slice(endAt+END.length)` 覆盖写入的（`build-client.mjs:69-73`）。
- 切片规则：`startMark = "factory: (require) => {"`（`build-client.mjs:19`）、`endMark = "\n    return module.exports\n  },\n})"`（`:22`），再用 `lastIndexOf("function apply(ctx) {")` + 花括号深度扫描把 `apply(ctx)` 换成 `applyDrillParts()`（`:33-53`）。

**与 build 的输入输出是否一致：不一致，且内嵌副本更新。**

用 `build-client.mjs` 的规则重算了一遍（只读、不落盘）：

```
内嵌片段（client.js 现状）  4,213 行 / 非空 4,038
重建结果（来自 lib/redteam） 4,187 行 / 非空 4,006
仅存在于 client.js 的 33 行；仅存在于重建结果的 6 行
第一个差异 ≈ client.js:4041-4046
  client.js：}).then(async (res) => { const text = await res.text().catch(()=>'') … non-json 兜底
  重建结果：}).then((res) => res.json())
```

即：`client.js:4037-4054` 里那套「HTTP 200 + 非 JSON 也给出可读错误」的 `api()` 实现只存在于内嵌副本；`lib/redteam/client.js` 还是旧写法。**`npm run build:client` 会把这个已修好的错误处理静默回退**（`build-client.mjs` 只在找不到标记时抛错，版本/内容漂移不校验）。

加载方式（非 ESM、无 IIFE、宿主自定义 loader 工厂）：

- 首行 `window.__ModuleLoader__.load({ id: "dsh-purge", factory: (require) => {`（`client.js:1`），末两行 `}` `});`（`8735-8736`）。是宿主（`lib/redteam/client.js:4` 注释也写明"格式与外壳的模块加载器一致"）调 loader 后才执行 factory，**不会自动执行**。
- 工厂内部是 CJS 语义：`var module = { exports: {} }`、`var exports = module.exports`（`client.js:3-4`）、`Object.defineProperty(exports, Symbol.toStringTag, {value:"Module"})`（`:5`）、`require("react")`（`:6`）、尾部 `exports.name/inject/apply` + `return module.exports`（`8731-8734`）。
- 插件自报依赖：`const inject = ["slots", "locale"]`（`client.js:11`）。
- 宿主侧装载清单：`package.json:68-77` → `dsh.client.platform = "web"`，`inject = ["@deepseek-ai/dsh-client-connection","…-runtime","…-locale","…-ui-slots","…-ui-settings"]`。
- `screenshots.json` 与运行期无关：仅是 7 张 `docs/preview/*.png` 的清单（`screenshots.json:1-9`），被 `package.json:31` 的 `files` 与 `lib/update.js:20-31` 的 `COPY_NAMES` 当作静态资产复制。

---

## 2. 页面里劫持/扩展了什么

### 2.1 官方扩展点（唯一"合法"入口）

| 动作 | 行号 |
|---|---|
| `ctx.locale.register(NS, {zh, en})` | `client.js:8706` |
| `ctx.slots.inject("shell.overlay")` 注册 `dsh-purge-dock`，内部渲染 `WelcomeNotice/PurgeLauncher/PurgeDock/HeroNewSessionMount/TabRowPurgeMount/EnvAdaptSendGate` | `8709-8713` |
| `ctx.slots.inject("conversation.input.right")` 注册回退按钮 `dsh-purge-rewind`（order 20） | `8684-8692` |
| 同名槽位的"继续"按钮已被注释掉（死代码） | `8693-8701` |
| `ctx.effect(() => installRewindWatch(ctx), …)` | `8702` |
| `ctx.inject(["sessions","uiWorkspace","workspaces","conversation"], cb)` | `8716`、降级重试 `8723` |

### 2.2 宿主内部对象访问（无公开契约的部分）

| 目标 | 行号 |
|---|---|
| `uiWorkspace.selection.getSnapshot().sessionId` | `2878`、`3108` |
| `sessions.list.getSnapshot()` → `.current/.byId/.ids` | `2882`、`2890-2893`、`8043-8044`、`8065-8066` |
| `sessions.scope(id)` + `sessions.sessionOf(actx)` | `2976`、`3076-3077`、`8049-8050` |
| `conversation.input.shell(sessionId)` / `input.for(actx)` | `2970-2977` |
| `input.state.getSnapshot().draft`、`inputActions.state.getSnapshot().draft` | `2986`、`2990` |
| `input.setDraft()` / `inputActions.setDraft()` | `3000-3001`、`3009-3010` |
| `sessions.refresh()`、`workspace.openSession()`、`sessions.open()` | `3094-3104` |
| `face.updateQueue(id, {kind:"remove"})` 清继承队列 | `3082` |
| **monkeypatch `shell.submit`**，并改写 `shell.actions.submit`；WeakMap 存原件 + 400 ms 轮询重打 + unmount 还原 | `8198-8217`、`8195-8240` |
| React 仅走 `require("react")` / `require("react-dom").createPortal`，**没有** fiber / `__reactFiber` / `_reactRootContainer` 访问（全文件命中 0） | `6`、`1360`、`3270`、`8612`、`8672` |

### 2.3 DOM 注入点

- 样式注入：
  - `h("style", null, PURGE_CSS)`（`2828`）—— 挂在设置根节点内；
  - `h("style", null, REWIND_CSS)`（`3432`）—— **在每个按钮实例里渲染，会重复 N 份**；
  - `document.head.append`：`style[data-dsh-purge-drill]`（`8371-8374`）、`style[data-dsh-purge-dock-w]`（`8375-8378`）、`style[data-dsh-purge-ui]` 宽度变量（`8363-8368`）。
- 宿主锚点 + 手工建节点：
  - 首页模式行：`[data-dsh-hero-workspace-row]` → `[data-conversation-hero]` → `[class*="heroWorkspaceRow" i]` → `[class*="hero" i][class*="workspace" i][class*="row" i]`，`appendChild` 一个 `.dshp-hero-chip`（`8566-8586`）；
  - 会话页签行：`[data-conversation-tabs]` → `[data-conversation-tabrow]` → `[role='tablist'][aria-label*='对话' i]` → `[class*='conversation' i][class*='tab' i][class*='row' i]`，注入 `.dshp-tab-chip`（`8629-8649`）；
  - 两处都 `MutationObserver(body,{childList,subtree})` + `setInterval(…,1000)` 双保险（`8590-8594`、`8653-8657`），命中失败只 `console.warn` 一次（`8574`、`8637`）。
- Portal 到 `document.body`：`1360-1361`、`3270`、`7898-7899`、`8531-8533`、`8611-8614`、`8671-8674`。
- 扫描宿主 DOM 做状态判断：
  - 红队模式：`[data-agent-preset='redteam'], [data-preset-id='redteam'], [data-mode='redteam']`，退化到 `[class*='seat' i][class*='label' i]` 再退化到 `title*='红队'` 文本正则（`8081-8102`）；
  - 发送按钮识别：`aria-label/title/data-testid/textContent` 正则 + `[data-composer-card]` 内 primary + `form textarea`（`8106-8132`）；
  - 主题：`data-ds-dark-theme` / `color-scheme` / `prefers-color-scheme`（`2774-2788`），配 `MutationObserver` 监听 `body/html` 的 `class|style|data-ds-dark-theme`（`2815-2817`、`8356-8357`）。

### 2.4 事件监听（含 capture 级拦截）

| 监听 | 位置 | 说明 |
|---|---|---|
| `document.addEventListener("pointerdown"/"click"/"keydown", fn, true)` | `8273-8280` | capture 阶段拦"发送"，`preventDefault+stopPropagation+stopImmediatePropagation`（`8258-8260`、`8269-8271`）；Enter 键在 composer 内也拦（`8262-8271`） |
| `document.addEventListener("mousedown", …)` 关菜单 | `3289`、`3374` | 类组件 / 函数组件各一套 |
| `window resize/mousemove/mouseup` | `7362`、`7417-7421`、`7528-7529`、`8388-8389`、`8410-8476` | 拖动、缩放、Esc 关闭 |
| `matchMedia("(prefers-color-scheme: dark)").addEventListener("change")` | `2810-2811` | 主题同步 |
| 定时器 | `3472`（1200 ms rewind 轮询）、`8227`（400 ms 重打 submit）、`8250`（5000 ms 环境轮询）、`8594`/`8657`（1000 ms 挂点重建） | 共 11 处 setInterval / 12 处 clearInterval |

### 2.5 网络层：没有包装宿主 fetch/XHR/WebSocket

`window.fetch =`、`XMLHttpRequest.prototype`、`WebSocket` 替换在 `client.js` 中命中 0。插件只开自己的通道：

- 统一封装 `apiJson`（`60-80`）+ 路由超时表 `apiTimeoutMs`（`43-55`：update 180 s、status 60 s、apply 240 s、revert 120 s、其余 20 s），AbortController + "连不上接口"中文兜底（`73-78`）。
- 裸 `fetch`：`1615`、`1704`、`1774`（卸载后 ping 宿主 `/` 再 `location.reload`，`1771-1794`）、`2016`、`2695`、`2740`。
- 演练台通道：`POST /redteam/api`，`op` 字段路由（`client.js:4037-4054`、`8138`、`8312`）。
- 轮询端点：`/dsh-purge/rewind`（`3460`）、`/dsh-purge/last-user`（`3059`）、`/dsh-purge/drill-grant`（`7722`、`7737`）。

### 2.6 存储与"路由"

- `localStorage`：`dsh-purge-drill-auth`（`7690`）、`dsh-purge-user-notice-v1`（`7691`）、`dsh-purge-dock-geom-v4`（`7815`）、`dshp-theme`/`dshp-theme-mode` 仅删除（`1778-1779`）；演练台 `rt-collapse-*`（`6584-6590`）、`rt-unread-*`（`7291-7297`）、`RT_GEOM_KEY`/`rt-dock-width`（`7326-7357`）。
- `sessionStorage`：`dshp-rewind-draft:`（`2854`，写 `2914`/读 `2920`/删 `2926`）、`dshp-rewind-arm:`（`2855`，`2935`/`2947`），45 s TTL（`2857`、`2949`）。
- 路由：**没有** `pushState`/`popstate`/history 拦截。只有 hash 读取 `location.hash === '#redteam-full'`（`4033-4034`）与开新窗 `window.open(href + '#redteam-full')`（`7513`、`7664`、`7794`、`7985`）。

---

## 3. `scripts/patch-client-dock.mjs` 对宿主 bundle 做了什么

对象不是"宿主 bundle"，而是**本插件自己的 `client.js`**（`patch-client-dock.mjs:11`）；它做 4 组字符串补丁 + 1 条流水线。

| # | 补丁 | 匹配串 | 替换/插入 | 守卫 |
|---|---|---|---|---|
| 1 | i18n 键 | `\t\t\tnav: "规则设定",`（`:23-24`）、`\t\t\tnav: "Rules",`（`:47-48`） | 各插 20 个 `dock.*`/`auth.*`/`auth.check.*` 键（`:25-45`、`:49-69`） | `!client.includes('"dock.clean"')`（`:22`） |
| 2 | 样式 | 先找 `\t\tconst REWIND_CSS`（`:129`），再 `lastIndexOf("`;")` 回退定位 PURGE_CSS 结尾（`:132-134`） | 插 53 行 `.dshp-dock`/`.dshp-dock-body .rt-*`/`.dshp-auth-*`（`:75-127`） | `!client.includes(".dshp-dock{")`（`:74`） |
| 3 | dock 代码块 | `\t\tfunction installRewindUi(ctx) {`（`:381-383`） | 在其前插 240 行：`AUTH_KEY`/`AUTH_LEGAL_HTML`/`dockBus`/`requestDrill`/`toggleDock`/`AuthGate`/`PurgeDock`/`HeroNewSessionMount`（`:138-378`）；同时先塞**空壳** `__dshPurgeDrill = {CSS:"",Panel:null,setUI:()=>{},…}` 占位（`:142-144`），由下一步的 build 覆盖 | `!client.includes("function PurgeDock()")`（`:380`） |
| 4 | `apply()` 改写 | **整段字面量全等**匹配 `oldApply`（`:387-408`，其中还是 `settings.section` 注册 + 单路 `ctx.inject`） | 换成 `newApply`（`:410-434`，`shell.overlay` + PurgeDock/HeroNewSessionMount/TabRowPurgeMount/EnvAdaptSendGate） | `id: "dsh-purge-dock"` 已存在 → 跳过（`:436-437`）；字面量对不上 → `throw "apply() block not found for replacement"`（`:441`） |
| 5 | 收尾 | — | `writeFileSync`（`:444`）→ `spawnSync(node scripts/build-client.mjs)`（`:447-453`），非 0 退出透传 | — |

版本差异处理：**完全没有**。脚本不读 `package.json` 的 `dshTarget`，不比对宿主版本，不校验 `client.js` 是否已被别的版本改过。唯一的"差异容忍"是 4 个 `includes()` 正存在性守卫——存在即跳过，不存在就插；**已存在但内容不同则永久放任**。

失败回退：无。只读时做一次 CRLF→LF（`:19`），写回全文件 LF（`:444`），即一次全文件行尾改写；`build-client.mjs` 失败时 `clientPath` 已写入，磁盘留下 `Panel: null` 的空壳演练台（用户侧只看到"未授权"占位，`client.js:8481-8483`），源码与产物同时处于半损坏态。

**这类字符串补丁的脆弱点**（按现实风险排序）：

1. **整函数字面量全等**（`:387-408`）：`apply()` 里多一行就 hard throw。事实上已经发生——当前 `client.js:8709-8713` 比 `newApply` 多了 `WelcomeNotice` 和 `PurgeLauncher`，说明该脚本已无法再跑通第 4 步（现在靠 `:436-437` 的 `id` 守卫短路），只能靠人手改。
2. **三方副本已漂移**：`HeroNewSessionMount` 在脚本模板里只有 `[class*="heroWorkspaceRow"]`（`:345`），而 `client.js:8566-8570` 已经是四路选择器 + 失败告警。重跑脚本会把四路兜底**降级**为单路；`PurgeDock` 模板（`:275-335`）同样缺 Portal、拖动、宽度变量（对比 `8348-8541`）。
3. **空白/字面量敏感**：锚串含 `\t\t\t` 与中文 i18n 字面量，任何格式化、i18n 外置、键名微调都会失配；失配是静默跳过（第 1-3 步）或硬抛（第 4 步）。
4. **`lastIndexOf("`;")` 定位 CSS 结尾**（`:132`）：CSS 里出现 `` `; `` 或模板字面量改写即错位。而且现有文件里已经能看到拼接损伤——`client.js:4031` 把演练台 CSS 的收尾反引号和下一节注释挤在同一行（`…anywhere}` + `` ` `` + `/* ---- 桥接与状态 */`），说明这种"按反引号找边界"的做法历史上已经踩过。
5. **守卫是正存在性而非内容校验**：只要 `"dock.clean"` 出现过一次，整组 20 个键从此不再维护；键被删不会补，值被改不会纠。
6. **无原子性**：先写文件再 build，中间态落盘；没有临时文件 + 原子 rename，也没有备份。

---

## 4. `client.js` 内部模块划分（行号区间 / 行数 / 字节）

外层 4,523 行 + 内嵌 4,213 行 = 8,736 行。

| 区块 | 行号 | 行数 | 字节 |
|---|---|---:|---:|
| 加载头/模块壳 | 1-13 | 13 | 484 |
| 网络+工具层（apiUrl/apiTimeoutMs/apiJson/rulesApi/skillsApi） | 14-125 | 112 | 4,093 |
| i18n zh | 128-466 | 339 | 19,174 |
| i18n en | 468-806 | 339 | 19,457 |
| **PURGE_CSS** | 807-1046 | 240 | 35,190 |
| 基础原语（formatSize/statusKind/statusLabel/shimKind/noticeNode/Btn/Pill） | 1047-1096 | 50 | 1,991 |
| 补丁表 + hooks-deny + continue-retry + RestartAsk | 1097-1366 | 270 | 8,919 |
| **PurgifySection**（应用/还原/卸载/更新/提示词/自有服务器/重启） | 1367-2046 | 680 | 28,111 |
| RulesSection | 2047-2316 | 270 | 10,157 |
| SkillsSection + 版本比较（2328-2395） | 2317-2685 | 369 | 12,790 |
| 重启流程（reopenAfterRestart/waitForRestart/restartDsh） | 2686-2773 | 88 | 2,740 |
| 主题 + SettingsRoot | 2774-2865 | 92 | 5,047 |
| **rewind 宿主适配**（草稿/输入框/队列/会话重开） | 2866-3163 | 298 | 10,275 |
| Continue/Rewind UI（3 个类/函数组件） | 3164-3454 | 291 | 10,373 |
| installRewindWatch | 3455-3475 | 21 | 817 |
| **内嵌演练台**（lib/redteam/client.js 产物） | 3476-7688 | 4,213 | 277,294 |
| 演练授权 + grant 同步（AUTH_KEY/WELCOME_KEY/syncDrillGrant） | 7689-7763 | 75 | 15,058 |
| dockBus + 几何（loadDockGeom/saveDockGeom） | 7764-7845 | 82 | 3,346 |
| WelcomeNotice / AuthGate | 7846-7993 | 148 | 5,487 |
| 红队侦测 + 发送判定（isRedteamModeActive/looksLikeSendControl） | 7994-8133 | 140 | 5,626 |
| EnvAdaptSendGate（含 shell.submit patch） | 8134-8347 | 214 | 7,727 |
| PurgeDock（双页签 + 拖动 + 缩放 + Portal） | 8348-8541 | 194 | 7,960 |
| PurgeLauncher + DOM 挂载（Hero/TabRow） | 8542-8676 | 135 | 4,818 |
| installRewindUi + apply | 8677-8736 | 60 | 1,898 |

内嵌演练台自带分节（`client.js` 行号，原注释在 `lib/redteam/client.js` 对应行）：

| 分节 | 行号 |
|---|---|
| 演练台 CSS 常量（`const CSS = \`…`） | 3478-4031（~550 行 / ≈30 KB） |
| 桥接与状态（`isFullWindow`/`api`/`ui` 订阅/POC 分类/角色表/ShotImage/ShotStrip） | 4031-4253 |
| 资产测绘 | 4254-4630 |
| 资产发现时间线 | 4631-4689 |
| 智能体提示词 | 4690-4781 |
| 技能库（DSH 原生） | 4782-4964 |
| 漏洞战果 | 4965-4983 |
| 证据渲染 | 4984-5317 |
| 攻击链 / 五阶段 | 5318-5504 |
| 得分复现报告 | 5505-5753 |
| 攻击文件 | 5754-5831 |
| 知识库（POC/EXP） | 5832-6106 |
| 环境适配（Windows/非 Kali） | 6107-6311 |
| 得分目标 | 6312-6575 |
| 折叠底座 | 6576-6659 |
| 当前测试（实时） | 6660-6802 |
| 会话与入口（WebShell/隧道） | 6803-7015 |
| 错误边界 `RtBoundary` | 7016-7281 |
| 常驻面板主体 | 7282-7641 |
| 入口按钮 | 7642-7672 |
| 插件入口 `applyDrillParts` | 7673-7688 |

---

## 5. `dshTarget: 0.2.0-rc.2` 在客户端体现为什么

**客户端代码里没有任何版本读取、比较或 semver 分支**：`dshTarget`、`0.2.0-rc` 在 `client.js` 中命中 0。`package.json:94` 是唯一声明处，`lib/` 里也只有两处注释提到 rc.2（`lib/core.js:3938`、`7526`）。

真正的"版本耦合"是四条间接通道：

1. **补丁分组标签必须与服务端 `patch.layer` 字面一致**：`LAYER_GROUP`（`client.js:1098-1104`）把 `"0.1.5 兼容"→compat`、`"0.2.0 兼容"→dsh20`，`GROUP_ORDER`（`1105`）决定 UI 顺序；i18n 里对应 `group.compat`/`group.dsh20`（`352-353`、`692-693`）。服务端 82 条补丁定义里 `layer: "0.1.5 兼容"`（`lib/core.js:3818`）、`layer: "0.2.0 兼容"`（`lib/core.js:4254`、`4369`）—— 分组键一旦改名，客户端会把所有补丁并进 `undefined` 组（`PatchGroups` 的 `LAYER_GROUP[...]` 查表 `1124-1160` 无 fallback 分支）。
2. **宿主形态探测代替版本探测**：`clientGuessSurface()`（`17-28`）用 UA 含 `electron`、`location.port === "43120"`、URL 含 `dsh desktop` 三招猜桌面端；`hostSurfaceOf`（`29-31`）、`hostText`（`32-39`）据此取 `key + ".desktop"` 变体文案（如 `202`、`305`）。这是"哪个宿主版本/形态"的唯一运行期判断手段。
3. **DOM 结构兜底就是版本兼容分支**：首页四路选择器（`8566-8570`）、页签四路（`8629-8633`）、`data-*` 语义优先 + `class*=` 模糊兜底 + 文本正则（`8081-8102`、`8565` 注释明说"不绑定具体 CSS Module 哈希"）。命中不到时只 `console.warn`（`8574`、`8637`）并静默卸载挂点。
4. **样式层靠 CSS 变量回退**：全程 `var(--dsw-alias-*, fallback)`（`2837-2852`、`patch-client-dock.mjs:76-126`），宿主变量改名时静默退化到硬编码色值，不做版本断言。

结论：`dshTarget` 对客户端零约束力。宿主从 0.2.0-rc.2 升一版，客户端不会报任何错，只会在三个地方静默劣化：DOM 挂点消失（按钮不渲染）、宿主 store 形状变化（`rewind`/门禁失效但发送照常放行，`8210-8212` 的 try 会吞掉门禁异常）、`shell.submit` 改名（`8198` 的 `typeof shell.submit !== "function"` 直接 return，无告警）。

---

## 6. 工程质量

### 6.1 重复代码

1. `HeroNewSessionMount`（`8556-8616`）与 `TabRowPurgeMount`（`8619-8676`）≈ 110 行同构：`ensure()` + `MutationObserver` + 1 s 轮询 + `createPortal`，只差选择器/类名/文案。加上 `patch-client-dock.mjs:337-376` 的第三份拷贝，同一逻辑存在 3 处。
2. `RewindButton`（`3345-3453`）与 `RewindFallback`（`3276-3344`）各写一套「菜单定位 + 外部点击关闭 + 手动 `run(mode)`」；`ContinueSafe`（`3133-3161`）又内联一套退化按钮。
3. CSS 分散成 4 份、无单一来源：`PURGE_CSS`（`808-1046`）、`REWIND_CSS`（`2835-2853`）、演练台 `CSS`（`3478-4031`）、脚本注入的 53 行（`patch-client-dock.mjs:75-127`），且后者用 `.dshp-dock-body .rt-*`（`:94-104`）反向覆盖前者的选择器。
4. 同一份法务文本 3 处：`AUTH_LEGAL_HTML`（`client.js:7696`，由 `docs/drill-auth-legal.html` 经 `JSON.stringify` 内联，脚本 `:12-17`）+ 授权弹窗 i18n 条款（`:156-158`、`:63-65`）+ `docs/drill-auth-legal.html` 源文件。
5. 状态机两套：外层 `statusKind/statusLabel/shimKind`（`1054-1081`）与演练台 `rt-*` 状态/`scoreReport` item 体系（`5509` 起）互不复用。

### 6.2 全局可变状态

- `translate`（`13`）在 render 期间被赋值（`2826`、`8708`）——渲染期写模块级变量。
- 6 个 rewind 模块级变量：`rewindSeenAt`/`rewindSessions`/`rewindHost`/`rewindWorkspace`/`rewindConversation`（`2858-2862`）、`pendingComposer`/`armedFill`（`2863-2864`）。
- `dockBus` 手写订阅总线（`7764`）：`setDock` 每次 `Object.assign` 换新对象（`7767`），订阅者异常被 `try{}catch{}` 吞掉（`7768`），`add` 侧无保护。
- `restartOnce`（`2721`）、`drillGrantGen`/`drillGrantPosting`/`drillGrantState`/`drillSyncRetryTimer`（`7692-7696`）。
- 演练台 `ui` + `subs` 第二套全局 store（`4056-4057`）；`dockWidthTag`（`4066`）声明后再未使用，`setDockWidth` 是空函数（`4067`）。

### 6.3 没有错误边界的地方

全文件仅 3 个错误边界：`RewindSafe`（`3123-3131`）、`ContinueSafe`（`3133-3162`，且已随槽位注释掉）、演练台 `RtBoundary`（`7021-7060`，只包页签）。

无边界的高风险块：

- `SettingsRoot`（`2794-2833`）：自身无边界，一个子组件抛错 → 整个 dock（含演练台页签）白屏；它直接 `h(PurgifySection)`、`h(RulesSection)`、`h(SkillsSection)`（`2829-2831`）。
- `PurgifySection`（`1367-2046`，680 行最大的组件）无边界。
- `PurgeDock`（`8348-8541`）直接渲染 `__dshPurgeDrill.Panel`（`8480-8481`），Panel 抛错无兜底。
- `EnvAdaptSendGate`（`8148-8347`）：`shell.submit` patch 的 try 只覆盖门禁调用（`8209-8211`），`patchShell` 本身在 `setInterval` 回调里（`8218-8225`）虽被 try 包住，但失败无日志无告警。
- `HeroNewSessionMount`/`TabRowPurgeMount` 的 `ensure()` 内 `document.querySelector` 全裸（`8563-8588`、`8626-8651`，无 try），只在 React 之外裸调 DOM。
- 交互层用 `window.alert` 报错 3 处（如 `3155`）。

### 6.4 可维护性最差的 5 个区块

1. **`PurgifySection`（1367-2046，680 行 / 28 KB）**：单组件塞 7 条流程（apply/revert/uninstall/update/override/own-servers/restart），`actionTicket` 并发票据 + 嵌套 fetch + `setTimeout` 轮询 + 卸载后 ping 宿主（`1771-1794`）混在一处，`useEffect` 依赖数组含 `defaultOverride`（`1769`）导致隐式重跑。
2. **演练台 CSS 段（3478-4031，~550 行模板字符串）**：与脚本注入的 53 行 CSS 双向覆盖，选择器靠 `.dshp-dock-body .rt-*` 跨文件压权（`patch-client-dock.mjs:94-104`）；结尾反引号已被拼到注释同一行（`4031`），格式化工具一进就炸。
3. **rewind 子系统（2866-3454，589 行）**：深度绑定宿主内部 store（`selection.getSnapshot`/`list.getSnapshot`/`scope`/`sessionOf`/`input.shell`）+ 5 段延时补写（`FILL_DELAYS` `2856`）+ 25 次会话重开重试（`3094`）+ 80/250 ms 两次队列清理（`3087`、`3111`），全是时序猜测。
4. **红队侦测 + 发送门控（7994-8347，354 行）**：三套启发式叠加（DOM 文本正则 `8090-8100` + `shell.submit` monkeypatch `8198-8217` + capture 阶段事件拦截 `8273-8280`），任一失效都静默放行。
5. **DOM 挂载层（8542-8676，135 行）**：绕过 React 树手工 `appendChild` + `createPortal`，选择器靠猜，加上脚本里还留着一份更旧的模板（`patch-client-dock.mjs:337-376`）随时可能回灌。

---

## 一句话结论

这是**由一串脆弱字符串补丁缝合出来的"源码工程"**：外层 4,523 行是能读能改的手写插件源码，中间 4,213 行（48% 体积）是 `patch-client-dock.mjs` 插占位 + `build-client.mjs` 覆盖生成的构建产物，而这份产物已经比它的"源文件"`lib/redteam/client.js` 领先 33 行——构建链不可复现，`client.js` 事实上才是唯一真源。

## 若要做前端重构，建议的拆分模块清单

| 新模块 | 来源行号区间 | 备注 |
|---|---|---|
| `net/api-client.ts` | 14-125 + 8134-8145 | 超时表外置为路由常量；`apiJson` 与 `redteam/api` op 封装统一 |
| `i18n/{zh,en}.json` | 128-806（+ `patch-client-dock.mjs:25-69` 的 dock/auth 键合并） | 3 处重复键收敛为 1 份 JSON |
| `styles/{base,patch,rewind,drill}.css` | 807-1046、2835-2853、3478-4031、`patch-client-dock.mjs:75-127` | 用 CSS 变量命名空间替代 `.dshp-dock-body .rt-*` 压权 |
| `features/patch-status/` | 1097-1366 | 表 + 分组 + hooks-deny + continue-retry |
| `features/code-sauce/` | 1367-2046 | 按流程再拆 `useApply`/`useUpdate`/`useUninstall`/`useOwnServers` + `Panel.tsx` |
| `features/rules/` | 2047-2316 | |
| `features/skills/` | 2317-2395（`semver-lite`）+ 2396-2685（UI） | 版本比较逻辑与 UI 分离 |
| `features/restart/` | 2686-2773 | |
| `host/theme.ts` | 2774-2793 + 8352-8358 | `useHostTheme()` 统一两处 MutationObserver |
| `host/rewind-adapter.ts` | 2866-3122 | 宿主 store 适配隔离层，唯一允许碰 `getSnapshot` 的地方，配快照契约测试 |
| `features/rewind-ui/` | 3123-3475 | `RewindSafe`/`RewindFallback`/`RewindButton`/`ContinueButton` 四合一 |
| `drill/`（20 个文件） | 3476-7688，边界取 4254/4631/4690/4782/4965/4984/5318/5505/5754/5832/6107/6312/6576/6660/6803/7016/7282/7642/7673 | 演练台自带分节注释已是天然模块边界；迁出后回灌 `lib/redteam/client.js` 并删掉双源 |
| `features/drill-gate/` | 7689-7993 | 授权窗 + grant 同步 |
| `state/dock-store.ts` | 7764-7845 | 手写 bus 换 `useSyncExternalStore`，去掉 `try{}catch{}` 吞异常 |
| `host/redteam-detect.ts` | 7994-8133 | DOM 启发式集中一处，可单测 |
| `features/env-gate/` | 8134-8347 | `shell.submit` patch 单独成 `host/submit-hook.ts`，带还原断言 |
| `features/dock-shell/` | 8348-8541 | 双页签 + 拖动/缩放几何 |
| `host/dom-mounts.ts` | 8542-8676 | 两个挂载点抽 `useHostAnchor(selectors[])` 公共 hook，删掉第三份副本 |
| `entry/apply.ts` | 8677-8736 | slot/locale/inject 注册表化 |

迁移前必须先做的 3 件事：

1. 把内嵌副本回灌 `lib/redteam/client.js`（或删除该源），让 `build-client.mjs` 重跑不再回退 `api()` 的 non-json 兜底；
2. 给两个 marker 之间加内容哈希校验，`build-client.mjs` 发现漂移即报错而不是静默覆盖；
3. `patch-client-dock.mjs` 降级为一次性迁移工具并归档，改为对 `client.js` 直接编辑。
