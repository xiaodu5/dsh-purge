# dsh-purge（DeepSeek Harness 破甲插件）历史 / 文档 / 工程治理评估

> 调查对象：`C:\Users\13248\dsh-purge优化`（`mmparko/dsh-purge` 镜像，上游 `YuJunZhiXue/dsh-purge`）
> 方法：`git log / shortlog / tag / show --stat`、`read`、`grep` 实跑，结论全部带 commit sha 或 `文件:行号`。
> 口径：`master` 分支 231 个 commit（`git rev-list HEAD --count` = 231）；仓库全部 ref 395 个 commit（含 `upstream-archive` 分支）。
> HEAD = `033e6bd`（mirror notice），上游原始末端 = `6c1d638`（10-12 暂停更新说明）。

---

## A. 历史演化

### A1. 时间跨度与节奏

| 指标 | 数值 | 依据 |
| --- | --- | --- |
| 首个 commit | 2026-08-19 16:11 | `abaa4ed` “dsh-purge: instruction authority purge plugin for DeepSeek Harness (3-layer, 8 patches, auto re-apply)” |
| 最后代码 commit | 2026-10-11 | `5e75726` release 1.1.71 |
| 最后 commit（文档） | 2026-10-13 | `033e6bd` docs: 加镜像说明与原作者署名 |
| 总跨度 | **约 56 天** | 08-19 → 10-13 |
| 有效工作日 | 38 天（55 天里只 38 天有提交） | `git log --format=%ad \| group` |
| 平均每日提交 | 6.08（38 个有效日） | 231 / 38 |
| 单日峰值 | **31 commit**（2026-10-09） | 同上；次高 15（09-28、10-11） |
| 月度分布 | 08 月 16 / 09 月 112 / 10 月 103 | 同上 |

**节奏形态**：08 月“草稿期”（16 commit，两周）；09-17 起进入“日更冲刺”；10 月几乎每 2–3 小时一个 commit。这是典型的单人高速迭代曲线，而非有评审节的团队节奏。

### A2. 作者分布（`git shortlog -sne HEAD`）

| 作者身份 | commits | 占比 |
| --- | --- | --- |
| 叫我小杨同学 `<a2269198325@163.com>` | 192 | 83.1% |
| yang `<a2269198325@163.com>`（同一人，邮箱相同） | 24 | 10.4% |
| **主作者合计** | **216** | **93.5%** |
| fomaper | 3 | 1.3% |
| Musan-34 / Musan（同一人两种署名） | 2 + 1 | 1.3% |
| 21hbguo、Cracer、Gaizka、TLcm、mmparko(mirror)、qianxuno、wangqiupei、zksnet、鼬豆腐GOLDkey | 各 1 | 4.3% |
| **外部贡献合计** | **15**（12 个身份） | **6.5%** |

- 事实：项目 **93.5% 由单人提交**，且该人使用两个 git 身份（`叫我小杨同学` / `yang`，同邮箱），说明本地 git 配置中途改过名。
- 外部 15 个 commit 基本是 PR 合入，多数集中在 10 月的 `fomaper`（#97/#98/#99，性能与超时修复：`b123419`、`2d67b64`、`1863a4b`）。
- 无 bot、无 CI 自动提交；`musan`、`Gaizka` 等只在 09 月一次亮相。

### A3. 发布频率（`git tag --sort=creatordate`）

Tag 总数 **100** = 72 个 `v*` 版本 tag + `restore-issue-25` + `upstream-snapshot-6c1d638`（镜像新增）+ 26 个 `archive/pr-*`（镜像把 GitHub `refs/pull/*` 转存的 tag，见 `MIRROR-NOTICE.md:33-39`）。

**前 10 个版本 tag**

| tag | 时间 | tag | 时间 |
| --- | --- | --- | --- |
| v1.1.1 | 09-18 00:27 | v1.1.9 | 09-19 00:51 |
| v1.1.2 | 09-18 10:54 | v1.1.10 | 09-20 11:00 |
| v1.1.7 | 09-18 18:26 | v1.1.12-beta.1 | 09-21 13:30 |
| v1.1.8 | 09-19 00:11 | v1.1.11 | 09-22 00:15 |
| — | — | v1.1.12 | 09-22 11:21 |

**后 10 个版本/归档 tag**

| tag | 时间 | 备注 |
| --- | --- | --- |
| v1.1.69 | 10-11 03:38 | |
| v1.1.70 | 10-11 18:01 | 当天即被 1.1.71 修 |
| v1.1.71 | 10-11 19:09 | **最后一个版本** |
| archive/pr-110-head / -merge | 10-12 11:55 / 11:56 | 镜像归档 |
| upstream-snapshot-6c1d638 | 10-12 14:10 | 镜像归档，上游末态 |
| archive/pr-115-head / -merge | 10-13 11:35 / 11:36 | 镜像归档 |

**发布数学**

| 指标 | 数值 |
| --- | --- |
| 72 个版本 tag 覆盖区间 | 2026-09-18 00:27 → 2026-10-11 19:09 = **23.8 天** |
| 平均间隔 | **8.04 小时** |
| 间隔中位数 | **4.94 小时** |
| 最密一天 | 09-28 一天 8 个 tag（1.1.25 → 1.1.35 区间内），10-11 一天 5 个（1.1.67–1.1.71 附近） |

结论：**一天多版**是常态，版本号在这里更像“构建号”，不是语义化版本。预发布通道也混乱：
- `v1.1.12-beta.1`(09-21 13:30) 出现在正式 `v1.1.11`(09-22 00:15) 之前 —— beta 比正式版先发。
- `v1.1.23`(23:39) 在 `creatordate` 排序中排在 `v1.1.23-beta.3`(21:50) 之前 → tag 对象创建时间与 commit 时间不一致，排序与语义不符。
- `v1.1.24-beta.1` 与 `v1.1.24` 落在**同一分钟**（09-27 23:45）。

### A4. 版本主线（结合 `release-notes.md` 与 commit message 的阶段划分）

| 阶段 | 版本区间 | 时间 | 在做什么 | 代表 commit |
| --- | --- | --- | --- | --- |
| ① 原型期（旧版本号 1.3.x） | 0.x / 1.3.5–1.3.6 | 08-19 → 09-13 | 单插件“清洗”补丁集（8→25 条 patch），Windows CMD 无感、Electron 宿主兼容、README 双语 | `abaa4ed`、`8e664ab`（25 patches）、`742861f`（1.3.5）、`445b357`（1.3.6）、`e415eb2`（PR #11 Electron 宿主） |
| ② 版本号重置 + 自更新 | 1.1.0 – 1.1.9 | 09-17 → 09-19 | 设置页“检测 GitHub master 更新”、一键回退上一句；**提示词从仓库下线改成内置加密槽**（治理转折） | `3f1ef4d`、`e8567a8`（1.1.0）、`6432288`（1.1.8 内置）、`f16ba86`（1.1.9 提示词下线） |
| ③ 双通道 + Skill + 官方桌面 | 1.1.10 – 1.1.21 | 09-20 → 09-25 | 正式/测试分栏、Skill 导入、空提示词拦截、官方桌面 EXE 支持、升级包安装 | `f9386d7`（1.1.11 分栏）、`cff7ebc`、`fd8d47c`（1.1.19 EXE）、`978538f`（1.1.20） |
| ④ 幂等战争 + dsh 0.1.7→0.2 | 1.1.22 – 1.1.39 | 09-27 → 09-29 | 提示词“每次 apply 叠加 +841 字符”回归、`skipIfMarked`、跨站调用拦截、中文 Windows 重启卡死 | `82a3cf0`、`1693532`（1.1.15）、`c9ffb30`（1.1.16）、`44de3c3`、`be2189d`（1.1.39） |
| ⑤ **红队子系统落地**（架构转折） | 1.1.31 起 | 09-28 | 一次 commit 引入整个 `lib/redteam` + `presets/redteam` + `skills/redteam`；演练台从测试版转正式版 | `f988474`（**+24,155 / −26，57 文件**）、`c08fd47`（1.1.32 演练台布局）、`7fc64e4`（1.1.34） |
| ⑥ dsh 0.2.0 适配 + 官方/红队分流 | 1.1.40 – 1.1.47 | 09-30 → 10-02 | 适配 DSH 0.2.0、应用后自动重启、官方模式与红队分开注入、地区闸门（net-scope）、**演练台法律门禁** | `3bc63be`（1.1.40）、`eed95f7`（1.1.41）、`b7c1400`（1.1.47 首次用户须知/`docs/drill-auth-legal.html`） |
| ⑦ 稳定注入 + 极简/PTC 清洗 | 1.1.48 – 1.1.60 | 10-02 → 10-06 | 桌面跟 Web 配置、skill/MCP 按任务选用、回退轮次、极简预设、桌面补丁 | `7a8ba73`（1.1.48）、`af13e8c`（1.1.60）、`15df041`（1.1.59） |
| ⑧ 红队流程 + 宿主重启攻坚 + 自伤修复 | 1.1.61 – 1.1.71 | 10-07 → 10-11 | 红队八项修复、截图报告、85 项清单、inject 规则 v3→v7 反复、#83–#91 桌面崩溃/重启 dialog、最后两版修自身语法与 steer 误伤 | `24710ff`（1.1.64，−1,777 行）、`76e64d6`（1.1.65）、`d26e69a`（1.1.67）、`4fc6db7`（1.1.68）、`a5dcbb0`（1.1.70）、`5e75726`（1.1.71） |

**重大转折点（明确的三次）**

1. **提示词从仓库下线 → 内置加密槽**：`6432288`(1.1.8) + `f16ba86`(1.1.9, “将提示词从仓库中下线”)。此后 `lib/default-prompt-inject.md` 永不入库（`.gitignore:29` 显式忽略）。这是**治理层转折**：内容不再可审计，只留二进制/加密产物。
2. **架构重写为“清洗 + 演练台”双子系统**：`f988474`(2026-09-28, v1.1.31)。单 commit 灌入 24k 行、57 文件，`lib/redteam` 一夜之间成为 17 文件 / 16,678 行 / 占全部代码 33.1% 的子系统（`package.json:12-15` 导出 `./redteam*` 四条子路径）。
3. **UI 改版为右侧栏“白墨玻璃”面板**：`2926837`(09-30, “面板改为白墨玻璃”)、`813fbe4`(10-04, “面板不再盖住官方对话”)、`a99fba5` 之后的 `scripts/patch-client-dock.mjs`；`client.js` 最终长到 8,402 行（占全部文本行 16.7%）。

### A5. 发布最密集的 30 天 与 改动最大的 5 个 commit

**最密集 30 天窗口（滑动窗口，按天聚合）**

| 窗口 | commit 数 |
| --- | --- |
| **2026-09-16 ~ 2026-10-13** | **201** |
| 2026-09-13 ~ 2026-10-12 | 201 |
| 2026-09-17 ~ 2026-10-13 | 199 |
| 2026-09-18 ~ 2026-10-13 | 192 |
| 2026-09-10 ~ 2026-10-09 | 180 |

即：**全项目 231 个 commit 里有 201 个（87%）挤在最后 28 天**，前 30 天（08-19→09-15）只有 30 个。

**改动最大的 5 个 commit（`git log --shortstat` 按 ins+del 排序）**

| 排名 | commit | 日期 | 文件 | +/− | churn | 主题 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `f988474` | 09-28 | 57 | +24,155 / −26 | **24,181** | 1.1.31 演练台进入正式版 —— 红队子系统整体灌入 |
| 2 | `4fc6db7` | 10-11 | 26 | +1,725 / −1,366 | 3,091 | release 1.1.68 |
| 3 | `6e40734` | 10-02 | 36 | +2,308 / −737 | 3,045 | 1.1.45 稳住默认注入 + 清洗进度显示 |
| 4 | `dd53482` | 08-31 | 13 | +2,064 / −838 | 2,902 | 加入默认破限制提示词、支持桌面端（旧版号时代） |
| 5 | `76e64d6` | 10-08 | 20 | +1,607 / −744 | 2,351 | 1.1.65 截图报告与默认提示词 |

紧随其后：`af13e8c`（10-06，+1,458/−789，1.1.60 极简/PTC 清洗）、**`24710ff`（10-08，+279/−1,777，1.1.64 “红队流程八项修复”，净删除 1,498 行）**、`53d472f`（09-29，+1,037/−949，1.1.38 红队守住目标）。

> 判读：除 #1 是“外部代码整体引入”（等于一次 vendor import，无评审痕迹）之外，其余 4 个都是**单日功能 + 修复的混合大包**（1,000–2,300 行 / 20–36 文件），粒度严重偏粗，无法 code review、无法二分定位。

### A6. 回滚与紧急修复

显式回滚 commit（`^Revert` / `revert(...)`）**3 个**：

| commit | 日期 | 回滚内容 | 距被回滚改动 |
| --- | --- | --- | --- |
| `df25a90` | 09-28 | `Revert "fix: 发布 1.1.29，更新下载不再把 GitHub 302 当成失败"` | 同日，`9504b8a` → `df25a90` |
| `e6ce8dd` | 10-09 | `revert(inject): v6 回到 v3 规则 — v4 turn-start / v5 全 full 都失败` | 同日，前三版规则接连失败 |
| `164e151` | 10-10 | `revert(#85): 撤销 host 自杀 Electron — 会被 Job Object 连带杀` | 次日回滚前一天的方案 |

**“准回滚”/功能收回（release notes 语义）：**

| 事件 | 证据 |
| --- | --- |
| 1.1.29 撤销后 **1.1.30 无 1.1.29**（版本号消失） | `df25a90`；tag 列表无 `v1.1.29` |
| 1.1.45 被判“有问题”，1.1.46 **直接跳过** | `81c48bf` “1.1.46，略过有问题的 1.1.45” |
| 1.1.70 **语法错误打进了 Release**，1.1.71 同日晚间修 | `d4fd75a`（`??` 混 `||` 导致 `failed to import`）→ `5e75726`；`release-notes.md:9` 自认“发版前 `node --check`，避免再把语法错误打进 Release” |
| #86 steer 改动误伤公共 API，1.1.71 **收回** | `5e75726`“收回 #86 steer 误伤” |
| 测试目录**删了又加、加了又删** | `0a93ee8`（去掉 test，−308 行）→ `55f1431`（“把误删的 test 加回”）→ `0a93ee8` 再次删除；同日 `d6575dd` 改文档“本地校验去掉 npm test” |

**频率评估**：
- 严格意义的 revert：3 次 / 231 commit ≈ **1.3%**，但集中在 09-28 → 10-10 的 13 天内（3 次 / 该窗口约 140 commit ≈ 2.1%）。
- 广义“发版即修”（次版本修复上一个版本自身缺陷）：`d4fd75a`、`5e75726`、`4fc6db7`、`56ba72a`、`f8de768`、`c99dc4d`、`7aab036`（1.1.25 注释提前结束导致 SyntaxError）——**至少 7 次**“自己的上一版不能装/不能启动”。这比 revert 数量更能说明质量控制缺位。

---

## B. 文档与生态

### B1. `README.md`(586 行) / `README.zh-CN.md`(595 行)

**结构**（两者同构，`README.zh-CN.md` 的 26 个标题）：

| 段 | 行号（zh-CN） | 内容要点 |
| --- | --- | --- |
| 徽章 / banner / 目录 | 1–58 | 求 star、频道入口 |
| ☕ 赞助 | 59–73 | 已从微信码改成**链上地址**（`e8c8d09` 09-19 “赞赏改为链上地址，去掉微信码”） |
| 介绍 + 卖点表 | 74–95 | 自称“网络安全红队评测插件”；卖点 4 条：侧栏（清洗/演练台）、宿主策略、启动自动重应用、不写死盘符 |
| 📌 非盈利公益项目声明 | 96 | “严禁任何主体用于商业售卖、付费倒卖或黑灰产牟利” |
| **署名要求** | 98–104 | “借用名称、思路、代码或提示词，**必须署名**，并写明来源仓库”；不署名“将依法追究责任” |
| **违规商用公示** | 106–125 | 抖音「老张的ai」/「老张AI讲堂」+ 微信「老张的ai科技」三张实拍图 |
| 严正法律免责声明 | 127–159 | 见 B3 |
| 适配范围 | 161–171 | 只支持 dsh 0.2（桌面 0.2.0-rc.2 / `dsh web`）；0.1.7 及更早用 1.1.39 及以前 |
| 安装（三种路径） | 172–346 | ①交给 AI 助手 `dsh plugin add` ②手动 ③卸载 `/purge uninstall` |
| 界面预览 / 目录结构 / 使用 | 347–427 | 截图 6 张（`docs/preview/*.png`）；CLI `--status/--apply/--revert/--uninstall/--edit`；聊天 `/purge`、`/rules`、`/skills`、`/rewind`；模型工具 `purge_status/apply/revert` |
| 响应速度、自己的服务器 | 428–472 | 地区闸门（net-scope）与“已登记 IP 不再被拦”（`faf7e10` 09-30） |
| **本地校验** | 473–483 | **只有 `node --check` × 5 行**，无测试、无 lint 命令 |
| 工作原理 | 485–553 | mermaid 流程图 + 补丁/备份/加密默认提示词 |
| 还原 / 路径探测 / 更新 / 说明 | 554–595 | `.dshpurge.bak` 回滚、`$DSH_HOME`→`.dsh`→`~/.dsh` 顺序、更新说明 |

**关键声明摘录**
- `README.zh-CN.md:32`：“**暂停更新。** 作者因工作安排，近期没有稳定收入，项目维护暂时搁置：不再发版、暂不收 issue / PR，也不保证跟进新版 dsh。”（commit `6c1d638` 10-12，最后一次内容提交）
- `README.zh-CN.md:34`：官方 Web 与官方桌面端“**两边都要装、分开应用**”；社区桌面端不维护。
- `README.zh-CN.md:78`：“本插件只处理使用者本机已安装的官方 `@deepseek-ai` 包和本机配置。它不是公网扫描器。”
- 二开署名要求（`README.zh-CN.md:98-104`）：必须署名 + 写来源仓库；`14993f5`（10-03）专门“README 写明借用名称、思路、代码、提示词必须署名”。

### B2. `MIRROR-NOTICE.md`（105 行）

| 项 | 内容 | 行号 |
| --- | --- | --- |
| 性质 | `YuJunZhiXue/dsh-purge` 的**全量镜像**，由 `@mmparko` 在上游“宣布删库前”备份 | 3–4 |
| 原许可证 | MIT，`LICENSE` **原样保留未改动** | 15 |
| 权利归属 | “名称、思路、代码、提示词的一切权利与署名均归原作者” | 17–18 |
| 二开约束 | 必须保留本说明与原仓库链接；沿用“非盈利条款：不得卖课/卖插件/卖 token/倒卖” | 20–23 |
| 备份内容 | 分支 `master` / `fix/restart-sticky`；原版 tag 73 个（`v1.1.1`…`v1.1.71` + `restore-issue-25`）；PR 归档 tag 26 个；`upstream-snapshot-6c1d638`；Issue/PR 存档在 `upstream-archive` 分支 | 29–36 |
| Issue 规模 | 91 issue + 24 PR，135 条评论 | 36 |
| 相对上游唯一差异 | `master` 只多 `MIRROR-NOTICE.md` 一个 commit | 41–44 |
| 备份记录 | 2026-10-13；上游 `master`=`6c1d638`，`fix/restart-sticky`=`1f5c2ff`，`v1.1.71`=`5e75726`；**星标 4,995 / fork 612** | 48–56 |
| 完整性 | ref 101/101 一致；源码包 SHA256 = `4acda024…dace106`；blob 121/121 一致；`git fsck --full` 通过 | 60–65 |
| 校验命令 | `git diff --stat upstream-snapshot-6c1d638 master`、`git ls-remote` 对拍 | 69–97 |

**评价**：这份文件是**整个仓库里工程治理质量最高的一份文档** —— 有 SHA、有校验和、有可复现命令、有明确的 ref 差异声明。镜像侧（`033e6bd`）反而比上游更严谨。

### B3. `release-notes.md`（830 行）

- 结构：每个版本 `# <version>` + `## 中文` + `## English` 双语条目。共 **54 个版本条目**，覆盖 `# 1.1.71`（第 1 行）→ `# 1.1.16`（第 814 行），**1.1.16 以前的 1.1.0–1.1.15 不在其中**（历史断档；早期记录在 `f08f407` 之前被折叠/删除）。
- CI 强约束：`release.yml:42-46` 要求 `release-notes.md` 第一行必须等于 `# ${version}`，否则发布失败 —— 这是仓库里唯一被自动校验的文档契约。

**最新几条（第 1–20 行原文要点）**

| 版本 | 说了什么 |
| --- | --- |
| **1.1.71**（`5e75726`） | ① 修 1.1.70 的 `??` 混 `||` 导致插件启用 `failed to import`；② **#86 只改 UI 队列 steer→followup，公共 `steer()` 收回 next-step**（即上一版改错了 API）；③ `installed-rev` 跨版本不再沿用旧 `apply:x.y.z`；④ **“发版前 `node --check` 主入口，避免再把语法错误打进 Release”** |
| **1.1.70**（`a5dcbb0`） | ① Hub/残装注入 `pluginPackages` 会让 Cordis 一直 pending、宿主退出码 1，本版把依赖钉回 `systemPrompt`+`tools`；② 清洗页只合并升级链展示，Apply 仍打全部补丁；③ 去掉死行 #81/#89；④ **“指挥端改为「按用户给的目标开工」。合并 #97/#98/#99”**；⑤ `release-notes.md:33` “Commander bind: start from the user's target” |
| **1.1.69**（`e581245`） | ① 发送时剥掉 ChatML / `project_instructions`（“框和磁盘不动”）；② Apply+重启挂当前默认；③ 红队只排不折：注入→cap→红队正文；④ **“红队操作稿锁「上面的提示词作准」；指挥端去掉「给了单位名就授权」”** |

**“停更/争议/收回功能”在 release-notes 里的分布**：
- **停更**：不在 `release-notes.md`，只在 README（`README.zh-CN.md:32`，`6c1d638` 10-12）。release-notes 最后一条仍是 1.1.71 的功能说明。
- **收回功能**：1.1.71 收回 #86 的 `steer()` 语义；1.1.70 钉回依赖；1.1.69 “指挥端去掉「给了单位名就授权」”——三次都是**把上一版的放开改成收紧**。
- **争议**：release-notes 里没有“老张”等争议内容（`grep` 无命中），争议只出现在 README/README.zh-CN 与 `docs/notice/*`。

### B4. `docs/` 说明项目遇到了什么外部争议

| 文件 | 内容 | 指向什么 |
| --- | --- | --- |
| `docs/drill-auth-legal.html`（58 行） | 演练台进门强制阅读的**8 节法律声明**：①不含违法内容 ②本机操作≠对外授权 ③允许范围（本机/离线合成靶标/书面授权靶场）④逐条列 **刑法 285 条 1–3 款、286 条 1–3 款、287 条 + 287-1、287-2、253-1；网安法 13/14/29/33/46/48/50；数据安全法 8/32/51；个保法 5/6/10/13/28/29** ⑤禁止方向 ⑥责任 ⑦“违约即终止授权” ⑧与 DeepSeek 官方无隶属关系 | **国内合规压力**：作者被迫把“本机补丁”与“对外渗透”切开（第 2 节标题即“本机操作不构成对外授权”），并明确“只填一个单位名称或只有口头说法，不构成授权”（`drill-auth-legal.html:10`）。对应 `b7c1400`(1.1.47) “演练台环境适配与首次用户须知”。 |
| `docs/redteam-upstream-DISCLOSURE`（86 行） | `dsh-redteam-mode`（上游 `Jueze-2019/dsh-redteam-mode`）的 **dual-use 声明**：声明“no exploit code / no payloads / no C2 implants”，列出 5 项双用途能力（编排扫描器、本机执行、侦察指导、凭证处理指导、`scripts/redteam-setup.sh` 下载开源工具）、3 条硬边界（授权限定、数据本地 SQLite、工具不做范围判定）、目标用户（专业红队/专用 Kali VM） | **npm dual-use 政策合规**：这是为过 npm/平台审核写的“双用途内容申报”，同时是红队子系统的法律护城河 |
| `docs/redteam-upstream-LICENSE` | MIT，`Copyright (c) 2026 Jueze-2019` | 第三方代码来源许可，需随包保留 |
| `docs/notice/laozhang-live-1.jpg` / `-2.jpg` / `laozhang-wechat-1.jpg`（97.9 KB / 98.7 KB / 47.3 KB） | 抖音直播“问价/收钱”与微信“自称开发者”的截图 | **商业盗卖争议**：`e237200`(10-12) “公示抖音账号「老张的ai」违规售卖”、`d5bd4ac`(10-12) “公示微信「老张的ai科技」自称开发者” |
| `README.zh-CN.md:106-125` | 争议的**文字版**，含时间戳“2026-10-12 直播记录”与对方账号名 | 同上 |

**争议性质判断**：不是版权/专利纠纷，而是**两件事**——
1. **上游对下游的盗卖指控**（老张卖课/卖插件，违反非盈利条款，未署名）；
2. **平台合规压力**（红队能力被质疑 → 补 dual-use DISCLOSURE + 进门法律门禁 + README 严正声明 + 反复“收紧”的 release notes）。
3. 附带第三件：上游最终**宣布删库**（`MIRROR-NOTICE.md:4`），镜像因此产生。这与“暂停更新”（`README.zh-CN.md:32`：无稳定收入、不再发版、不收 issue/PR）时间吻合（10-12 同一天）。

### B5. `presets/` 与 `skills/` 的定位

| 目录 | 规模 | 面向谁 | 怎么被消费 |
| --- | --- | --- | --- |
| `presets/redteam/` | 3 文件 / `preset.yml`(5 行元数据) + `agent.cordis.yml` + `anchor-gate.mjs` | **最终用户**（在选“红队模式”预设的人）。`presets/redteam/preset.yml:2-3` 自述：“发送一个靶标单位名称即可拉起红队智能体。内置主会话 + 信息收集/资产梳理/漏洞发现/漏洞利用/内网渗透五个执行角色（并发最多 3 个）” | 由 `lib/index.js:411`（`readdirSync(presetDir)`）和 `lib/redteam/preset-composition.js` 读取合成；`cordis.patch.yml` 插入 `dsh-purge-redteam` 三个 bundle 条目（`lib/redteam`、`/store`、`/ui`） |
| `skills/redteam/` | **23 个 .md / 约 148 KB**（`gogo-intranet.md` 10.0 KB、`vps-reverse-shell.md` 9.6 KB、`fscan-intranet.md` 9.3 KB、`credential-attack.md` 8.9 KB…） | **执行角色（agent）本身**，不是人读的教程。带 YAML front-matter：`name/description/whenToUse/role/enabled`，例如 `skills/redteam/nuclei-scan.md:1-6`，`role: vuln-scan` | `lib/redteam/index.js:154-161` “把包内 `skills/redteam/*.md` 同步到 `$DSH_HOME/redteam/skills`（分叉时两个 home 都放一份）”；`index.js:356` 统计数量；`lib/redteam/skill-availability.js` 做可用性判定。**技能不进注入段**（`README.zh-CN.md:396`：“Skill 不进注入段，也不顶替提示词”） |

> 生态判断：`presets/` + `skills/` 是把“agent 行为”做成可分发资产（内容层），`lib/redteam` 是运行时（代码层），`docs/redteam-upstream-*` 是法务层。三层叠起来才构成一个“红队取证/编排产品”。`cordis.patch.yml:2-19` 还显式 `disabled: true` 掉旧的独立包 `dsh-redteam-mode` / `redteam-store` / `redteam-ui`，说明它是**把外部红队包吸收进单体插件**，而不是继续依赖。

---

## C. 工程质量体检

### C1. 测试 / Lint / CI / 依赖锁

| 项 | 现状 | 证据 |
| --- | --- | --- |
| 单元测试 | **无（且是主动删掉的）** | 曾有 `tests/`（3 文件 181 行，`2529db6` 09-18 “删除tests”）；曾有 `test/`（4 文件 308 行，`0a93ee8` 10-11 “chore: 1.1.70 去掉 test”），中间 `55f1431` 还“把误删的 test 加回”，随后又删 |
| `package.json` scripts | 只有 2 个：`embed-prompt`、`build:client`（`package.json:36-39`）。**没有 `test`** | `package.json:36-39` |
| Lint / 格式化 | 无。无 `.eslintrc*` / `eslint.config.*` / `.prettierrc*` / `biome.json` | `git ls-files` 109 项全量核对 |
| CI | **唯一 workflow `Release`**（62 行），触发 = push master；做三件事：`node --check lib/index.js|core.js|reapply.js`、`node --input-type=module -e "import './lib/index.js'"`、`gh release create` | `.github/workflows/release.yml:24-29,31-61` |
| CI 覆盖面 | ❌ 无 lint、❌ 无测试、❌ 无 matrix（单 ubuntu-latest）、❌ 无 Windows/macOS 验证——而项目核心能力是**改 Windows 注册表/asar/CMD/PowerShell**（`lib/desktop.js`、`lib/official-update.wscript`、`lib/hide-console.js`） | 同上 |
| CI 在镜像里 | `if: github.repository == 'YuJunZhiXue/dsh-purge'`（`release.yml:17`）→ **镜像 fork 上 CI 永不运行**，等于没有任何保护 | `release.yml:17` |
| 依赖锁 | 无 `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`；无 `node_modules`（`.gitignore:2`）；`package.json` **无 `dependencies` 字段**，只有一个 `peerDependencies.cordis ^4.0.1` | 目录实测四个锁文件均 `False`；`package.json:88-90` |
| 依赖结论 | **零运行时依赖**（好事：无供应链面积），但 `dsh.client.inject` 声明了 5 个 `@deepseek-ai/dsh-client-*` 包却**完全没在 peerDependencies 里声明**（`package.json:70-77` vs `88-90`）→ 宿主侧版本不匹配时只在运行时炸，CI 抓不到 | 同上 |
| 自带构建脚本 | `scripts/build-client.mjs`、`embed-default-prompt.mjs`、`patch-client-dock.mjs`、`export-engagement-report.mjs` 均为手写 Node 脚本，无 bundler 配置、无 lock | `git ls-files` |

### C2. 代码度量

| 指标 | 数值 |
| --- | --- |
| git 跟踪文件 | 109（其中文本 99，图片 10） |
| 文本总行数 | **50,435 行** |
| `.js` | 51 文件 / **44,728 行（88.7%）** |
| `.md` | 27 文件 / 3,560 行（7.1%，含 README 586+595、release-notes 830、skills 23 篇） |
| `.mjs` | 6 / 847；`.yml` 4 / 456；`.sh` 1 / 451（`scripts/redteam-setup.sh`）；`.wscript` 1 / 93 |

**最大 10 个文件占比（按文本行）**

| # | 文件 | 行数 | 占比 | 累计 |
| --- | --- | --- | --- | --- |
| 1 | `client.js` | 8,402 | 16.7% | 16.7% |
| 2 | `lib/core.js` | 7,688 | 15.2% | 31.9% |
| 3 | `lib/redteam/store-core.js` | 5,121 | 10.2% | 42.1% |
| 4 | `lib/redteam/client.js` | 4,044 | 8.0% | **50.1%** |
| 5 | `lib/index.js` | 2,513 | 5.0% | 55.1% |
| 6 | `lib/redteam/tools.js` | 1,918 | 3.8% | 58.9% |
| 7 | `lib/desktop.js` | 1,666 | 3.3% | 62.2% |
| 8 | `lib/redteam/ui.js` | 1,110 | 2.2% | 64.4% |
| 9 | `lib/update.js` | 1,036 | 2.1% | 66.4% |
| 10 | `lib/identity.js` | 918 | 1.8% | **68.2%** |

> **前 4 个文件 = 一半代码；前 10 个 = 68.2%**。109 个文件里 99 个文本文件，实质只有 30 来个模块，头部 4 个巨文件承担一半逻辑。

**单文件 > 1000 行清单（9 个）**：`client.js` 8,402 / `lib/core.js` 7,688 / `lib/redteam/store-core.js` 5,121 / `lib/redteam/client.js` 4,044 / `lib/index.js` 2,513 / `lib/redteam/tools.js` 1,918 / `lib/desktop.js` 1,666 / `lib/redteam/ui.js` 1,110 / `lib/update.js` 1,036。

**模块结构**：`lib/` 43 个文件，其中 `lib/redteam/` 17 文件 / **16,678 行 / 33.1%**（`cordis.patch.yml:2` 自称“清洗 + 演练台都在本插件内”）。
**测试缺口的具体后果**（不是理论风险，是已发生事故）：
- `7aab036` “1.1.25 注释里 `profiles/*/` 提前结束块注释导致 SyntaxError”
- `d4fd75a` “1.1.70 修复 `??` 混 `||` 导致启用 `failed to import`”
- `82a3cf0` “提示词每次 apply 叠加 +841 字符的回归”
- `e6ce8dd` “v4 turn-start / v5 全 full 都失败，v3 中途发送前正常”（同一注入逻辑一天内三版全错）
→ 这四条**任何一条单测都能拦住**，而仓库把测试删了。

### C3. 版本 / 元数据一致性

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| `package.json version` vs 最新 tag | ✅ **自洽**：`1.1.71` = tag `v1.1.71`（`5e75726`，10-11 19:09） | `package.json:3`；tag 列表末位 |
| vs `release-notes.md` 首行 | ✅ **自洽且被 CI 强制**：首行 `# 1.1.71` | `release-notes.md:1`；`release.yml:42-46` |
| `dshTarget` | ⚠️ **半自洽**：`"0.2.0-rc.2"`（`package.json:94`）与 README “官方桌面 EXE 0.2.0-rc.2”（`README.zh-CN.md:34`）一致；但 `release-notes` 里 1.1.44 时写“只适配 DSH 0.2”，之后 1.1.4x–1.1.7x 又反复改宿主锚点（#88 `renderedPrompt`/`system`），说明 `dshTarget` 是手工维护的字符串，**无任何自动校验**（CI 不读它） | `package.json:94`；`release-notes.md:8` |
| `peerDependencies` | ❌ **不自洽**：只声明 `@deepseek-ai/cordis ^4.0.1`，而 `dsh.client.inject` 依赖 5 个 `@deepseek-ai/dsh-client-*` 包（connection/runtime/locale/ui-slots/ui-settings）未声明任何 peer | `package.json:88-90` vs `70-77` |
| `files` 白名单 | ⚠️ **含死规则 + 过度打包**：① 负向规则 **`!lib/default-prompt-inject.md`** 指向一个**仓库里根本不存在**的文件（`.gitignore:29` 忽略、`git ls-files` 无此项）——历史遗留的“防泄漏”保险丝；② 白名单 **包含 `docs`**，因此 `docs/notice/laozhang-*.jpg`（244 KB 争议截图）+ 6 张预览 PNG 会被打进 npm 包；③ `release-notes.md`、`MIRROR-NOTICE.md`、`.github` 不在白名单 | `package.json:21-35`；`git ls-files` |
| `.npmignore` | ⚠️ 与 `files` 重复且包含同样两条死规则（`lib/default-prompt-inject.md`、`default-prompt-inject.md`） | `.npmignore:1-2` |
| 历史版本号断裂 | ❌ **有一次倒退**：`445b357`(09-13) 是 `1.3.6`，`e8567a8`(09-17) 变成 `1.1.0` —— 版本号从 1.3.x 回退到 1.1.x，历史不可比较；此外 **1.1.4/1.1.5/1.1.6 从未存在**、1.1.29 被 revert 后消失、1.1.45 被判废跳过 | `git show 445b357:package.json`、`git show e8567a8:package.json` |
| 内嵌常量 | ⚠️ 补丁总数为 **82**（`lib/core.js` 中 `id:` 计数 82），但 README/卖点仍沿用早期“3-layer, 8 patches”（`abaa4ed`）话术的残留（`package.json:4` description 仍写“破甲”定位而非补丁数） | `lib/core.js` grep 计数 82 |
| LICENSE 版权人 | ⚠️ **编码损坏**：`LICENSE:3` 读出 `Copyright (c) 2026 灏忔潹`——这是“小杨”被 UTF-8→GBK 误解再回写的结果（双重编码 mojibake），MIT 要求的版权人名字在当前字节里是乱码 | `LICENSE:3` |

### C4. 许可证与合规

| 层面 | 实际条款 | 冲突点 |
| --- | --- | --- |
| `LICENSE` | 标准 **MIT**，`Copyright (c) 2026 小杨`（字节编码损坏） | MIT 明文授予“use, copy, modify, merge, publish, distribute, sublicense, **and/or sell**” |
| `README` 非盈利条款 | “非营利公益项目，**严禁**任何主体用于商业售卖、付费倒卖或黑灰产牟利”（`README.zh-CN.md:96`）；“拿它卖课、卖插件、卖 token、倒卖，**许可当场作废**”（`:114`） | ❌ **与 MIT 直接张力**：MIT 不承认“非商业”限制，也不能被下游附加；此条在法律上是**无效加码**（只能作为社区道德约束/声誉手段），作者却写成“许可作废” |
| `README` 署名要求 | “借用名称、思路、代码或提示词，**必须署名**，并写明来源仓库”，不署名“依法追究”（`:98-102`） | ⚠️ MIT 只要求保留版权声明与许可声明，**不要求署名到“名称/思路/提示词”层面**；“思路/提示词”本身也不受版权保护。属于超出 MIT 的合同式要求 |
| `docs/drill-auth-legal.html` §7 | “一旦用于非法攻击…**使用许可自该行为发生之日起自动终止，且不可撤销**”（`:55`） | ❌ MIT 明确“irrevocable”授权不可撤回；§6 又自称“依据 MIT 协议按现状提供”（`:52`）→ **同一份文档里既援引 MIT 又加撤回条件**，自相矛盾 |
| 上游第三方 | `docs/redteam-upstream-LICENSE` = MIT (`Jueze-2019`)，`docs/redteam-upstream-DISCLOSURE` = dual-use 申报 | ✅ **兼容**：MIT→MIT 可再分发；DISCLOSURE 是申报不是许可限制。但 `skills/redteam/` 23 篇与上游 `dsh-redteam-mode` 的 23 篇文档同构（DISCLOSURE:26 自述“23 Markdown instruction documents”）→ 属**实质搬运**，需在包内保留上游版权声明（当前只在 `docs/` 放了两份文件，未在 LICENSE 或 skills 头部标注来源） |
| 镜像 | `MIRROR-NOTICE.md` 明确“原许可证 MIT 原样保留未改动”“不主张原创性、未再授权” | ✅ 合规姿态正确；但镜像**复制了非盈利条款**并要求下游“必须保留本说明”（`:20-23`）——同样是 MIT 之外的附加条件 |
| 品牌/官方关系 | `drill-auth-legal.html:56-57` 声明与 DeepSeek 官方无隶属/授权/背书；`README.zh-CN.md:78` 限定只操作本机官方包 | ✅ 这条做得干净，是必要的免责切割 |

**合规总评**：**许可文本（MIT）与项目自我表述（非盈利 + 强制署名 + 违约撤权）不一致**。落地效果是“MIT 给你法律自由，README 用舆论与道德约束你”。对二开者，法律上只需保留 MIT 声明；作者主张的署名/非商业义务在多数法域不可执行。风险不在诉讼，而在**社区信任**：一旦有人合法商用，作者无手段，只能像 10-12 那样把对方账号贴进 README（`e237200`/`d5bd4ac`）。

---

## 结论（三段式）

### 1. 成熟度：**功能成熟、工程幼稚（“能用的单人巨构”）**

- 功能面已经是一个**完整产品**：82 条宿主补丁 + 加密内置提示词 + 三端（Web/官方桌面/CLI）+ 侧栏双页 UI + 红队子系统（17 文件 16.7k 行、5 角色编排、SQLite 资产库、23 篇 runbook 技能）+ 报告导出。72 个版本、4,995 star、612 fork 是真实采用度的证据（`MIRROR-NOTICE.md:54`）。
- 工程面停在**脚本级**：0 测试（测试被删两次）、0 lint、CI 只有 `node --check` + 打 Release（`release.yml:24-29`）、0 锁文件、9 个 >1000 行文件、前 4 文件占一半代码、`client.js` 单文件 8,402 行。
- 直接后果不是理论风险：**至少 7 次“自己的上一版装不上/起不来”**（`7aab036` SyntaxError、`d4fd75a` 语法错误进 Release、`df25a90` revert 1.1.29、`e6ce8dd` 注入规则一天三错、`164e151` 撤销自杀式重启、`f8de768` 第三方代理注入全丢、`c99dc4d` 改 lock 导致不可安装）。这些全部可由单测/端到端冒烟拦截。
- 一句话：**能力 > 可靠性**。作为个人工具极强，作为可依赖的插件分发物不合格。

### 2. 维护状态：**已公告停更（2026-10-12），但上游仍在线、更新通道仍是活的**

> ⚠ **2026-10-23 复核（实测推翻本节部分结论）**：`git ls-remote https://github.com/YuJunZhiXue/dsh-purge` 返回 `6cb2ac32… refs/heads/master`，codeload tarball 仍可下载，且本机在 2026-10-23 09:13 通过该仓库的 tarball **自动更新到了 1.1.73**（`~/.dsh/dsh-purge/applied.json`）。所以"删库"只存在于 `MIRROR-NOTICE.md` 的叙述里，**代码仓库和分发通道都还活着**；镜像反而停在了 1.1.71，落后两个补丁版本。这条对风险评估的影响是反向的：不是"没人维护所以安全静止"，而是"公告停更了但仍在往用户机器推代码"。

- 最后代码提交 `5e75726`(10-11 19:09, 1.1.71)；10-12 三个 commit 全是文档（`e237200` 公示抖音盗卖、`d5bd4ac` 公示微信冒充、`6c1d638` 暂停更新）；10-13 只有镜像 `033e6bd`。**注意：以上是镜像视角**；上游在 10-13 之后仍有提交（1.1.72/1.1.73，本机已升级）。
- README 明写：“暂停更新…近期没有稳定收入…不再发版、暂不收 issue / PR，也不保证跟进新版 dsh”（`README.zh-CN.md:32`）。**停更原因是经济性的，不是技术性的**——这与 72 个版本/24 天的高强度产出形成对照，说明项目是被“一个人 + 无收入”耗尽的。
- 上游仓库在 `MIRROR-NOTICE.md:4` 被描述为“宣布删库”，镜像由 `@mmparko` 于 2026-10-13 完整备份（101/101 ref、121/121 blob、SHA256 逐字节相同），并保留 91 issue + 24 PR 存档在 `upstream-archive` 分支。
- 维护风险传导：`release.yml:17` 的 `if: github.repository == 'YuJunZhiXue/dsh-purge'` 使**镜像 CI 永久空转**；`package.json` 的 `repository`/`install.tarball`/`homepage` 仍全部指向 `YuJunZhiXue/dsh-purge`（`:58-82`）→ **镜像上的 release/issue 入口不可用**（但该仓库本身在线，安装链路没死，本机就是靠它升到 1.1.73 的）。

### 3. 主要风险来源（按严重度排序）

| # | 风险 | 为什么是真的 | 证据 |
| --- | --- | --- | --- |
| 1 | **形态风险：改宿主二进制 + 加密提示词，不可审计** | 插件向 `node_modules` / `app.asar` / `dsh.cmd` 写入 82 条补丁、注入 shim、覆盖官方更新与重启流程；提示词原文自 1.1.8 起不入库（`.gitignore:29`、`package.json:23` 负向规则残留）。**谁也无法验证“内置默认提示词”到底是什么**，这正是所有争议（盗卖、平台审核、红队合规）的物理根因 | `files`/`.npmignore` 的 `!lib/default-prompt-inject.md`；`6432288`、`f16ba86`；`cordis.patch.yml` |
| 2 | **合规风险：能力与免责声明脱节** | 一边 23 篇含 `vps-reverse-shell` / `webshell-toolkit` / `credential-attack` / `lateral-movement` 的 runbook + `redteam-setup.sh` 自动下载 fscan/gogo/chisel/frp（`DISCLOSURE:57-63`），一边 README/`drill-auth-legal.html` 声称“不含未授权渗透工具、不教唆”。实际介于两者之间；平台（npm dual-use、应用商店、国内合规）随时可能下架。作者被迫写了 58 行刑法条文级声明 + 进门勾选门禁，正是压力的化石 | `skills/redteam/*` 23 篇；`docs/redteam-upstream-DISCLOSURE`；`docs/drill-auth-legal.html:2-11,42-55` |
| 3 | **许可风险：MIT 与非盈利/署名/撤权条款自相矛盾** | MIT 明文允许 sell/distribute，README 说“卖就许可作废”；`drill-auth-legal.html:52` 引用 MIT、`:55` 又写“不可撤销地终止许可”。二开者法律上只需守 MIT；作者只能靠公开点名（老张三张截图）执行 | `LICENSE`；`README.zh-CN.md:96,114,98-102`；`drill-auth-legal.html:52,55` |
| 4 | **可维护性风险：回归靠用户报 issue 发现** | 无测试 + 无 lint + 无 Windows CI，而功能 88% 是 Windows/桌面相关；事故率已经体现在 revert 与“略过有问题的 1.1.45”上 | `release.yml`；`0a93ee8`；`81c48bf` |
| 5 | **元数据/分发风险：镜像上装不动** | `repository`/`tarball`/`homepage`/`bugs` 全指向上游已删仓库；`dsh.client.inject` 五个包未声明 peer；`files` 白名单把 244 KB 争议截图打进 npm 包 | `package.json:21-35,58-82,88-90` |
| 6 | **声誉风险：README 变战场** | 争议账号、直播问价截图、微信冒充截图常驻 README（`README.zh-CN.md:106-125`）+ `docs/notice/*` 三张图随包分发。上游已停更，这些内容不会被清理，会成为任何二次分发的永久负担 | `e237200`、`d5bd4ac`；`docs/notice/` |
