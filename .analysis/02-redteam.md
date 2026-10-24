# lib/redteam 红队子系统 · 完整解剖

模块清单（17 个宿主/浏览器模块 + 3 个预设文件 + 23 个技能 md，合计约 17.6k 行 JS）：

| 文件 | 行数 | 平面 | 职责 |
|---|---|---|---|
| `index.js` | 584 | host | 自举：预设落地、技能同步、registry 声明 |
| `store.js` | 80 | host | Cordis 壳，`ctx.provide('redteam')` |
| `store-core.js` | 5385 | host | 全部业务方法 + prompt 常量 + dispatch |
| `tools.js` | 2019 | host | 56 个 `redteam_*` 工具 + 会话绑定 + 并发闸门 |
| `schema.js` | 630 | host | DDL、FTS5 探测、migrate |
| `score-rules.js` | 936 | host | 25 条得分点、cap/去重/倍数、evaluateScoreBoard |
| `report-replay.js` | 209 | host | 纯函数：报文/命令合成、占位符填充 |
| `ui.js` | 1156 | host | `/redteam/api` HTTP 桥 + 技能桥 + 包更新 |
| `client.js` | 4218 | browser | 手写 bundle：右侧栏控制台 |
| `platform-config.js` | 611 | host | 工具目录探测、env 适配状态 |
| `skill-availability.js` | 354 | host | 技能可用性唯一判定 |
| `skill-fixes.js` | 517 | host | 缺口→修复文案 |
| `preset-composition.js` | 403 | host | 403 行手写 YAML 子集解析器 |
| `role-section.js` | 178 | host | 子会话角色稿注入 |
| `ip-utils.js` | 140 | host | IPv6/CIDR/slug |
| `settings.js` | 77 | host | maxAgents 配置 |
| `validate.js` | 67 | host | webshell 枚举 + 路径断言 |
| `presets/redteam/agent.cordis.yml` | 393 | preset | agent 平面组合 |
| `presets/redteam/anchor-gate.mjs` | 218 | preset | bootstrap 输出预算门 |
| `presets/redteam/preset.yml` | 3 | preset | 下拉显示元数据 |
| `skills/redteam/*.md` | 23 个 | asset | 随包技能正文 |

---

## 一、数据模型

### 1.1 落盘位置（无数据库服务器，全是本地文件）

| 内容 | 位置 | 证据 |
|---|---|---|
| 演练元数据 | `<root>/engagements/<slug>/engagement.yaml` | `store-core.js:955-958`、`store-core.js:1022-1041` |
| 每演练资产库 | `<root>/engagements/<slug>/assets.db` | `store-core.js:957` |
| 全局知识库 | `<root>/knowledge.db` | `store-core.js:4496` |
| POC 正文 | `<root>/pocs/<code>/<file>` | `store-core.js:4588` |
| 截图 | `<id>/shots/` | `store-core.js:4225` |
| 攻击文件 | `<id>/attack-files/` | `store-core.js:4415` |
| 角色稿 | `<id>/agents/<code>.md` | `store-core.js:1022-1041`、`role-section.js:109` |
| 报告目录 | `<id>/reports/`（与 `runs/` 一起建） | `store-core.js:1022-1041` |
| 当前演练指针 | `<root>/current`（**纯文本一行**） | `store-core.js:937-946`、`role-section.js:93-103` |
| 平台/工具适配 | `platform-config.js:17` `configPathOf` | `platform-config.js:84-152` |
| 并发设置 | `settings.js:21` `settingsPathOf` | `settings.js:26-71` |
| 预设声明状态 | `<root>/preset-declare.json` | `index.js:453-462` |
| 演练授权 | `$DSH_HOME/dsh-purge/drill-grant.json`（**在 redteam 之外**） | `lib/drill-grant.js:9-11` |

`root` 解析顺序：config.root → `REDTEAM_HOME` → `$DSH_HOME/redteam`（`store.js:29-34`）。

### 1.2 表结构（26 张表 + 2 视图 + 2 张 FTS5 虚表）

DDL 是**一条长字符串常量** `DDL`（`schema.js:67-360`），打开库时整段 `exec`，靠 `IF NOT EXISTS` 幂等。

| 域 | 表（行号） | 关键约束 |
|---|---|---|
| 扫描/网段 | `scan_run`(72)、`segment`(78) | — |
| 资产 | `asset`(84)、`asset_name`(95)、`port`(102)、`service`(111)、`fingerprint`(117)、`observation`(125) | `asset UNIQUE(segment_cidr, ip)`(92)、`asset_name UNIQUE(asset_id,name,kind)`(99)、`port UNIQUE(asset_id,proto,port)`(108) |
| 图 | `edge`(132)、`tag`(141) | `UNIQUE(src_kind,src_id,dst_kind,dst_id,relation)`(138) |
| 成果 | `vuln`(147)、`credential`(223)、`http_evidence`(260) | `credential UNIQUE(host,username,secret_type)`(229) |
| 入口 | `access_session`(233)、`webshell`(240)、`tunnel`(250) | `webshell UNIQUE(url,pass_key)`(246) |
| 得分 | `score_point`(155)、`stage`(189)、`score_hit`(202) | — |
| 杀伤链/证据 | `attack_file`(269)、`attack_step`(280)、`shot`(291) | `attack_file UNIQUE(target,name)`(274)、`shot UNIQUE(file)`(299) |
| 知识库 | `poc`(365，属于 `KNOWLEDGE_DDL`) | `UNIQUE(code)`(393) |
| 检索 | `asset_fts`(54)、`poc_fts`(60) | FTS5，编译期不可用则整段跳过 |
| 视图 | `v_asset_summary`(349)、`v_asset_service`(356) | — |

约 35 条 `CREATE INDEX`（`schema.js:303-347`）。`category` / `engagement` 的索引**故意不写在 DDL 里**，留给 `migrateKnowledge()` 建，因为老库没有这两列（`schema.js:398-400`）。

### 1.3 关系主线

```
segment(segment_cidr) ──< asset(segment_cidr, ip)
                            ├──< port(asset_id) ──< service / fingerprint
                            ├──< asset_name(asset_id)          （名称/归属）
                            ├──< vuln(asset_id) ──< http_evidence(vuln_id)
                            ├──< score_hit(asset_id, point_id, vuln_id)  ──> score_point / stage
                            └──  observation
attack_file(target,name) ──< attack_step(file_id) ──> score_hit（#hitTrace 取"怎么拿到的"）
credential(host,username) ──> access_session / webshell / tunnel（入口三件套）
edge(src_kind/src_id → dst_kind/dst_id)  ：跨实体通用有向图，`asset_link` 写入（`tools.js:869`）
shot(file) ── 通用图片证据，按得分点认领导出报告图（`store-core.js:3112` 区段）
```

实体之间**没有外键级联删除**，`foreign_keys=ON` 只做约束不做清理；删除靠各 `delete*` 方法自己收尾（如 `deleteShot` `store-core.js:4330`）。

### 1.4 持久化实现

- `node:sqlite` 的 `DatabaseSync`（同步 API），无 ORM、无 `DocumentStore`、零外部依赖（`store-core.js:1-30`）。
- 句柄缓存：`handles` Map 以 engagement id 为键，`db(id)` 首次打开时 `exec(HAS_FTS5 ? DDL+ASSET_FTS_DDL : DDL)` 再 `migrate()`（`store-core.js:966-981`）；`close()` 逐个 `close` 并清缓存（`store-core.js:983`）。
- 打开即设 `PRAGMA journal_mode=WAL` / `foreign_keys=ON` / `busy_timeout=5000`（`schema.js:67-71` 起）。
- FTS5 是**运行期探测**：临时库建一张 `fts5(x)` 试探，失败就整段不装，`REDTEAM_NO_FTS5=1` 可强制关（`schema.js:31-44`）。
- 知识库走独立 DDL：`knowledgePath()` → `migrateKnowledge()`（`store-core.js:4496`、`schema.js:605-630`）。

### 1.5 事务与并发

**全子系统只有一处显式事务**：`importBundle` 里 `db.exec('BEGIN')`（`store-core.js:5209`）→ `COMMIT`（`:5269`）→ 异常 `ROLLBACK`（`:5271`）。其余全部依赖 SQLite 自动提交：一条语句一个隐式事务，多语句写入（例如一次 `addScoreHit` 连带写关联）在中途抛错时会留下半条记录。

并发模型是"**单进程单写者**"：

- 所有写操作共用同一 `DatabaseSync` 实例 → 调用方天然串行。
- 真正的并发源是**会话数 × 子智能体数**（≤3，`settings.js:15`、`tools.js:112`），它们都在同一进程内，不产生锁竞争。
- 跨进程（桌面端 + Web 端 + CLI 同时开同一 `$DSH_HOME`）才会触发 `busy_timeout=5000` 的重试窗口；没有应用层重试循环，超时直接抛。
- 迁移靠"PRAGMA 探列 → ALTER"做到幂等（`schema.js:466-597`），空 `catch` 吞掉并发 DDL 冲突。

### 1.6 迁移策略与一处真实缺陷

策略是**只加列、不重建表**：

1. `has()` 用 `PRAGMA table_info` 逐列探测；
2. `ensure()` 探测 + `ALTER TABLE ADD COLUMN` 放 try/catch（`schema.js:477-481`）；
3. 约 35 个 `ensure()` 覆盖全部后加列（`schema.js:483-538`）；
4. 旧枚举值清理用显式 DELETE（`schema.js:540-545`）；
5. `DROP COLUMN` 移除 `attck`、`blue_team`、`score_point.stage_code`；
6. 回填：`scope` 用 `SCOPE_SQL`（`schema.js:591`，SQL 定义在 `store-core.js:154-158`）、`discovered_at`（`:595`）、`score_hit.port` 从 `parseTargetPort` 推（`:571-580`）。

两个坑：

- **两套 `has()` 语义相反**：engagement 版探测失败返回 `false`（当作没有列，继续 ALTER，`schema.js:471-475`）；knowledge 版探测失败返回 `true`（当作已有列，跳过，`schema.js:609`）。注释里是刻意的，但极易看错。
- **悬空引用**：`schema.js:586` 在 `attack_step.stage → stage_code` 回填里用了 `LEGACY_STAGE_MAP`，而 `schema.js` 顶部只导入了 `DatabaseSync` 和 `parseTargetPort`，**从未导入该符号**；它定义在 `store-core.js:355` 并从那里导出。这段代码被 `try{}catch{}`（`schema.js:583-588`）包住，`ReferenceError` 被静默吞掉 —— 结果是**任何库上"历史 stage 回填"从未真正执行过**，老 `attack_step.stage` 会一直为空。修法只能是把映射表作为参数从 `store-core` 传进 `migrate()`（反向往 `schema.js` 导入会形成循环依赖）。

---

## 二、状态机与流程

### 2.1 演练（engagement）生命周期

```
openEngagement(name)                     store-core.js:1022-1041
  ├─ slugify(name) → id                  ip-utils.js:87
  ├─ mkdir agents/ runs/ reports/
  ├─ 写 engagement.yaml                  target_name / scope_cidrs / status:'active' / created_at / updated_at
  ├─ db(id,{create:true}) 建库
  ├─ seedScorePoints(id)                 1476  （25 条内置得分点入 score_point）
  ├─ 写默认提示词                        refreshDefaultPrompts / promptHash
  └─ options.bindCurrent !== false → setActiveEngagement   （子会话不抢 current 指针）
```

- 枚举值只有 `status:'active'`（`store-core.js:1022-1041`），**没有 closed/archived 状态机**；`close()` 只关数据库句柄（`:983`），`listEngagements()` 按目录扫描 + 读 meta 展示（`:995-1021`）。
- 切换演练 = 重写 `<root>/current` 一行（`:947`）。这就是全部"状态机"。
- 每个会话有自己的绑定，`setActiveEngagement` 在 `bindCurrent:false` 时不写全局指针 —— 这是多会话隔离的关键一行。

### 2.2 阶段机（5 个阶段）

```
recon → internet → boundary → internal → target
```

- 定义：`DEFAULT_STAGES`（`store-core.js:227+`），合法码表 `VALID_STAGE_CODES`（`:365`），历史映射 `LEGACY_STAGE_MAP`（`:355`）。
- 得分点 → 阶段的推导：`scoreStageOf()`（`:342`），特例表 `POINT_STAGE_OVERRIDE`（`:285`），短名 `POINT_SHORT_NAME`（`:306`）。
- 建行 `seedStages`（`:1420`）、读 `listStages`（`:1438`）、改 `saveStage`（`:1452`）。
- 阶段不是独立状态机而是**派生视图**：`attack_step.stage_code` 是唯一持久事实，攻击链页（`client.js:2029` `groupByStage`）与 `scoreChain`（`store-core.js:3758`）都用同一条推导，避免两处排序不一致。

### 2.3 角色机（6 个角色）

- `ROLE_ORDER`（`store-core.js:727`）= `plan` + `recon` / `assess` / `vuln-scan` / `exploit` / `internal`；`PLANNER_ROLE='plan'`（`:728`）；标题表 `ROLE_TITLES`（`:76`）。
- 角色稿正文默认值在 `DEFAULT_PROMPTS`（`:472-725`），配 8 个 `// __REDTEAM_PROMPTS_BLOCK__` 占位（`:392-398`）；版本用 sha1 前 12 位做 `promptHash`（`:388`），manifest 落 `agents/.defaults.json`，语义是"默认跟新版本走、用户改过的永不覆盖"（`refreshDefaultPrompts` `:5308`、`readPromptManifest` `:5282`）。
- 下行链路：指挥在 `subagent` 的 prompt **第一行**写 `redteamRole: <code>`（`agent.cordis.yml:61`）→ `role-section.js:14` 的 `ROLE_TAG` 抓取 → `:105-115` 读 `agents/<code>.md` → `:117-135` 交给系统提示词组装。**没有这一行就不猜角色**（`role-section.js:7`）。
- 容量：`roleBySession` Map 400 条上限、溢出淘汰最旧 100（`role-section.js:19-30`）。

### 2.4 并发闸门

- 工具 `redteam_agent_slot`（`tools.js:729`）+ `reservations` Map（`:93`，cap 500）+ `maxAgentsNow()`（`:112`）。
- 上限来源：`DEFAULT_MAX_AGENTS=3`、`MAX_AGENTS_LIMIT=10`、env `REDTEAM_MAX_AGENTS`（`settings.js:15,18,55`），`clampMaxAgents`（`:43`）。
- 自动释放：`subagent/end` 事件 → `dropReservation`（`tools.js:301-314`，找不到精确键时退化为淘汰最旧键）。
- UI 侧：`ConcurrencyCard`（`client.js:3627`）、`AgentsTab`（`:3566`）。

### 2.5 三道"门"的真实关系（`anchor-gate.mjs` / `drill-grant.js` / `drill-auth-legal.html`）

| 门 | 物理位置 | 干什么 | 是不是安全/授权门 |
|---|---|---|---|
| 锚点门 | `presets/redteam/anchor-gate.mjs`（218 行）+ 预设行 `agent.cordis.yml:118-125` | bootstrap 阶段把 `maxTokens` 压到 8192；首段思考"有 `we` 无 `let me`"才算锚住（`anchor-gate.mjs:21-28`）；锚不住最多 2 步（`maxBootstrapSteps: 2`，预设 `:122`）；`compaction/end` 复位重关门（`:150-151`、`:185-188`）；放开后把 `agent-instructions` 整段改写成"参考文档存在、按需再读"（`:74-109`、`:190-200`） | **不是**。它是 token 预算门，注释明写"不裁工具、不换人设"（预设 `:117`） |
| 环境适配门 | `ui.js:1028-1077`（`agent/pre-step`，`turn<=1 && step<=1 && preset==='redteam'` → `kind:'reject'`）+ 状态源 `platform-config.js:532` `envAdaptStatus` / `:589` `markEnvAdaptSkip` | 环境未适配就拒绝首步 | 流程门 |
| 授权门 | `lib/drill-grant.js:9-50`（`$DSH_HOME/dsh-purge/drill-grant.json`，tmp+rename 原子写）→ 端点 `lib/index.js:2154-2168`（`/dsh-purge/drill-grant` GET/POST）→ 前端根 `client.js:7722,7737`；正文 `docs/drill-auth-legal.html` 由 `scripts/patch-client-dock.mjs:12-17` 内联进 bundle，倒计时 + 三勾选文案在 patch 脚本 `:33-45` | 首次进演练台 / 全面浏览的书面授权确认 | 是授权门，但**完全在 `lib/redteam` 之外**（host 平面 `lib/index.js` + 根 `client.js`），`lib/uninstall.js:8` 负责卸载时删除 |

结论：`lib/redteam` 内部**没有任何授权校验代码路径**。子系统只提供"环境没适配就拒绝首步"这一道软门；授权门由外层插件与客户端 bundle 承担，redteam 只是被保护对象，不感知它的存在。

---

## 三、工具层

### 3.1 总述

**56 个工具，全部注册在 `tools.js`，全部只读写本地 SQLite 与文件。**

- 零子进程：在 `tools.js` 里 grep `execFile|spawn|child_process` 无命中。
- 唯一网络副作用：`redteam_session_check`（`tools.js:1406-1415`）→ `store.probeSessions`（`store-core.js:3972`），对 webshell 发 `fetch`、对 tunnel 做 `tcpConnect`，并把结果状态写回库。
- 唯一遍历宿主环境的：`redteam_preflight`（`tools.js:486-728`）读 `process.env`、`$DSH_HOME/.env`、平台配置，`existsSync` 检查 toolkit / VPS key / `.setup-complete` / `setup.sh`，调 `skills.list()/get()`，产出 `onboarding{complete, first_run, missing, setup_script, toolkit}`；它明确"不替用户下载或安装任何工具"（`tools.js:533`、`store-core.js:483`）。
- 公共外壳：`loadDefineTool`(`:57`)、`defineTool`(`:81`)、`withStructuredErrors`(`:341-363`，统一 `{ok:false,error,error_kind:'bad_input'|'failed',hint}`)、`AGENT_PARAM`(`:326`)。
- 会话绑定：`bindings` Map(`:90`，cap 500)、`bindingKeyOf`(`:168`)、`resolveEngagement`(`:185`)、`bindKeysOf`(`:263`)。
- 路由规则在 `dispatch`：写类 op（`^(add|save|update|delete|import|assess|open)`）必须有 engagement，否则抛；只读 op 无 engagement 时返回内置提示或空集（`store-core.js:786-805`）。

### 3.2 分组表（名称 + 行号）

**A. 演练生命周期与角色（8）**
`engagement_open`(408)、`session_bind`(437)、`session_info`(470)、`preflight`(486)、`agent_slot`(729)、`roles`(1000)、`role_prompt`(978)、`role_prompt_reset`(1242)

**B. 资产测绘（9）**
`asset_add`(784)、`asset_link`(869)、`asset_query`(895)、`asset_get`(927)、`asset_stats`(943)、`asset_graph`(954)、`asset_test`(1013)、`asset_assess`(1595)、`asset_timeline`(1996)

**C. 漏洞 / 凭据 / 证据（9）**
`vuln_add`(1037)、`vuln_query`(1063)、`vuln_update`(1084)、`credential_add`(1107)、`credential_list`(1191)、`shot_add`(1133)、`shot_list`(1159)、`shot_delete`(1177)、`http_evidence_add`(1617)

**D. 会话与入口（10）**
`access_add`(1206)、`access_list`(1228)、`sessions`(1262)、`webshell_add`(1287)、`webshell_list`(1310)、`webshell_update`(1325)、`tunnel_add`(1344)、`tunnel_list`(1370)、`tunnel_update`(1384)、`session_check`(1406，**唯一发起网络请求**)

**E. 得分（3）**
`score_list`(1494)、`score_hit`(1530)、`score_point_save`(1574)

**F. 攻击链 / 攻击文件 / 报告（9）**
`chain_add`(1641)、`chain`(1677)、`attack_path`(1427)、`attack_chain`(1746)、`attack_file_add`(1688)、`attack_file_list`(1712)、`report_targets`(1727)、`score_report`(1775)、`report`(1796)

**G. Web 与域名索引（2）**
`web_list`(1457)、`domain_index`(1481)

**H. 知识库 / POC（6）**
`poc_search`(1813)、`poc_get`(1872)、`poc_add`(1887)、`poc_list`(1938)、`poc_update`(1956)、`poc_use`(1979)

合计 8+9+9+10+3+9+2+6 = **56**。

### 3.3 参数与副作用

| 类别 | 工具 | 真实副作用 |
|---|---|---|
| 本地写（最常见） | A/B/C/D/E/F 里的 add/update/save/link/hit | 一条或几条 SQL + 可能写文件（`shot_add` 落 `<id>/shots/`，`attack_file_add` 落 `attack-files/`，`poc_add` 落 `<root>/pocs/`） |
| 只读 | `asset_query/get/stats/graph/timeline`、`vuln_query`、`chain`、`attack_chain`、`score_list`、`report_targets`、`web_list`、`domain_index`、`sessions`、`poc_search/poc_list` | 纯 SELECT |
| 计算重 | `score_report`（→ `scoreReport` 1086 行）、`report`（→ `report` 181 行）、`attack_chain`（→ `scoreChain`） | CPU + 大字符串拼接，无 IO 副作用 |
| 网络 | `session_check` | `fetch` webshell URL、`tcpConnect` tunnel listen（`store-core.js:3972`） |
| 环境探测 | `preflight`、`roles` | 读 env/文件系统/技能服务 |

所有工具共享 `agent` 参数（`AGENT_PARAM` `tools.js:326`），绑定失败时按 `bindKeysOf` 的父会话链向上找，找不到才报错。

---

## 四、评分体系

### 4.1 规则数据模型

一条得分点的字段工厂 `sp(src, rule, tier, code, name, category, points, cap, dedup_scope, description)`（`score-rules.js:721-723`）。**两个编号不要混用**：

- `src` = 《突破入侵类得分规则（合并版）》里的原序号，只用于对账；
- `rule` = 内部**上限分组键**，必须唯一，`applyScoreCaps` 按它累计 cap。`score-rules.js:708-720` 记录了历史 bug：曾直接用原序号当分组键，导致 16/17 合并行与 19 的两个子项共用键，一条命中吃掉另一条的上限。

规模：**25 条**得分点（`score-rules.js:769-924`），**8 个类别**（`:758-767`：GENERAL / WEB / CENTRAL / BIGDATA / NETINFRA / STORAGE / MODEL / BOUNDARY），**8 条通用规则 G1–G8**（`:730-739`，不单独计分，横切所有条目），**4 种去重口径** `DEDUP_SCOPES = ['service','system','target','none']`（`:706`）。

| 类别 | 代表条目（code / points / cap / dedup） |
|---|---|
| WEB | `web-app` 100 / 2000 / system（合并原表 5、6 项，`score-rules.js:795-806`） |
| CENTRAL | `central-system` 500 / 4000 / system（`:808-817`，并明确"托管主机按 G4 的 10 分/台，不许按 500 算"） |
| BIGDATA | `bigdata-system` 1000 / 4000 / system（`:819-822`） |
| NETINFRA | `netdev` 200 / 2000 / service（`:824-830`）、`iot-corenet` 5000 / 5000 / none（`:919-923`） |
| STORAGE | `file-storage` 50 / 500 / system（`:852-855`） |
| MODEL | `model-compute` 500 / 4000（`:862-868`）、`computepower-cards` 10 / 2000 / none（`:881-883`） |
| BOUNDARY | `boundary-logical` 1000 / 0 / target、`boundary-strong` 10000 / 0、`boundary-physical` 30000 / 0（`:885-896`） |
| GENERAL | `domain-control` 50 / 400 / system、`server-host` 50 / 600 / system（`:772-787`） |

`cap = 0` 表示不设上限。

### 4.2 计算链

```
score_hit（自带 points / multiplier 快照）
   ↓  hitPointsOf(score-rules.js:362)  ← scoreMultiplierOf(:407)
有效分值（G5 ×2：≥1e6 行或 ≥10TB，阈值 SENSITIVE_DATA_MIN_ROWS=1000000 :494；G6 ×3：targetHasIpv6Host :385，且不突破原 cap）
   ↓  evaluateScoreBoard(score-rules.js:435)
   │     ├─ applyScoreCaps(:162-266) 按 rule 累计上限、按 dedup_scope 去重
   │     │     ├─ pickBestHit(:311)   G1：同系统只计最高档，自动吞掉低档
   │     │     ├─ systemKeyOf(:267)   同系统判定键
   │     │     └─ scoreCapReasonText(:471) / serviceCapReason(:485) 生成"为什么不计"的理由
   │     └─ byId: Map<hitId, {capped}>
   ↓
面板 listScorePoints(:1587) ｜ 报告 scoreReport(:2673) ｜ 链路 scoreChain(:3758)
```

三个出口**故意共用同一个实现并都传 `enabledOnly:true`**：面板只累加启用的得分点（`:1639`），报告同步过滤（`:2731-2740`），链路同步（`:3807-3830`）。`store-core.js:2714-2718` 的注释记录了为什么要这么写：曾经面板显示 6340 分、报告写 7930 分，同一个交付物自相矛盾。

另外两个"不算成果"的过滤：`self_created=1` 的命中（自己注册的账号）只报个数不进正文（`:2709`、`:2740`）；超出上限的命中同样只报个数（`:2741` `serviceCappedRows`）。

### 4.3 报告复现链（`report-replay.js`，209 行纯函数、零依赖）

| 函数 | 行号 | 作用与关键决策 |
|---|---|---|
| `parseTarget` | 27 | 拆 scheme/host/port/path；**IPv6 必须两步解析**（先 `[]` 取 authority，再按最后一个冒号剥端口），否则会把 host 解成 `2001:db8:`（`:16-26` 记录了这个实测事故） |
| `commandKind` | 67 | 判断这条 `tool` 字符串是不是可直接复现的命令（curl / httpie / scanner / msf / script / other） |
| `parseCurl` | 82 | 从 curl 里保守抽 URL/方法/体/头/Cookie/`-k`/`-L`，抽不出返回 null，不猜 |
| `buildHttpRequest` | 109 | 合成可粘进 Yakit Repeater 的报文；IPv6 的 Host 头补方括号（`:114`），自动补 UA/Accept/Cookie/Content-Length |
| `buildCurlCommand` | 142 | 真 curl 原样优先（`:144`），否则按 URL/方法拼 |
| `fillTemplate` | 174 | 用本条得分已知的 host/port/user/pass/url 填 `<host>` 等占位符，**没填的保持原样并如实报告** `remaining`（`:205`） |

两条底线写在文件头（`:9-12`）：合成的东西必须标 `synthesized:true`；信息不足宁可留空给补录指引，不编造。

### 4.4 `scoreReport` 内部（`store-core.js:2673-3758`，1086 行）

| 区段 | 行 | 内容 |
|---|---|---|
| 取数 | 2677-2685 | `score_hit` LEFT JOIN `score_point` / `asset` / `vuln`，`limit` 上限 2000 |
| 归一与评估 | 2719-2741 | `effPoints`→`hitPointsOf`；`evaluateScoreBoard(..., {enabledOnly:true})`；三分 `rows` / `reportRows` / `serviceCappedRows` |
| 逐条组装 | 2743-3060 | `#hitTrace`（`:2503`）取"怎么拿到的"；原始请求两级降级匹配（先按 `vuln_id` 显式关联，再按 asset + 目标路径逐级降级，`:2753-2790`） |
| 复现入口 | 2794-3300 | 合成边界（`:2809`）、命令挑选（`:2824`）、入口分类（`:3285`） |
| 条目合并 | 3061-3111 | 同得分点 + 同动作、只有目标不同的合并成一条 |
| 截图认领 | 3112-3161 | 按得分点取最多 3 张，分组条目由成员共同认领 |
| 链路排序 | 3162-3184 | 阶段序 + 阶段内动作先后 |
| 前置推导 | 3185-3284 | 这条成果靠哪条成果铺出来 |
| markdown 渲染 | 3319-3758 | 五段：⓪摘要与对账(3361) ①复现前置(3418) ②攻击链(3502) ③逐条明细(3520) ④得分点说明(3694) ⑤附录(3710) |

---

## 五、UI 层

### 5.1 两半分工

| | `ui.js`（宿主） | `client.js`（浏览器） |
|---|---|---|
| 形态 | 标准 ESM Cordis 插件 | 手写 bundle **源码文本**，由 `scripts/build-client.mjs` 抽成根 `client.js`（`client.js:1-11`） |
| 名字/依赖 | `dsh-purge-redteam-ui`(148)、`inject=['redteam','webServer']`(155) | `window.__ModuleLoader__.load({id:'dsh-purge'})`、`inject=['slots']`(4179) |
| 职责 | `/redteam/api` HTTP 桥、技能目录桥、包版本检查与更新 | 右侧栏控制台全部渲染与交互 |
| 硬依赖策略 | **只硬依赖两个**，skills/agentPresets 软取（`:150-155`），缺了也不让整条接口挂掉 | 只依赖槽位注册表 |

### 5.2 HTTP 契约（`ui.js:1079-1155`）

1. `POST` only，否则 405（`:1083`）。
2. body 上限 8MB（`MAX_BODY_BYTES :158`，`readBody :590`）。
3. 来源校验：本机回环一律放行；`Origin` 为 `app://` / `null` / 空且 Host 是本地时放行；否则要求 Origin 与 Host 同源（`:1090-1113`）。注释说明了为什么要放宽：官方桌面端的 Origin 是 `app://`，旧的严格判断会把技能库/知识库/SQL 全判 403。
4. op 分派顺序：`handlePlatformOp`(276) → `handleAgentsOp`(905) → `handleUpdateOp`(956) → `handleSkillOp`(690)（失败时回落 `handleSkillOpFromPluginDir`(795) 直读包内文件）→ 兜底 `dispatchAsync`(`store-core.js:873`，只有 `probeSessions` 是 async)。
5. 错误统一 `sendJson(res, 400, {ok:false,error})`（`:1152`）。

### 5.3 DSH 槽位契约（`client.js:4185-4212`）

四处注册，样式随 fiber 卸载：

| 槽位 | id | order | 组件 | 行号 |
|---|---|---|---|---|
| `shell.overlay` | `redteam-console` | 50 | `Panel` | 4196-4199 |
| `sidebar.footer.action` | `redteam-toggle` | 50 | `SidebarButton` | 4200-4203 |
| `sidebar.footer.action` | `redteam-full` | 51 | `FullButton` | 4204-4207 |
| `conversation.session.header.utilities` | `redteam-header-toggle` | 50 | `HeaderButton` | 4208-4211 |

`<style data-redteam-ui>` 在 `apply` 里 append，`ctx.effect` 卸载时移除（`:4186-4194`）。

### 5.4 面板组织

- `Panel`（`:3844`，约 303 行）是 `position:fixed` 浮动 dock，`inject` 进 overlay 后自己管理宽度；`.rt-embedded` 变体给内嵌场景。
- 全屏走 `#redteam-full` hash + `window.open` 新窗口（`FullButton :4166-4175`），Esc 退出（`:4142`）。
- 三份 localStorage 状态：dock 几何 `rt-dock-geom-v1`（`:3815-3843`，含 `clampRtGeom` / `defaultRtGeom`）、折叠 `rt-collapse:`（`:3097-3110`）、未读 `rt-unread:`（`:3792-3814`，`digestHasNew` 判断红点）。
- 运行时状态是**模块级单例** `ui` + 订阅集合 `subs`（`:573-583`、`useUI :585`），没有引入状态库。

### 5.5 页签与体量

| 页签 / 组件 | 行号 | 约行数 |
|---|---|---|
| `AssetsTab`（含 `DiscoveryView`） | 772 / 1155 | 383 |
| `PromptsTab` | 1208 | 92 |
| `SkillsTab` | 1300 | 183 |
| `FindingsTab`（含 `HttpBlock`/`detailEvidence`） | 1559 | 277 |
| `ChainTab`（含 `groupByStage`） | 1845 / 2029 | 184 |
| `ReportTab` | 2050 | 221 |
| `AttackFilesTab`（含 `FILE_KIND`） | 2273 | 81 |
| `KnowledgeTab` | 2357 | 271 |
| `EnvTab` | 2628 | 201 |
| `ScoreTab` | 2829 | 268 |
| `TestingTab` | 3186 | 138 |
| `SessionTab` | 3324 | 213 |
| `AgentsTab` + `ConcurrencyCard` + `VersionBar` | 3566 / 3627 / 3679 | 226 |
| `Panel` | 3844 | 303 |
| CSS（内联模板字符串） | 23-560 | 537 |

### 5.6 越界与重复

- `ui.js:163-244` 的 `run()`（spawn + `taskkill /T /F` 杀树 + 1MB IO 上限）与 `:313-589` 的 `updatePreflight` / `checkLatest` / `restartScript` / `applyUpdate`，**约 500 行与红队无关**，是给整个 `dsh-purge` 包用的版本更新器。
- 技能读取在两处实现：宿主 `ui.js:649-905`（带 30s TTL 缓存 `:626`）与客户端 `SkillsTab`（`client.js:1300`）。
- 值映射常量在客户端重复定义：`POC_CAT_NAME`(:597)、`ROLE_LABEL`(:606)、`SEV_LABEL`/`STATUS_LABEL`(:1483)、`STAGE_LABEL`(:1836)、`FILE_KIND`(:2271)、`TEST_STATUS_LABEL`(:3177)，与宿主侧 `ROLE_TITLES`/`SEVERITIES`/`POC_CATEGORIES` 各存一份。
- `client.js` 是"ESM 仓库里的非 ESM 文件"：其它模块都是标准 `import`/`export`，只有它是 `factory:(require)=>{...}` 源码文本，改它必须靠字符串级 patch 脚本（`scripts/patch-client-dock.mjs`）。

---

## 六、skill 系统

### 6.1 分发与落地

- 23 个 md 在包内 `skills/redteam/`，`installBundledSkills()`（`index.js:157-176`）复制到 `$DSH_HOME/redteam/skills`；`skillSyncTargets()`（`:138-151`）在 `DSH_HOME` 与 `homedir()/.dsh` 分叉时**两边都写一份**（注释记录了"装了却列不出来"的主因）。
- 预设侧只有两行 `customSkillDirs` 加一个开关（`agent.cordis.yml:193-200`）：

```yaml
config:
  includeDefaultRoots: false          # 不把 .agents/skills、项目级技能包一起吞进来
  customSkillDirs:
    - !!js dshHomePath('skills')          # 用户根，必须在前
    - !!js dshHomePath('redteam/skills')  # 随包根
```

技能根顺序即优先级（`agent.cordis.yml:191-192`）：`$DSH_HOME/skills` 排前面，否则用户在自有副本里配好的 VPS 地址/密钥会被随包模板（`<你的VPS_IP>` 这类占位符）盖住。

### 6.2 组装

- 发现层由 `skill-filesystem`（`agent.cordis.yml:188-200`）提供，加载与 catalog 由 `tool-skill`（`:202-203`）提供 —— 红队**不再维护私有技能目录**（`:184-187`），全部走原生 `skill` 工具。
- 自举时的路径清洗是这套机制的前置条件：`SKILLS_PLACEHOLDER = '{{REDTEAM_SKILLS_DIR}}'`（`index.js:92`）必须在落地时替换掉，否则 YAML 会被解析成对象、整个预设挂不上（`:106-113`）；`isSkillsDirLine`（`:95-101`）还认得三种历史脏路径，落地时统一改写成 `dshHomePath('redteam/skills')`。

### 6.3 可用性判定（`skill-availability.js`，354 行，全仓唯一一份）

四个维度，全部可从技能正文客观读出：

1. **正文可加载**：正文在手 = 可用；`file` 路径不存在只记一条非阻塞 `file-stale`（`:287-289`），因为技能路径是绝对路径、换机器必然指空。
2. **必需 env**：`process.env.X`、`os.environ["X"]`（`os.environ.get("X","默认")` 不算）、shell 的 `${X:?}` 三种写法（`:63-75`）。
3. **引用路径**：只认 `/toolkit|bin|local/` 下的绝对路径，且做平台/架构过滤（`pathCountsOnThisHost :78-95`：Windows 上不拿 `.sh`/linux 命名的文件判不可用），在建/不存在用**两个候选 home 任意一个命中即算存在**（`:55-60`）。
4. **外部占位符**：`<你的VPS_IP>` / `<VPS_IP>` / 主机名；判定顺序必须"先看 `REDTEAM_VPS_HOST` 有没有配，再看占位符"（`:309-314`），否则配好的机器会永远显示 broken。

输出：`{status:'available'|'broken'|'unknown', issues:[{kind,detail,fix}], problems, needs_user, checked}`（`:338-346`）；另有 `shadowed` 兜底 —— 同名技能在别的根里有一份更好的版本时如实说明是被盖住了（`:323-335`）。`summarizeSkills`（`:350`）给面板顶栏与 preflight 共用。

### 6.4 修复文案（`skill-fixes.js`，517 行）

- 统一入口 `bash $DSH_HOME/redteam/setup.sh --yes`（`:17`，`GENERIC_FIX :20`）。
- `TOOL_FIXES` 覆盖 40+ 工具（`fscan:42`、`gogo:47`、`chisel:57`、`frp/frpc/frps:62-64`、`subfinder:65` … `mysql:270`），每组写 `what` / `install` / `verify`。
- `SKILL_FIXES:278` 针对技能级缺口。
- 工具名归一 `cleanToolName:380` / `toolNameOfPath:400` / `canonicalTool:421`（带 `EXT_RE` / `PLATFORM_RE` / `ARCH_RE` 剥后缀，`:370-374`），`ENV_HINTS:429`，总调度 `fixesForIssue:450`。

### 6.5 提示词组装顺序（实测）

```
① preset persona.prefix（agent.cordis.yml:33-114）
     运行环境前提 → 指挥职责（硬约束）→ 开工前必须做技能与资源预检 →
     并发硬约束（最多 3 个）→ 六个角色索引 → 按用户输入决定怎么开工 →
     会话隔离 → 子智能体回报的核对 → 什么时候才跟用户说话 → 汇报口径 → 红线
② anchor-gate 在 promote 之后把 agent-instructions 整段改写成"参考文档存在"提示
     （anchor-gate.mjs:92-109, 190-200）
③ role-section 把 engagements/<id>/agents/<code>.md 原样插进"清洗稿与运行环境前提之间"
     （role-section.js:1-8 的设计说明，:117-135 的实现）
④ 工具清单与技能 catalog 由 tool-skill 与各工具行提供（agent.cordis.yml:127-133, 202-203）
```

### 6.6 自举（`index.js`，584 行）

| 步骤 | 行号 | 语义 |
|---|---|---|
| `installPreset` | 350-421 | 目标不存在 → 整份安装；已存在 → **只自愈不覆盖**；`force` 或 `needsCompositionRepair` 命中才整份重写 |
| `renderSkillsDir` | 114-128 | 占位符 / 失效绝对路径 → `dshHomePath('redteam/skills')` |
| `renderToolsPackage` | 195-203 | `dsh-redteam-mode/tools` → `dsh-purge/redteam/tools` |
| `repairDelegation` | 209-266 | 标题改名 + 补"必须用原生 `subagent`"约束 + 把 4 个 subagent 工具行的 `disabled: true` 改回 `false` |
| `syncAnchorGate` | 297-335 | 每次用包内副本覆盖 `anchor-gate.mjs`，并同步 YAML 里的锚点配置块 |
| `needsCompositionRepair` | 179-192 | 缺 `id: workflow-ptc` 或 worker-thread 仍 `provider: spawn` → 整份重建 |
| registry 声明 | 484-575 | 软取 `ctx.agentPresets`，400ms 轮询、45s 超时，写 `preset-declare.json` 状态文件 |
| `preset-composition.js` | 全文 403 | 手写 YAML 子集解析器，**fail-closed**（锚点/别名/嵌套流集合/制表符一律抛 `CompositionError`，`:24-27`），把 `agent.cordis.yml` 变成 `{id, name, description, order, plugins}`（`:389-402`），相对模块名解析成 `file://` URL（`:337-350`） |

---

## 七、规模问题

### 7.1 `store-core.js`（5385 行）内部结构

| 区段 | 行范围 | 行数 | 说明 |
|---|---|---|---|
| import + 再导出 | 1-66 | 66 | 从自身拆出的模块反向 re-export（`:53-66`） |
| 常量 | 70-390 | 320 | `ROLE_TITLES`(76)、`SEVERITIES`(86)、`SCOPE_SQL`(154-158)、`readMeta/writeMeta`(163-186)、`DEFAULT_STAGES`(227+)、`LEGACY_STAGE_MAP`(355)、`promptHash`(388)、8 个 prompt 占位(392-398) |
| 提示词正文 | 414-725 | 312 | `COMMON_ENV`/`COMMON_BIND`/`COMMON_SCORE_RULES`(414)/`COMMON_DB_LOOKUP`(432)/`COMMON_EVIDENCE`(443)/`COMMON_HANDOFF`(457)、`DEFAULT_PROMPTS`(472-725，254 行) |
| `dispatch` | 739-867 | 129 | 80+ op 的 if 阶梯 |
| `dispatchAsync` | 873-886 | 14 | 只分流 `probeSessions` |
| `pngSize` | 898-922 | 25 | 手写 PNG/JPEG/WebP 头解析 |
| `class RedteamStore` | 924-5385 | **4462** | 一个类 60+ 方法 |
| ↳ `scoreReport` | 2673-3758 | **1086** | 一个方法生成整篇 markdown |
| ↳ `report` | 5016-5196 | 181 | |
| ↳ `importBundle` | 5197-5280 | 84 | **唯一显式事务**（BEGIN 5209 / COMMIT 5269 / ROLLBACK 5271） |
| ↳ `probeSessions` | 3972-4040 | 69 | **唯一网络 IO** |
| ↳ `#hitTrace` | 2503-2672 | 170 | 私有方法，报告的核心 |

### 7.2 `client.js`（4218 行）内部结构

- CSS 537 行（`:23-560`）以一个模板字符串塞在 JS 里。
- 其余 3658 行全是 React 组件（`h()` 手写，无 JSX、无构建器）。
- 单文件 14 个页签级组件：最大 `AssetsTab` 383 行、`Panel` 303 行、`KnowledgeTab` 271 行、`ScoreTab` 268 行、`FindingsTab` 277 行、`ReportTab` 221 行、`SessionTab` 213 行。
- 全局可变状态 6 处：`ui`/`subs`(573)、`shotSrc`/`loadShot` 缓存(613-627)、`dockWidthTag`、`RtBoundary` class(3537)、未读指针、折叠状态。

### 7.3 巨型函数 Top 5

| 函数 | 位置 | 行数 | 问题 |
|---|---|---|---|
| `scoreReport` | `store-core.js:2673-3758` | 1086 | 取数 + 评估 + 复现入口合成 + 条目合并 + 截图认领 + 链路排序 + markdown 渲染全在一个方法体；靠 5 个闭包（`eviByVuln`、`clip`、`capFlagById`、`scopeOf`、`this.#hitTrace`）串起来，无法单测任何一段 |
| `Panel` | `client.js:3844-4146` | 303 | dock 布局 + 页签路由 + 数据拉取 + 状态持久化 |
| `AssetsTab` | `client.js:772-1154` | 383 | 表格 + 树 + 详情抽屉 + 评估表单 |
| `report` | `store-core.js:5016-5196` | 181 | 与 `scoreReport` 输出大量重叠 |
| `dispatch` | `store-core.js:739-867` | 129 | 字符串 op 路由，增删 op 只能靠肉眼对齐 |

### 7.4 结构性重复与耦合

1. **`dispatch` + tools.js 双层样板**：每个 op 在 `store-core` 一个分支、在 `tools` 一个 `defineTool` 包装，56 个工具里约 900 行是纯传参样板。
2. **对象字面量当路由**：op 是字符串，没有类型、没有集中登记的 op 表，`unknown op throws`（`store-core.js:863`）是唯一兜底。
3. **得分三口径**靠"同源调用"维持（`:1587` / `:2673` / `:3758`），没有断言或快照测试护栏 —— 一旦有人给某处加个 `.filter()` 就再次分裂。
4. **迁移跨模块循环需求**：`schema.js` 需要 `store-core.js` 的 `LEGACY_STAGE_MAP`，但 `store-core` 依赖 `schema`，只能内联或传参 —— 当前选择了"忘了传"，留下 `schema.js:586` 的悬空引用。
5. **两个手写解析器**：`preset-composition.js`（403 行 YAML 子集）与 `store-core.js:163-186`（`readMeta`/`writeMeta` 的 YAML-lite），各自只服务一个文件，格式还不一致。
6. **模块级全局状态 4 处**：`bindings`/`reservations`（`tools.js:90-97`）、`roleBySession`（`role-section.js:16`）、`promotionBySession`（`anchor-gate.mjs:111`）、`ui`（`client.js:573`）。前三处都靠 cap + FIFO 淘汰兜住长进程泄漏。
7. **UI 常量双份**：宿主 `ROLE_TITLES`/`SEVERITIES`/`POC_CATEGORIES` 与客户端 `ROLE_LABEL`/`SEV_LABEL`/`POC_CAT_NAME` 各维护一份，加一个角色/严重级要改两处。
8. **职责越界**：`ui.js` 里 500 行是包级版本更新器（含 `spawn`、`taskkill`、自重启脚本），与红队无关，却挂在 `dsh-purge-redteam-ui` 名下。

---

## 子系统一句话定位

**它是一台把"打一次"变成"可查询、可计分、可复现交付"的本地状态机：SQLite 存资产与得分，56 个工具只搬本地数据（唯一出网的是会话探活），25 条规则把成果折算成分数，再由一个 1086 行的方法把库渲染成能照做的报告。**

---

## 重构优先级前 5 项（按收益/风险比排序）

1. **修 `schema.js:586` 的悬空 `LEGACY_STAGE_MAP`**
   - 收益：让历史库的 `attack_step.stage → stage_code` 回填第一次真正生效，老库攻击链不再丢阶段。
   - 风险：**极低**。改 `migrate(db)` 签名为 `migrate(db, { legacyStageMap })`（`schema.js:466`），在 `store-core.js:966-981` 的 `db()` 里把 `LEGACY_STAGE_MAP`（`store-core.js:355`）传进去，受影响代码只有 `schema.js:583-588` 一个 try 块。

2. **给"得分三口径"加 facade + 快照测试**
   - 收益：锁住"面板 = 报告 = 链路"这条不变式，避免再次出现 6340 / 7930 的双口径事故。
   - 风险：**低**。先加一条把 `listScorePoints`(`store-core.js:1587`)、`scoreReport`(`:2673`)、`scoreChain`(`:3758`) 的总分对齐的测试，再抽 `scoreBoard(id, {enabledOnly:true})` 一个入口；三处都调 `evaluateScoreBoard`（`score-rules.js:435`），形态已经一致。

3. **拆 `scoreReport`（`store-core.js:2673-3758`）**
   - 收益：1086 行的单方法可被单测覆盖，`report`(`:5016`) 与 `scoreChain`(`:3758`) 能复用"条目组装 + 复现入口"两段，报告格式改动不再牵动取数逻辑。
   - 风险：**中**。分两刀最安全：先提纯渲染段（`:3319-3758`，五段 markdown，纯字符串拼接）→ 再提 `#hitTrace`(`:2503-2672`) 与复现入口段（`:2794-3300`，已依赖 `report-replay.js` 的纯函数）。

4. **把 `ui.js` 里与本子系统无关的版本更新器搬走**
   - 收益：`dsh-purge-redteam-ui` 只剩 `/redteam/api` + 技能桥，`spawn`/`taskkill`/自重启（`ui.js:163-244`、`313-589`，约 500 行）归位到包级插件。
   - 风险：**低**。对外的接口只有 4 个 op（`updatePreflight` / `checkLatest` / `applyUpdate` / `pluginIdentity`），`handleUpdateOp`(`:956`) 是唯一入口，搬走只需保留一个转发。

5. **用表驱动替换 `dispatch` 的 op 阶梯与 tools 样板**
   - 收益：新增一个 op 从"改两处 if 阶梯 + 写 20 行 `defineTool`"变成"加一行表项"，56 个工具的 `agent`/错误包装可以统一生成。
   - 风险：**中**。op 名、参数默认值、错误文案必须逐条对齐（`store-core.js:739-867` 有 80+ 分支，`tools.js` 56 个包装），建议先补一张 `OPS` 映射表并断言"表项数 == 分支数"再逐个迁移，保留旧阶梯做 fallback 一轮。
