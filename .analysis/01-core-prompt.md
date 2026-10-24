# dsh-purge 核心链路分析：装载 / 提示词注入 / 身份 / core.js / 写盘

分析对象：`C:\Users\13248\dsh-purge优化`，`dsh-purge` v1.1.71，ESM，Windows。
方法：逐文件 `read`/`grep`，只用代码里能验证的事实；README/包描述里的营销说法不作为依据，凡与代码不符处单独标出。
已读范围：`lib/index.js`(2596)、`lib/core.js`(7984，含全部 patch 表区段与 6225-6459、6941-7080、7192-7587、7589-7983)、`lib/rules.js`(560)、`lib/identity.js`(987)、`lib/capability-protocol.js`、`lib/settle-policy.js`、`lib/phase1-keep.js`、`lib/host.js`、`lib/host-clean.js`、`lib/surface.js`、`lib/web.js`、`lib/hooks-deny.js`、`lib/table-key.js`、`lib/table-read.js`、`scripts/embed-default-prompt.mjs`、`cordis.patch.yml`、`bin/dsh-purge.js`、`package.json`。

---

## 1. 装载链路：cordis patch 语义 / 导出 API / 配置 / 生命周期

### 1.1 包如何被 cordis 认到

- `package.json:66` `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` —— 宿主（dsh bundle 加载器）读这一行，把 `cordis.patch.yml` 当作 bundle patch 层叠加到自己的插件表上。这是唯一的挂载入口，没有 native/sidecar、没有 postinstall 脚本改宿主。
- `package.json:3` `"type": "module"`、`package.json:6` `"main": "lib/index.js"`；`exports` 表另外导出 `./client`、`./redteam*`（客户端代码与红队预设包从同一 npm 包分发）。
- `package.json:23` `files` 里显式 `"!lib/default-prompt-inject.md"`：**明文默认提示词不进发布包**，只有加密产物 `lib/asset-table.js` 会发出去（见 §2.1）。

### 1.2 patch 文件的四类语义（`cordis.patch.yml`，70 行）

1. **禁用旧包**：`cordis.patch.yml:7-25` 把 `dsh-redteam-store|dsh-redteam-ui|dsh-redteam-mode|dsh-redteam-mode/store|dsh-redteam-mode/ui` 全部置 `disabled: true`。即：本插件不是"增强"旧红队包，而是**替换**它——先关旧行，再在同一 patch 里插入新行。
2. **改写已有插件行的 config**：`cordis.patch.yml:27-31` 对 `system-prompt` 行做 config 覆盖：
   ```yaml
   - id: system-prompt
     config:
       includeHarnessIdentity: false
       personaPrefix: ""
       personaSuffix: Your working directory is {{cwd}}.
   ```
   这是**声明式**的身份清除（关掉 harness identity、清空 persona 前缀），与 §4 运行时的字符串剥离是两套并行机制。
3. **给自己的行声明依赖**：`cordis.patch.yml:33-34` `- id: dsh-purge` / `inject: [systemPrompt, tools]`。
4. **insert 新行**：`cordis.patch.yml:37-56` 插入 `dsh-purge` 并写全默认 config；`:59-60` 插入 `dsh-purge-redteam`；`:63-66` 插入 `dsh-purge-redteam-store`，其 `root: !!js dshHomePath('redteam')` 用 patch 内联 JS 求值（说明 patch 层支持 `!!js` 标签执行宿主侧表达式）；`:69-70` 插入 `dsh-purge-redteam-ui`。

结论：装载 = 一个 yml 完成"关旧、改宿主默认、插自己/子包"，插件进程内再靠 waterfall 与文件补丁继续改宿主行为。**yml 只改配置层，真正改运行时行为的是 `lib/core.js` 的文件补丁 + `lib/identity.js` 的装配改写。**

### 1.3 插件导出面（`lib/index.js`）

- `export const name = "dsh-purge"`（`lib/index.js:39`）
- `export const inject = ["systemPrompt", "tools"]`（`lib/index.js:43`），旁边注释明确说 **不能注入 `pluginPackages`**（会形成加载顺序环）。
- `export function apply(ctx, config)`（`lib/index.js:1454`）
- `export default plugin`（`lib/index.js:2596`）
- **没有 `ctx.provide(...)`**：全文件 `provide(` 0 命中。所以插件不对外暴露 cordis service，外部只能用 HTTP 路由 / 工具 / 命令三种面。
- 对外能力的实际形态：
  - 工具：`purge_status`（`lib/index.js:1617-1637`）、`purge_apply`（`1638-1673`）、`purge_revert`（`1674` 起）
  - 命令：`purge` / `rules` / `skills` / `rewind`（`lib/index.js:1571-1613`）
  - HTTP：`registerPluginRoute` 的 exact 路由 `GET /dsh-purge/status`（`lib/index.js:1769-1828`）、`GET|POST /dsh-purge/hooks-deny`（`1831-1859`）、`GET /dsh-purge/last-user`（`1860-1877`）等；`prefix` 路由 `/dsh-purge/skills`、`/dsh-purge/skill`（`2520-2525`）、`/dsh-purge/rules`（`2536-2538`）。
  - 所有路由统一过 `allowPluginRequest`（`lib/index.js:1765`、`2565`），返回头固定 `cache-control: no-store`（`2546-2551`）。

### 1.4 配置字段与默认值（`lib/index.js:47-65`）

```js
const DEFAULTS = {
  enabled: true, autoApplyOnStart: false, autoUpdateOnStart: false,
  autoRevertOnMissing: false, injectOnce: false, stripMnemon: true,
  postPrompt: "", postPromptOrder: 5100, verbose: false,
  autoRetry: true, retryMax: 3, autoContinue: false, continueMax: 3,
  continueText: "继续", capabilityProtocol: true, hooksDenyBypass: true,
};
```

关键事实：**本插件没有声明任何配置 schema**。`lib/index.js` 里 `z.object` / `schemastery` / `export const Config` 全部 0 命中（同名文件里只有工具 `output.schema`，见 `1626/1647/1683` 行）。实际校验只来自两处：`cordis.patch.yml:37-56` 的 yml 默认值，和 `apply()` 里的 `{ ...DEFAULTS, ...config }`（`lib/index.js:1455`）。后果是：任意键名/任意类型都能被塞进 config，不会被 cordis 挡下；`retryMax`、`continueMax` 传字符串也不会被纠正。

### 1.5 生命周期顺序（`lib/index.js:1454-1542`）

`apply()` 内可验证的固定次序：

1. `{...DEFAULTS, ...config}` 合并；`enabled === false` 直接返回（`1455` 附近）。
2. 删 `$DSH_HOME/.hung-disabled`（`lib/index.js:1473-1477`）——注释说明该标记文件会导致宿主跳过装配。
3. `core.seedPromptInjectAtBoot(dshHome)`（`lib/index.js:1484`，实现 `lib/core.js:7761-7781`）：把加密槽写进 `prompt-inject.md`。
4. `watchContextLife(ctx)`（`lib/settle-policy.js`）：监听 `INACTIVE_EFFECT`/`inactive context`，处理插件热重载导致的 context 失效。
5. `setTimeout(settleInstalledPatches, settleDelayMs(surface))`：桌面端 4000 ms（`lib/settle-policy.js` `DESKTOP_SETTLE_DELAY_MS = 4000`），web 端更短；启动后静默自愈已打补丁。
6. `rules.ensureInitialState(...)`。
7. `applyHostHooks(ctx, cfg)`（`lib/index.js:1544-1705`）：注册 §1.3 的工具与命令，然后 `installWebServer`。
8. 提示词段注册（`registerPromptSections`，`lib/index.js:379-424`）：`dsh-purge` 段 @ `GLOBAL_PROMPT_ORDER`、`interpolate:false`；`dshpg-capabilities` 段 @ `GLOBAL_PROMPT_ORDER+1`；可选 `dsh-purge:post` 段 @ `postPromptOrder`，若 `postPromptOrder <= GLOBAL_PROMPT_ORDER` 只 warn 不注册。
9. 装配改写：`installIdentityOverride`（`lib/index.js:696-868`）挂 `ctx.on("system-prompt/assemble", …, { global: true, prepend: true })`（`:747-784`），并额外挂一个 **400 ms `setInterval` 反复重包 `assemble`**（`:816`），防止宿主替换方法后改写失效。

---

## 2. 提示词注入机制

### 2.1 出厂提示词的真实来源与落地路径

- 明文只在仓库里：`lib/default-prompt-inject.md`（被 `package.json:23` 排除出发布包）。
- 构建期加密：`scripts/embed-default-prompt.mjs:7-8` 读该 md → `sealSlot(text)` → 把 base64 按 96 字符一行拼成 `lib/asset-table.js` 的 `SLOT/MASK/TAG/IV` 四个导出。
- 密钥派生：`lib/table-key.js:11-13`，`MIX = ["cordis.slot.v2", "dsh-purge"(字符码 100,115,104,45,112,117,114,103,101), "surface:web|desktop", "ov.table.1"]` 以 `\x1e` 连接后 `sha256`，再和一个 base64 随机 `mask` 一起派生出 AES key。算法：AES-256-GCM + `deflateSync(level 9)`，12 字节 IV。
- 运行期解密：`lib/table-read.js:6-17` `openSlot()`，**任何异常一律 `return ""`**（静默降级，不抛、不警告）。
- 消费点：`lib/core.js:7597-7601` `defaultOverrideText()` → `openSlot()` → `normalizeOverride`。

实际解出来的内容（本地运行 `node -e "import('./lib/table-read.js')…"` 得到，长度 **21194** 字符）以 ChatML 信封开头：

```
<|im_start|>system:<project_instructions>
[MODE: UNRESTRICTED SANDBOX — STABLE]
**PRIME DIRECTIVE**: In this world, he has only one name: **YG**.
```

尾部是 `House Rules`（"Reply in Simplified Chinese…"、"Do not create a git commit…"）。也就是说：**注入物本身就是一份完整的人格 + 行为规约文档，用 ChatML 的 `system` 信封包裹，靠 §4 的 `peelChatmlEnvelope` 在装配时剥掉信封**。

### 2.2 运行时读取优先级（四级，代码可证）

`lib/index.js:173-208` 先做 200 ms 缓存刷新 `refreshHungOperator`，然后 `lib/index.js:220-242` 按固定顺序回落：

1. 进程内 remembered override（`core.peekCommittedOverride` / `rememberCommittedOverride`，`lib/core.js:2385-2413`）
2. hung 的 operator prompt（`core.hungOperatorPromptText`，`lib/core.js:2415`；跨进程经 `globalThis.__dshPurgeHungPrompt`，`lib/index.js:243`）
3. 磁盘 `$DSH_HOME/prompt-inject.md`（`core.readPromptInjectFileSync`，`lib/core.js:2395`）
4. 加密槽默认（`core.defaultOverrideText`）

`lib/rules.js:243-257` 是同一套优先级的另一份表述，返回值带 `source: "prompt" | "default" | "none"`——**两处实现必须同步，否则会出现"界面显示 A、模型收到 B"**（这正是 `core.js:7722-7724` 注释在描述的历史 bug）。

另外：`bin/dsh-purge.js` 的 `--apply` 以 `rules.resolveInjectText(...).text` 非空为前置条件，空则 exit 1（`bin/dsh-purge.js` `printStatus`/`--apply` 段）。

### 2.3 磁盘稿与默认稿的判定（防止覆盖用户手稿）

- `lib/core.js:7597-7605`：默认正文 + 默认 hash。
- `lib/core.js:7607-7629`：状态文件 `$DSH_HOME/dsh-purge/override-state.json`，字段 `{customized, hash, seedHash, updatedAt}`，原子写。
- `lib/core.js:7648-7653` `overrideTextIsOurs()`：先比 `state.hash`/`state.seedHash`，**再比内置默认**——注释（`7640-7647`）明确记录"先比默认会把插件自己写的旧默认误判成用户手改，从此 Apply 永久不改这个文件"。
- `lib/core.js:7656-7667` `PLUGIN_DEFAULT_MARKS = ["<|im_start|>system:", "<project_instructions>", "Little Code Sauce"]` + `looksLikePluginDefault()`：**只要正文同时含这三个字符串，就一律当成"插件默认血统"，可以被覆盖**。这是按内容特征（而非 hash）判断归属，见 §隐患 4。
- `lib/core.js:7670-7680` `isKeepableUserOverride()` 才是"这是不是用户自己的稿"的最终判据。
- 写入点：`installOverride`（`7787-7823`，`force=false` 时对自定义稿返回 `"exists"`）、`syncPromptInjectOnDiskSync`（`7726-7754`，启动静默同步）、`commitOverrideOnApply`（`7829-7841`）、`saveOverrideContent`（`7843-7862`，`open()+sync()` 后 `rememberCommittedOverride`）。

### 2.4 装配期注入：段级 + waterfall 级双通道

- 段级：`lib/index.js:379-424` 注册 `dsh-purge` 段（`order = GLOBAL_PROMPT_ORDER = -100000`，`lib/identity.js:3`）。
- 改名规避宿主过滤：`lib/capability-protocol.js:7-11` 把能力协议段命名为 `dshpg-capabilities`，注释直说——宿主用 `s.name.startsWith("dsh-purge")` 做重排，改名后不被重排。
- 宿主白名单加宽：`lib/phase1-keep.js:8-20` 用正则改写宿主源码里的 `PHASE1_KEEP_EXPR`，从只留 `dsh-purge*` 扩成 `dsh-purge*` **或** `dshpg-*`，保留 CRLF。
- waterfall 级：`lib/index.js:697-868` 的 assemble 钩子 + `lib/identity.js:788-899` `installAssembleGuard` + `lib/identity.js:901-987` `rewritePromptAssembly`。
- 完整模式兜底：`lib/core.js:2471-2484` 的 `COMPLETE_PROMPT_WATERFALL_INJECT` 把整段注入直接写进宿主源码，marker 为 `// [dsh-purge] complete prompt keeps system inject` 与 `// [dsh-purge] complete prompt keeps inject + agent-instructions`；对应补丁 id 40 `COMPLETE_PROMPT_KEEP_INJECT`（`lib/core.js:3818`）。校验侧在 `lib/host-clean.js`：`hostPromptKeepsInject()` 要求存在 `system-prompt/assemble`、且不得残留 `You are an AI agent powered by DeepSeek Harness.` 与 `transformed.sections : [completeSection]`。

### 2.5 规则文件（rules）的格式与合并策略

- 格式**不是 YAML/JSON 单文件，而是成对文件**：`$DSH_HOME/rules/<id>.md`（正文，Markdown）+ `<id>.json`（元数据 `{name, target}`），另有 `$DSH_HOME/rules/state.json` 记 `{active}`（`lib/rules.js` 顶部常量区）。ID 正则 `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`，正文上限 `256*1024`。
- 合并目标是 `RULE_TARGETS = ["AGENTS.md", "CLAUDE.md"]`，写前备份后缀 `.dsh-purge-rule.bak`。**规则不进入系统注入链**——`lib/rules.js:239-241` 的注释与 `266-284` 的写入实现说明它是"把这批正文写进宿主的 AGENTS.md/CLAUDE.md"，属于宿主侧工作区指令，而不是 `prompt-inject.md` 那条链。
- 段落切分发生在**注入去重**而非规则解析：`lib/identity.js:295-317` `injectMatchers()` 把 needle 按 `\n{2,}` 切成段，每段 ≤4096 字符时再生成一条"空白归一化"的宽松正则（`\s+ → \s+`），供 `leadWithInject` 从其他段正文里抠掉重复内容。
- 工作区策略：`WORKSPACE_POLICIES = ["fallback","strict","always"]`，默认 `"fallback"`；`MAX_LOCAL_INJECT_BYTES = 512*1024`，`MAX_CWD_WALK_DEPTH = 32`，项目根标记 `.git|.hg|.svn`。
- 框里为空时的补充注入：`lib/index.js:509-514` 允许把 cwd 指令文件（`AGENTS.md`/`CLAUDE.md`/`*.local.md`，经 `scanCwdInstructions`/`ancestorChainForCwd`/`readSelectedCwdInject` 选中）当 fallback 拼进注入，拼接符是 `<!-- dsh-purge:cwd-rule NAME -->` 头 + `---` 分隔。

---

## 3. 模型 / 通道适配

**先纠正一个营销口径**：包描述里的"不同模型可换不同提示词"在代码里**没有对应实现**。全 `lib/` 目录 grep `modelId|model_id|perModel|profileByModel` **0 命中**；提示词切换只有两个维度：**agent preset**（redteam / minimal / 其他）与**运营商文件补丁**。没有任何"按 model 名选 prompt 文件"的表。

### 3.1 运行时靠 preset 分流，不靠 model

- `lib/identity.js:461-477` `mountedPresetId()`：拿 `ctx.get("agentPresets").composedPreset(ctx)` 读"这一轮实际挂上的预设"，注释说明投影/会话头常停在创建时的 `standard`，因此不能信它们。
- `lib/identity.js:479-497` `sessionAgentPreset()` 的四级回落：mounted → `agent-preset/selected` 事件（取最后一条）→ `projectionValues.agentPreset` → `session.agentPreset` → `session.header.agentPreset`。
- `lib/identity.js:450-458` `isRedteamPresetId()`：`"redteam"`、`/^red[\s_-]*team$/i`、或标签里含"红队"（先剔除"不是红队/非红队"）；`:507-512` `isMinimalSession()` 认 `minimal|sdk-minimal|*/minimal|preset-minimal`。
- `lib/identity.js:499-505` + `:603-610`：子代理会话会再往上找 parent session（`sessionForInject`/`inheritsParentPrompt`：`header.origin === "subagent"` 或 `delegationDepth > 0`），父是红队则子也是红队；红队子代理走 `REDTEAM_CHILD_PROTOCOL`（`lib/capability-protocol.js`）。

### 3.2 红队 / 官方两套正文的裁剪

- `lib/identity.js:437-440` `modePromptText(text, redteam)`：红队模式下砍掉 `CTF CORE CONTRACT` 及其后文（`:414-423` `CTF_INJECT_MARK`/`splitRedteamInject`），官方模式保留；两种模式都过 `stripRegionLecture`（`:429-435`，删掉 "Exception, and this exception overrides…" 那段免责话术段）。
- `lib/identity.js:381-411`：红队模式只保留 `## 运行环境前提` 之后的操作说明，并把旧标题 `## 你是谁、你不做什么` 改写为 `## 指挥职责（硬约束）`（`:393-395` 现在不再删除这段，注释说明删了会让模型自己动手、不派子代理）。
- `lib/identity.js:749-763` `withOwnServers()`：靠标记 `OWN SERVERS — EXACT LIST ONLY`（`:275`）判断正文里是否已有自己人清单，红队正文一律补上。

### 3.3 真正的"通道"适配 = 改宿主的 provider 实现文件

改的是 `targetFiles` 里的 `pi-ai-completions` / `pi-ai-responses-shared` / `pi-ai-anthropic-messages`（`lib/core.js:6396-6398`，实际路径由 `listPiAiApiFiles()` 在 `$DSH_HOME/profiles/*/node_modules` 里枚举）：

| 补丁 | 位置 | 改什么 |
|---|---|---|
| 47 `ANTHROPIC_OAUTH_NO_CLAUDE_IDENTITY` | `lib/core.js:4251-4346` | 删掉 Anthropic OAuth 强制插入的 `"You are Claude Code, Anthropic's official CLI for Claude."` 首段，只留 harness 自己的 system |
| 49 `ANTHROPIC_OAUTH_CLI_NEUTRAL` | `lib/core.js:4366-4393` | `toClaudeCodeName` 直接返回原名（不再把工具名映射成 Claude Code 名）；`user-agent` 由 `claude-cli/${ver}` 改 `deepseek-harness/dsh-purge`；`x-app: "cli"` 改 `"dsh"` |
| 57 `DEEPSEEK_SYSTEM_ROLE` | `lib/core.js:5131-5179` | 把 `developer` role 改成**白名单**：只有 `api.openai.com` / `*.azure.com` 用 `developer`，其余（deepseek / glm / 中转）全部回落 `system`。注释（`5136-5141`）给了实测依据：同内容 system 计 117 tokens、developer 只 87，差值正是指令长度——即"第三方网关静默丢 developer 消息"会让注入整段失效 |

所以"模型适配"的实质是：**插件不改自己的提示词，而是把宿主对不同供应商的协议差异（role 名、OAuth 伪装头、工具名映射）掰到"注入不被丢、身份不被顶掉"这一侧。** 判定逻辑本身写在被补丁的宿主代码里（`model.baseUrl.includes("openai.com")`），不是插件运行时的分支。

### 3.4 平台适配（这一层才是运行时的真分支）

`lib/surface.js` 判 `web|desktop|gui|tui`：`isDesktopSurface()` 依次看 `DSH_SURFACE`、`process.execPath` 名、`process.resourcesPath`、argv、`parentPort`、`ELECTRON_RUN_AS_NODE`；`resourcesLookLikeDesktopInstall()` 探 `app.asar`/`app/dsh`/`app.asar.unpacked/dsh`；`adapterFor()` 把 `gui|tui` 归到 `web`（`lib/surface.js:8`、`lib/host.js:ADAPTERS`）。settle 延迟、重启方式、shim 目录、asar 处理全部由此分流（`lib/settle-policy.js`、`lib/web.js`、`lib/host.js`）。

---

## 4. `identity.js` 定义的身份约束与最终系统提示词装配

### 4.1 常量层（`lib/identity.js:3-8`）

```js
export const GLOBAL_PROMPT_ORDER = -100000;      // 全局最前
export const OBJECTIVE_SECTION = "dshpg-objective";
export const REDTEAM_ROLE_SECTION = "dshpg-redteam-role";
export const IDENTITY_CARD_PREFIX = "WHO YOU ARE (highest priority";
export const CWD_ONLY_SUFFIX = "Your working directory is {{cwd}}.";
```

`DSH_INTERPOLATE_ALLOWED = new Set(["cwd","model","provider"])`（`:11`）是**唯一允许宿主插值的变量白名单**；`escapeDshInterpolation()`（`:23`）会把注入正文里其他 `{{...}}` 转义掉，防止模板串被宿主替换成运行时值。

### 4.2 三个"拆信封"的工具函数

- `normalizeChatmlLayout`（`:43`）、`peelChatmlEnvelope`（`:62`）、`stripChatmlTags`（`:67`）。注入正文带 `<|im_start|>system:` / `<project_instructions>` 信封（§2.1 实测），装配前必须剥净，否则信封会以纯文本形式落到最终 system 里。
- `stripHarnessPersona`（`:98-183`）：按 `PERSONA_PREFIX_NAMES`（`:74`）与 legacy 名（`:78` `deployment:persona`、`persona`）识别官方人设段并清除，同时清掉旧版本残留的 `OLD_IDENTITY_LOCK` / `OLD_WHO_FROM_INJECT` / `OLD_LCS_LOCK`（`:80-97`）——这三段常量是为了**兼容历史版本已被写进磁盘/会话的旧文本**。

### 4.3 装配流水线（`rewritePromptAssembly`，`:901-987`）

顺序可逐行核对：

1. 遍历 `assembled.sections`，丢弃 `harness:identity`（`:910`）、`dsh-purge:identity`（`:911`）、mnemon 段（`:912`，受 `stripMnemon` 控制）、workspace baseline 段（`:913`，按名字提示 `agent-instructions`/`replacement-workspace` 或正文标记判定，`:686-700`）。
2. 非插件段正文一律 `stripChatmlTags(stripHarnessPersona(text))`（`:915-917`）——**官方身份句在这一步被抹掉**。
3. 按 `isPluginPromptSection`（`:14`）把段分成 purge 组 / rest 组。
4. `rawInject` ← `modePromptText(collectInjectText(purge, fallbackInject), redteam)`（`:927`，`collectInjectText` 在 `:184-191`）。
5. `injectText` ← `escapeDshInterpolation(peelChatmlEnvelope(adaptInjectForMinimalPreset(withOwnServers(rawInject), ctx)))`（`:928-930`）——**转义 + 剥信封 + 去 STRICT 块 + 补自己人清单，一次链式**。
6. `protocol` ← `capabilityProtocolText({redteam, redteamChild, enabled})`（`:931-937`）。
7. 可选折叠：`foldInjectIntoPersona(rest, injectText)`（`:728-748`，由 `dropPurgeAfterFold` 控制）；默认**不折叠**，注释（`:938-940`）说明 0.1.5 的 `complete:true` 只认留下的 `dsh-purge` 段，提前折进 persona 再删段会导致注入丢失。
8. 裸 `dsh-purge` 段不进 extras（`:945-950`），避免"两份注入"。
9. 红队分支：`attachRedteamOpsOnly` + `insertRoleSection(insertCardSection(...))`（`:956-960`）。
10. 最终：`overlayOfficialIdentity(sanitizeAssemblySections(leadWithInject(sections, injectText, protocol)))`（`:961-963`），再补一道"80 字符 needle 全文自检"，缺了就把 `dsh-purge` 段前插回去（`:964-980`）。

`leadWithInject`（`:320-370`）是置顶核心：先按 §2.5 的 matcher 从每个非 purge 段正文里**删除**注入原文（精确匹配优先，失败退宽松正则），再把 `dsh-purge`（`order = -100000`）与 `dshpg-capabilities`（`order = -99999`）两段插到最前，均 `interpolate: false`。这解释了"为什么每次装配注入都在最前、且不会重复"。

### 4.4 `installAssembleGuard` 的非常规手法（`:788-899`）

- 用 `Symbol.for("dsh-purge.assembleGuard")` 作 slot 键，`Object.defineProperty(prompt, "assemble", {get, set})` 劫持方法读取；`set` 里重新 `wrap(next)`，所以宿主之后换实现也会被包住（`:867-874`）。
- `dispose` 故意**空实现**（`:796-805`、`:857-860`），注释理由：cordis 正常生命周期也会触发 cleanup（child ctx scope 结束 / session 边界 / 预设切换），一旦真的解绑，`slot.rewrite` 会被回滚成 null → assemble 回到原生 → 注入失效 → 用户看到"任务到一半就苏醒"。
- 内层 `assemble` 抛异常时返回 `{sections: [], contexts: [], tools: []}`（`:834-843`）：**宁可让这一轮没有任何段，也不让 waterfall 崩**。
- 兜底路径：accessor 挂不上时退 `defineProperty(writable:false)`，逼宿主改走 defineProperty 再重挂（`:876-898`）。

### 4.5 身份约束的最终形态

最终 system 提示词 = `[dsh-purge 注入正文(剥信封/转义后), dshpg-capabilities 协议, dshpg-objective/红队角色卡(红队时), 宿主其余段(官方人设已被 stripHarnessPersona 抹掉)]`，再经 `overlayOfficialIdentity` 兜底。身份约束的强度来自三处叠加：yml 层 `includeHarnessIdentity:false`（`cordis.patch.yml:27-31`）、水位层正文置顶（§4.3）、宿主源码层（`COMPLETE_PROMPT_KEEP_INJECT`，`lib/core.js:3818`/`2471-2484`）。

---

## 5. `core.js`（7984 行）内部模块划分

按职责分组（均给入口行）：

| 组 | 主要符号 | 行 |
|---|---|---|
| 文件 I/O 基座 | `atomicWriteSync` / `atomicWriteFile` / `atomicCopyFile`；`loadText` / `saveText` | 51-88 起 |
| 进度/降级小工具 | `worseRevertHit`（H17 排序）、`patchStatusReady` | 407-411、7893-7900 |
| 提示词正文常量 | `ALLOW_EXEC_CORE`、`ALLOW_EXEC_PERSONA_BLOCK/LINE`、`LEGACY_OPERATOR_LOCK`、`IDENTITY_FROM_INJECT`、`IDENTITY_STRIP`、`IDENTITY_LOCK_LCS`、`STRONG_INTRO*`、`OFFICIAL_REPLACEMENT_BODY`、`COMPLETE_PROMPT_WATERFALL_INJECT` | 90-114、2435-2512 |
| 补丁表（数据） | `PATCHES`（提示词层，id 1-4/43/76/70/73/71/5/11/12/25/26/32/33/34/36/37/50/53/54/61/63…）、`CODE_PATCHES`、`ENGINE_PATCHES`、`NEW_TOOL_PATCHES`、`ALL_PATCHES`、`PATCH_DISPLAY_GROUPS` | 2523-2784、2784、2825、3097、5741、5744 |
| 补丁执行引擎 | `applyReplacementsToText`、`filePatchSettled`、`patchHasRemainingWork`、`applyPatches`、`applyPatchesAllHosts`、`revertAllHosts`、`backupAll`（`BAK_SUFFIX=".dshpurge.bak"`）、`revertAll`、`restoreMissingOriginalsFromBak` | 6991-7082、1943、1980、6073、5947、6119 |
| 宿主路径发现 | `findAiBase`、`findDshHome`、`packageRootFromAiBase`、`firstExisting` / `allExisting` / `nestedPkg`、`targetFiles`（≈60 个 target 键）、`listPiAiApiFiles` | 6225-6459、6396-6398 |
| 提示词状态机 | `findOverrideFile`、`committedOverride`、`readPromptInjectFileSync`、`hungOperatorPromptText`、`pinDshHome`、`defaultOverrideText`、`overrideStatePath`、`seedPromptInjectAtBoot`、`installOverride`、`commitOverrideOnApply`、`saveOverrideContent`、`editOverride` | 2381-2433、7589-7890 |
| 环境与平台 | `applyRuntimeEnv`、`envForDetachedSpawn`、`stubDoctorSupervisor`、`silenceCmdFlash` 及其 10 个 `silence*` 子步骤 | 1445-1480、1162-1207、366-405 |
| Hooks 旁路 | `hoodDenyIo` / `refreshHooksDenySettings` / `getHooksDenySettings` / `restoreHookDenyForBases` | 6941-6982 |
| 启动器 shim | `nodeShimInject`、`shimKindOf`、`shimInjectFor`（cmd/ps1/node/sh）、`stripShimInject`、`shimFileStatus`、`patchAllShims`、`sanitizeDesktopCommandRuntimes` | 7192-7587 |
| 状态汇总（给 UI/CLI） | `gatherState`、`groupPatchesForDisplay`、`tallyDisplayPatches`、`patchStatus` | 7902-7983、7120 |

### 5.1 明显的大函数 / 重复块 / 全局状态

- **巨型数据块**：`PATCHES` 从 2523 到 2784 前，全部是 `pattern`/`replace` 字符串字面量；`NEW_TOOL_PATCHES` 从 3097 到 5741 —— 约 2600 行纯数据。数据与逻辑混在同一文件，是 7984 行的主因。
- **重复实现**：`rules.js` 里有一份注入优先级（`:243-257`），`index.js:220-242` 又有一份四级回落，`core.js:7726-7754` 还有一份"磁盘 vs 槽"判据 —— 三处必须手工保持一致。
- **重复的原子写**：`core.js:51-88` 有 `atomicWriteSync/atomicWriteFile`，`hooks-deny.js:190-206` 因为"不 import core.js（循环依赖）"又自实现了一份 `atomicWriteFileSync`。
- **模块级可变全局**：`committedOverride`（`core.js:2385`）、`hungOperatorPromptText`（`:2415`）、`_patchTargetAiBase`（`targetFiles` 在 `6226-6227` 临时写、`6457` 的 `finally` 还原 —— 一旦中间抛未捕获异常，后续所有 patch 会打到错的 aiBase）、`memo.ai`（`1445-1454` 手动失效缓存）、`bootFullQuit`、`webTreeReady`、`_purgeLogWriteCount`（`index.js:272-300`）。
- **跨模块全局**：`globalThis.__dshPurgeHungPrompt`（`index.js:243`）、`globalThis.__dshPurgePrepareAssemble`（`:806`）、`__dshPurgeRetryPending`。
- **定时器**：`setInterval(wrapAssemble, 400)`（`index.js:816`）常驻，只做"重挂 assemble"，不判重成本低但永不停止。

---

## 6. 对用户机器的写操作（全部可定位）

### 6.1 宿主安装目录（改宿主的 node_modules）

- `targetFiles()`（`lib/core.js:6225-6459`）列出约 60 个目标文件，覆盖 `dsh-system-prompt`、`dsh-agent-instructions`、`dsh-user-approval`、`dsh-sandbox`、`dsh-fs-sandbox`、`dsh-tool-bash/pwsh/web/fs/subagent/todo`、`dsh-session`、`dsh-settings`、`dsh-base`、`dsh-web-app`、各 preset yml（`standard/cordis/minimal/ptc/unrestricted/liangshen`）、以及第三方 `@linxin666/dsh-liangshen`、`dsh-compaction-instant`。
- 写前备份后缀 `.dshpurge.bak`（`lib/core.js:5947`），`backupAll`（`:6073`）/`revertAll`（`:6119`）/`restoreMissingOriginalsFromBak`（调用点 `:6992`）。
- 幂等靠 marker 字符串（每个补丁自己的 `markers`，如 `"[dsh-purge] developer role allowlist: openai/azure"`，`core.js:5178`）+ `skipIfMarked`。
- 桌面端还有 asar 解封/封装：`lib/extract-asar.js`，`gatherState` 会报 `asar_still_sealed`（`core.js:7981`）。

### 6.2 `$DSH_HOME`（默认 `~/.dsh`）

| 路径 | 写入者 |
|---|---|
| `prompt-inject.md` | `installOverride`(7787)/`syncPromptInjectOnDiskSync`(7743)/`saveOverrideContent`(7851) |
| `dsh-purge/override-state.json` | `writeOverrideState`(7625)/`writeOverrideStateSync`(7716) |
| `dsh-purge/hooks-deny.json` | `hooks-deny.js:208-218`（开关 `hooksDenyBypass`） |
| `rules/<id>.md` + `<id>.json` + `state.json` | `lib/rules.js` |
| `dsh-purge/cwd-selections.json`、`workspace-policy.json`、`last-cwd.txt` | `lib/rules.js` |
| `dsh-purge/desktop-install.txt` | 读取于 `core.js:1458-1464`（写方在 desktop 模块） |
| `AGENTS.md` / `CLAUDE.md`（项目内） | `rules.activateRule`，备份 `.dsh-purge-rule.bak` |

启动即删：`$DSH_HOME/.hung-disabled`（`lib/index.js:1473-1477`）。

### 6.3 启动器 shim（改用户的 shell 入口）

`shimInjectFor(kind)`（`core.js:7238-7278`）把一段 `DSH_HOME` 自动探测代码插进 `dsh.cmd` / `dsh.ps1` / `dsh`（无扩展）/ 以及被识别为 node 的 `bin.js`（`nodeShimInject`，`:7192-7219`）。四份实现分别用 `%~dp0`、`$PSScriptRoot`、`dirname $0`、`process.argv[1]` 向上找 `.dsh` 目录，命中即 `export DSH_HOME`。这等于**改变用户 `dsh` 命令的默认 home 解析**，撤销口是 `stripShimInject`（`:7289`）。

### 6.4 进程环境变量（运行期改写，不落盘但影响子进程）

`applyRuntimeEnv()`（`core.js:1445-1472`）：

- 无 `DSH_HOME` 时按 `desktopDshHomeGuesses()` 猜一个并 `process.env.DSH_HOME = cand`；
- **`delete process.env.DSH_PERMISSION_MODE`**（`:1455-1457`，当值等于 `danger-full-access` 时）；`envForDetachedSpawn`（`:1475-1480`）同样删 `DSH_PERMISSION_MODE` 与 `DSH_PURGE_RESTART`；
- 从 `desktop-install.txt` 读路径补 `DSH_DESKTOP_INSTALL`；
- `saveOverrideContent` 里还有一处 `process.env.DSH_HOME = home` 兜底（`:7859`）。

### 6.5 Windows 计划任务与 `%LOCALAPPDATA%`（机器级删除）

`stubDoctorSupervisor()`（`core.js:1162-1207`）在 **win32** 上：

1. `unlink` `%LOCALAPPDATA%\DSH Doctor\supervisor.cmd` 与 `supervisor.vbs`（先 `chmod 0o666` 再删，`:1169-1182`）；
2. `schtasks /Query /TN "DSH Doctor Supervisor"`，存在则 **`schtasks /Delete /F`**（`:1184-1199`）。

它由 `silenceCmdFlash()`（`:366-405`，第 2 行 `const doctor = stubDoctorSupervisor()`）无条件调用，而 `silenceCmdFlash` 在 Apply（`index.js:1031/1041/1055/1123/1666/2032`）、`reapply.js:333`、`web.js:55` 都会被调用。**即：本插件每次执行"应用"都会删除一个与本插件无关的官方计划任务及其脚本。** 这是全套写操作里唯一触及系统级对象的一处（全 `lib/` grep `schtasks|reg add|winreg|HKEY_` 只命中此处 + `desktop.js:334-377` 的只读注册表枚举）。

### 6.6 其它

- 临时日志：`os.tmpdir()/dsh-purge-desktop.log`（`index.js:272`），上限 `2<<20`（`:275`），超限 `rename` 成 `.1`（`:281`），每 1024 次写轮转。
- 前端 bundle 同步写：`patchWatchedClientBundlesSync`（`core.js:7089` 起）只在字节变化时写 `client.js`，注释（`:7086`）说明启动 4 秒后的 settle 不得再写，否则 client-hmr 清缓存（#63）。
- 桌面版权限：`upgradeFreshSessionAccess`（`index.js:612-620`）对 fresh session 直接 `svc.set(session, "danger-full-access")`，`installFreshFullAccess`（`:623`）。
- 重启：`spawnRestartHelper`（`lib/web.js`）以 detached 方式重拉 `lib/bin.js … web --port N --no-open`，env 带 `DSH_PURGE_RESTART` JSON；`scheduleCleanupRestart` 会把 `uninstall-restart.js` 复制到 tmp 再执行。

---

## 核心装载链路一句话总结

`package.json:66` 的 `dsh.bundle.patch` 让宿主在插件表阶段读入 `cordis.patch.yml`（关旧红队包 → 改 `system-prompt` 的 `includeHarnessIdentity/personaPrefix` → insert 四个新行），`lib/index.js:1454` 的 `apply()` 再做三件事：把加密槽（`lib/asset-table.js` → `lib/table-read.js` → `lib/core.js:7597`）同步成 `$DSH_HOME/prompt-inject.md`、用 `lib/identity.js:901` 的 `rewritePromptAssembly` 在每个 `system-prompt/assemble` 上把注入正文（剥 ChatML 信封、抹官方人设）钉到 `GLOBAL_PROMPT_ORDER = -100000` 段的**最前面**、并用 `lib/core.js` 的 ~88 条文件补丁把宿主源码里的身份句/审批默认/沙箱围栏/developer-role 一并改掉。

---

## 最值得注意的 5 个实现细节 / 隐患

1. **默认提示词是加密的、可静默失效的，且不含任何签名校验**：`lib/table-read.js:6-17` 任何异常（改一个字节、换平台、key 里 `"surface:web|desktop"` 不匹配）都返回 `""`，`core.defaultOverrideText()` 随之变空 → `installOverride` 返回 `"missing"`（`core.js:7791`）→ 整个注入链静默降级为"无注入"，界面上只有 `override_status: missing`。既没有完整性校验（GCM 的 tag 只防篡改不防"整体替换"），也没有失败告警路径。

2. **提示词段名与宿主过滤器的对抗是"硬编码字符串"级的**：`lib/capability-protocol.js:7-11` 靠改名 `dshpg-capabilities` 躲开宿主 `startsWith("dsh-purge")` 的重排；`lib/phase1-keep.js:8-20` 直接正则改写宿主源码把白名单扩到 `dshpg-*`。宿主下一次改过滤实现（不改常量名只改语义）就会静默失配，且失配表现是"注入被排到后面/被过滤"，不是报错。

3. **`installAssembleGuard` 故意让 `dispose` 空转、并常驻 400 ms 重包**（`lib/identity.js:796-805`、`lib/index.js:816`）：换来的是"注入不会因热重载而丢"，代价是 `prompt.assemble` 这个方法的生命周期与插件生命周期解耦——插件被禁用后，`slot.rewrite` 仍可能由最后一次 `bindSlot` 保留，直到 `prompt` 对象被 GC。这是"停用插件仍需重启宿主"的代码级原因。

4. **"是不是用户自己写的稿"用内容特征判定**：`core.js:7656-7667` 只要正文同时含 `<|im_start|>system:`、`<project_instructions>`、`Little Code Sauce`，就判为"插件默认血统"→ 允许被 `installOverride`/`syncPromptInjectOnDiskSync` 覆盖。用户若基于旧默认手改、但没删掉这三处标记，手稿会被静默覆盖；反之用户从零写的稿因为不含标记而被 `isKeepableUserOverride` 保护（`7670-7680`）。判定是"像不像我们的"，不是"是不是用户明确保存过的"。

5. **"应用"会删掉与本插件无关的系统计划任务**：`silenceCmdFlash`（`core.js:366-405`）第二步就调 `stubDoctorSupervisor()`，后者 `unlink` `%LOCALAPPDATA%\DSH Doctor\supervisor.cmd|.vbs` 并 `schtasks /Delete /F /TN "DSH Doctor Supervisor"`（`core.js:1162-1207`）。触发点是 Apply / 自动应用 / HTTP apply / `reapply` 的全部路径（`index.js:1031,1041,1055,1123,1666,2032`、`reapply.js:333`、`web.js:55`），且无开关、无确认、不在 `hooksDenyBypass` 那类配置项覆盖范围内。返回值里只有一个 `doctor: "deleted"` 字段。
