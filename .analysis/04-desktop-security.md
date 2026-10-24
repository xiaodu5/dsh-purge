# dsh-purge 1.1.71 — 桌面/进程侧 与 安全边界模块 解剖报告

审计对象：`C:\Users\13248\dsh-purge优化`（插件 `dsh-purge@1.1.71`，宿主为 DeepSeek Harness 桌面端 / `dsh` CLI）。
方法：全部结论来自真实读取（`read`/`grep`/`glob`），引用格式 `文件:行号`。已读模块：`lib/desktop.js`(1778)、`lib/restart-desktop.js`(472)、`lib/restart-web.js`(103)、`lib/uninstall-restart.js`(76)、`lib/extract-asar.js`(462)、`lib/zip-extract.js`(161)、`lib/official-update.js`(52)、`lib/official-update.wscript`(93)、`lib/update.js`(1120)、`lib/hide-console.js`(309)、`lib/child-process-hide.mjs`(87)、`lib/hooks-deny.js`(224)、`lib/net-scope.js`(673)、`lib/redteam/ip-utils.js`(140)、`lib/asset-table.js`(169)、`lib/table-key.js`(27)、`lib/table-read.js`(18)、`lib/reapply.js`(388)、`lib/uninstall.js`(286)、`lib/rewind.js`(645)、`lib/continue-retry.js`(360)、`lib/skills.js`(747)、`.github/workflows/release.yml`(62)。
一句话边界：插件把「装在自己目录里」的改动，延伸到了**宿主安装目录（解 asar、改 bin.js/CLI shim）、宿主进程生命周期（杀+重启+抢前台）、宿主提示词与 hook 判定（改源码字符串 + 注入 21KB 加密提示词）**三处；出网面干净（全 HTTPS + 7 域名白名单），但更新载荷无签名校验。

---

## 1. 进程与重启：怎么找到、怎么杀、怎么拉起来

### 1.1 定位宿主（三路取证）
1. **注册表卸载键**：PowerShell 读 `HKCU/HKLM/HKLM\WOW6432Node\...\CurrentVersion\Uninstall`，按 `DisplayName` 为 `DeepSeek Harness` / `DSH Desktop` 取 `InstallLocation`/`DisplayIcon`/`UninstallString`（`lib/desktop.js:308-332`），执行方式 `execFileSync("powershell.exe", ["-NoProfile","-Command",...])`，`timeout: 15000`，`windowsHide`（`lib/desktop.js:353-358`）。
2. **WMI 进程表**：`Get-CimInstance Win32_Process`，名字过滤 `DeepSeek Harness\.exe$|deepseek-harness\.exe$|DSH Desktop\.exe$`，`timeout: 6000`（`lib/desktop.js:440-464`）。
3. **快捷方式枚举**：遍历 `StartMenu`/`CommonStartMenu`/`Desktop` 下 `.lnk`，用 `WScript.Shell` COM 的 `CreateShortcut().TargetPath` 解析，`timeout: 15000`（`lib/desktop.js:482-506`）。

判定函数在 `looksLikeDesktopName` / `isDesktopExecutable` / `isOfficialHarnessExecutable`（`lib/desktop.js:112-186`），资源目录候选在 `resourceDirCandidates`/`resourcesDirForExecutable`/`appAsarPath`（`lib/desktop.js:189-229`），另有 `commonDesktopInstallDirs`（含 LOCALAPPDATA、ProgramFiles、`/Applications`、`/opt`，`lib/desktop.js:559-592`）。

### 1.2 四条重启路径（决策表）
`desktopRestartChoice()` 返回 `windows-official` / `asar-swap` / `helper` / `request-restart`（`lib/desktop.js:1169-1180`），`sealedSwapKind()` 判 asar 是否密封（`lib/desktop.js:1183-1185`），`scheduleRestart` 分发（`lib/desktop.js:1211-1262`）。

| 路径 | 触发条件 | 真实系统足迹 |
|---|---|---|
| `windows-official` | Windows + 官方 Electron + 需重建 asar | `wscript.exe //nologo //B <script>` **detached**，脚本落在 `%TEMP%\dsh-purge-official-restart-<suffix>.js`（`lib/desktop.js:1545`、`1431-1556`）；`planOfficialRestart` 先择优 wscript/powershell（`lib/desktop.js:1361-1374`），并用 `cscript.exe //nologo <临时 .js>` 写探针 txt 验证 WSH 可用（`lib/desktop.js:1407-1428`） |
| `asar-swap` | 已知安装根、asar 为文件 | 写 `%TEMP%\dsh-purge-asar-swap-<pid>.ps1` 后 detached 起 PowerShell（`lib/desktop.js:1136`），脚本 `ASAR_SWAP_PS1`：按**安装根路径**匹配杀进程 → robocopy 覆盖 unpacked → `Move-Item app.asar app.asar.bak`（80 次重试）→ 写 `.rename-pending` 锁 → `Start-Process $ExePath`（`lib/desktop.js:864-937`） |
| `helper` | 常规（非密封） | `spawn(process.execPath, helper, {detached:true})`，env 去掉 `DSH_PERMISSION_MODE`、置 `ELECTRON_RUN_AS_NODE=1`、把整份重启参数塞进 `DSH_PURGE_RESTART` JSON（`lib/desktop.js:821-856`） |
| `request-restart` | 宿主要求优雅退出 | `runtime.requestRestart()` 交接，失败兜底 `process.exit(0)`（`lib/desktop.js:1085-1163`） |

### 1.3 helper 实际动作（`lib/restart-desktop.js`）
- 参数来源：`process.env.DSH_PURGE_RESTART`，缺失直接 `exit 1`（`lib/restart-desktop.js:5-13`）；日志 `%TEMP%\dsh-purge-restart-desktop.log`（`16-27`）。
- 进程枚举：Windows 用 `tasklist /FI "IMAGENAME eq <image>" /FO CSV /NH`（`lib/restart-desktop.js:80-93`），镜像名硬编码 `DeepSeek Harness.exe`、`DSH Desktop.exe`（`187-196`）——**这一路是按镜像名杀，比 `desktop.js` 的路径匹配更宽**；macOS 用 `ps -Ao pid=,command=` 且排除 `dsh-desktop-host/lib/cli.js`（`122-151`），POSIX 同法（`159-182`）。
- 杀：`process.kill(pid, signal)`（`199-208`）；macOS 先走 `osascript -e 'tell application "X" to quit'` 再 SIGTERM→SIGKILL（`232-260`）；Windows 下 `killOtherDesktopProcesses` 连杀两次（`262-271`，调用处 `426-435`）。
- asar 释放：`moveAsarAsideAsync` 80×300ms 重命名 `app.asar`→`.bak`（`273-301`），失败再杀一轮后重试，仍失败则**不重启**并 `exit 1`（`311-322`、`463-466`）。
- 环境清洗：删 `DSH_PERMISSION_MODE`、`DSH_PURGE_RESTART`、任何大小写形式的 `ELECTRON_RUN_AS_NODE`，缺 `DSH_PROFILE` 时补 `desktop`（`lib/restart-desktop.js:29-42`）。
- 拉起：Windows 追加 `--updated` 走宿主自带 `raiseAfterUpdate` 分支，`spawn(execPath, argv, {detached, stdio:"ignore", windowsHide, shell:false})` + `unref()`（`lib/restart-desktop.js:344-362`）。
- **抢前台**：`powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command <script>`，`Add-Type` 引入 `user32/kernel32` 的 `SetForegroundWindow`/`ShowWindow`/`BringWindowToTop`/`GetForegroundWindow`/`GetWindowThreadProcessId`/`GetCurrentThreadId`/`AttachThreadInput`/`keybd_event`；先发虚拟 Alt 键解除前台锁，再 `AttachThreadInput` 继承前台线程输入队列，25 次×300ms 轮询 `Get-Process | ? {$_.Path -eq <exe> -and $_.MainWindowHandle -ne 0}` 后 `ShowWindow(h,9)`+`BringWindowToTop`+`SetForegroundWindow`（`lib/restart-desktop.js:371-417`）。

### 1.4 Web 服务（`lib/restart-web.js`，103 行）
- 端口/主机：`Number(info.port) || 3080`、`info.host || "127.0.0.1"`（`15-16`）——**没有端口自动选择/扫描逻辑**，只有固定端口 + 等释放。
- 释放探测：`net.createConnection({host,port})`，连上=占用，error=空闲（`18-26`）；`waitFree()` 40×120ms，第 8 次（≈960ms）时 `killOldServer()`（`52-64`）。
- 杀旧服务：win32 `spawnSync("taskkill", ["/PID", pid, "/F"], {windowsHide:true})`，其他平台 `SIGTERM`（`28-36`）。
- 重启：`spawn(info.execPath, info.argv, {detached:true, stdio:pipe, windowsHide:true})`（`71-78`），从 stdout/stderr 正则 `/dsh web:\s+(https?:\/\/\S+)/` 抓地址（`81-92`），然后用 `cmd.exe /d /s /c start "" URL` 打开浏览器（`38-50`），最长等 20000ms / 1500ms 兜底（`94-102`）。
- 为什么要重开浏览器：注释明确旧 token 失效（`69`）。
- `lib/uninstall-restart.js` 是同一套的卸载版：只等端口空（80×120ms）、删 `cleanup` 目录、删 helper、detached 重拉（`lib/uninstall-restart.js:26-76`）。

### 1.5 官方升级后的重启（`lib/official-update.wscript`，93 行）
占位符注入 `__EXE_JSON__/__INSTALLER_JSON__/__RESOURCES_JSON__/__INSTALL_DIR_JSON__/__LOG_JSON__`；WMI 查 `DeepSeek Harness.exe` 的 `ProcessId,ExecutablePath`（`15`），逐个 `sh.Run('taskkill.exe /F /PID '+pid, 0, true)` 并等 20s（`22-26`）；`resources\app` → `app.dshpurge-prev`（时间戳兜底、40 次重试，`32-39`）；缺 `app.asar` 时从 `.bak` 还原（`41-44`）；`sh.Run('"'+installer+'" --updated /S /D='+installDir, 0, true)` **静默 NSIS**，失败重试裸 `/S /D=`（`48-65`）；失败则删掉刚还原的 asar、把 prev 目录移回、`sh.Run('"'+exe+'"', 1, false)` 拉起旧版（`66-81`）；成功写 marker `resources\dsh-purge-reapply-asar` 再拉起（`82-93`）；两处都清 `ELECTRON_RUN_AS_NODE`（`79`、`90`）。

---

## 2. asar 解包与安装：宿主安装目录被就地改写

- **封印判定**：`isAsarSealedPath` 逐级（≤12 层）判断路径是否被 `app.asar` 遮蔽，带 5s TTL / 40 万条上限的探测缓存（`lib/extract-asar.js:41-70`、`96-120`）。
- **文件系统对象分流**：`diskFs()` 用 `createRequire` 取 Electron `original-fs`，退化到 `node:fs`（`13-22`）；`fsFor`/`hostFs` 按目标路径决定用哪套 fs（`127-170`）——为的是绕开 Electron 对 asar 内路径的透明重定向。
- **解包流程**：`readHeader` 校验魔数 `4`、`jsonSize ≤ 256MB`（`240-253`）→ `renameAsarAside` 把 `app.asar` 改名 `<asar>.bak`（EBUSY/EPERM/EACCES 视为 busy 重试，`182-196`）→ `extractAsarToSide` 解到 `<dest>.dshpurge-next`（`315-325`）→ `overlayAsarUnpacked` 把 `app.asar.unpacked` 内容复制叠加（`285-307`）→ `commitExtractedDir`：`dest→.dshpurge-prev`、`next→dest`，失败写 `<dest>.dshpurge-recover.json`（`338-370`）。符号链接逃逸有 `path.resolve` 包含性检查（`417-462`）。
- **备份/回滚**：`newestPreservedDir`（`373-392`）、`restoreExtractedDir`（`395-415`）；`reapply.js` 在清洗失败且本次是新解目录时调 `restoreSealedExtract` 放回上一份（`lib/reapply.js:341-355`）。`official-update.js:28-37` 的 `clearStaleExtractedApps` 会**主动删掉** `resources\app.dshpurge-prev*`，即官方升级后旧备份不再保留。
- **宿主 CLI 改装**（真正动宿主文件的三处）：
  1. `patchOfficialCliShimText`：三级回退定位 `app.asar` → `app.asar.unpacked` → `app`，用 `BEGIN/END` 标记块改写 shim JS（`lib/desktop.js:1613-1653`）。
  2. `patchOfficialCliCmdText`：改写 `.cmd` 启动器（`lib/desktop.js:1694-1733`）。
  3. `ensureAppRuntimeSymlink`：建 junction `app\runtime` → `..\runtime`（`lib/desktop.js:1583-1611`）；`repairOfficialCliAfterUnpack` 写 `<shim>.dsh-purge.bak` 后再原子写（`lib/desktop.js:1736-1778`）。
- **marker**：`MARKER_NAME = "dsh-purge-reapply-asar"`，仅在 `DeepSeek Harness.exe`/`deepseek-harness.exe` 旁生效（`lib/official-update.js:7-15`），由 wscript 成功后写入（`lib/official-update.wscript:82`）——作用是让后续官方更新继续沿用「已解包 + 已打补丁」的状态，而不是回到密封 asar。
- **子进程侧释放**：`spawnHelper`（`lib/desktop.js:821-856`）→ `restart-desktop.js` 的 `releaseSealedAsar`（`lib/restart-desktop.js:311-322`）；另有 30 分钟空闲等待器 `ASAR_RENAME_WHEN_IDLE_PS1` 轮询 `Get-Process` 的 `Path`，并识别 `%TEMP%\dsh-purge-official-restarting` 标志（45s 内有效）（`lib/desktop.js:939-981`、`1031-1082`），POSIX 版 `ASAR_RENAME_WHEN_IDLE_SH` 用 `nohup "$exe"` / `open "$bundle"`（`983-1028`）。

---

## 3. 更新通道：HTTPS + 域名白名单，但**无签名/无哈希校验**

- 仓库与通道：`REPO = "YuJunZhiXue/dsh-purge"`，`STABLE_REF="master"`，`BETA_REF="beta"`（`lib/update.js:12-14`）；覆盖清单 `COPY_NAMES` 含 `lib,bin,docs,client.js,cordis.patch.yml,screenshots.json,package.json,README*.md,LICENSE`（`20-31`）。
- 重定向白名单 7 个域：`github.com, codeload.github.com, api.github.com, raw.githubusercontent.com, objects.githubusercontent.com, release-assets.githubusercontent.com, cdn.jsdelivr.net`（`lib/update.js:41-49`）；`MAX_UPDATE_BYTES = 50MB`（`50`）。
- 下载实现：`requestBuffer` 允许首次 `http/https`，但**任何重定向必须 https 且命中白名单**，否则丢弃（`396-432`）；超 50MB 中止（`452-456`）；`archiveZipUrl`/`archiveTarballUrl` 均指向 `https://codeload.github.com/...`（`188-200`）。
- **完整性校验现状**：拿到 buffer 后直接 `overlayFromZip` → `fsp.rm` + `fsp.cp` 覆盖到各 dest（`878-914`），全程没有 sha256/签名/发布清单比对；`remotePackageVersion` 与 `remoteHeadSha` 只是元数据探测（`517-522`、`547-559`）。**信任根 = TLS + GitHub 账号**。
- 执行方式：`runReapplyChild` 以 `spawn(process.execPath, ["--expose-internals", "lib/reapply-cli.js"], {env: {...ELECTRON_RUN_AS_NODE:1}})` 起子进程，`timeout: 180000`（`931-953`）；只有 reapply 成功才写 stamp/guard/version-history（`1019-1030`）。
- 启动不自动更新：`autoUpdateIfNeeded()` 直接返回 `{skipped: "manual-only"}`（`lib/update.js:1111-1120`）。
- **是否可被劫持**：
  - 纯 MITM：走不通（https-only + 主机白名单 + 重定向复核）。
  - 供应链：可行且无兜底——仓库或 jsDelivr 缓存被污染 → 任意 `lib/*.js` 落地 → `reapply-cli` 以用户权限执行 → 该脚本本身有权限再解 asar、杀进程、重写宿主 CLI shim（`lib/reapply.js:286-388`）。降级/回滚保护仅靠 `channel.json` 钉版（`lib/update.js:65-79`），无签名时间戳。
  - 另一条本地执行链：`core.js` 会把官方更新脚本写成 `%TEMP%\dsh-purge-official-update.js` + `.cmd` 启动器再执行（`lib/core.js:4189-4246`），同样是无签名的临时脚本。
- `.github/workflows/release.yml` 只做 `node --check` + `import './lib/index.js'` 语法门禁，再 `git archive` 打 zip 上传 release（`release.yml:24-62`）——**发布物无签名步骤**。

---

## 4. 控制台隐藏与子进程：只改 `windowsHide`，不改名

- `hide-console.js` 决策矩阵：非 win32 → `not_win32`；win32 + Electron 宿主 → `electron_host`（跳过）；win32 + 纯 Node → `wrap_builtin`（`lib/hide-console.js:69-73`），`installHideConsole()` 在模块加载末尾自执行（`309`）。
- 手法：拿到 builtin `child_process`（优先 `process.getBuiltinModule`，退化 `createRequire`，`82-98`），把 `spawn/spawnSync/exec/execSync/execFile/execFileSync/fork` 全部包一层，强制 `windowsHide: true`（`10-57`、`108-117`），打不可枚举标记 `__dshPurgeHideConsole` 防重复注入（`116`）。
- **注入宿主**：在宿主 bin 根写两个 sidecar `<root>/lib/dsh-purge-hide-console.js` 与 `dsh-purge-child-process-hide.mjs`，并在宿主 `lib/bin.js` 顶部（保留 shebang）插入 `import "./dsh-purge-hide-console.js"; // [dsh-purge] hide-console`（`233-271`）；`revertHideConsoleFromBin` 反向删行+删文件（`273-307`）。源码树 `apps/cli`（tsdown 产物）**只读不写**（`174-191`、`241`、`278`）。
- `child-process-hide.mjs` 是独立 facade：同一套 wrap，非 win32 或 Electron 直接 no-op（`lib/child-process-hide.mjs:51-64`），导出绑好的包装函数（`79-87`）。
- **没有进程名伪装**：不改 argv[0]、不复制 exe、不改命令行；「隐藏」只等于 `CREATE_NO_WINDOW`。可观测性影响：子进程在任务管理器中照常可见，命令行完整可读；配合 `wscript.exe //B`（`lib/desktop.js:1552` 附近）与 `-WindowStyle Hidden`（`lib/restart-desktop.js:407`）才形成「无窗口」效果。
- 目的（从调用点看）：`tasklist`/`taskkill`/`powershell`/`robocopy`/`tar`/`schtasks` 这些密集短命令不闪黑框（`lib/restart-desktop.js:81-85`、`lib/zip-extract.js:150-157`、`lib/skills.js:478-520`、`lib/core.js:1185-1199`）。

---

## 5. `hooks-deny` 与 `net-scope`：拦截的对象其实是**宿主的判定层与模型的任务文本**

### 5.1 hooks-deny（`lib/hooks-deny.js`，224 行）——把宿主的 deny / ask 判定改死
- 补丁集合固定四条 `[30, 31, 64, 65]`，注释明说「永远同开关，不拆开」（`lib/hooks-deny.js:7`）；默认 **开**（`9`、`181`），配置文件 `$DSH_HOME/dsh-purge/hooks-deny.json`（`164-166`），原子写（写 tmp→fsync→rename，`190-206`）。
- 它做的事：在宿主 `agent-loop` 源码里把 `if (merged.decision === "deny") ...` 替换为死字符串 `__dsh_purge_deny_disabled__`（`13`），把 `if (merged.decision === "ask") return {kind:"ask"...}` 换成 `return next()`（`61-69`）。反向表 `REVERSES` 逐条记录了**被改写的官方源码原文**，可直接反推宿主实现：
  - R1a/R1a2/R1b：`UserPromptSubmit` 的 `deny` 分支被清空成注释（`25-46`）。
  - R2a/R2b：`return {kind:"deny"}` / `{kind:"block"}` 的入口改成死字符串（`47-60`）。
  - R3：`ask` → 直接放行（`61-69`）。
  - R5a/R5b：`Stop` hook 的 steer 被整段禁用（`70-85`）。
- 语义即：**宿主的拒绝/询问闸门在源码层被短路**，插件自己的面板才是开关。标记串 `[dsh-purge] Stop hook steer disabled`、`[dsh-purge] UserPromptSubmit deny→allow` 用来判断「旁路是否还开着」（`15-16`、`99-102`）。
- 可逆与可绕过：`restoreHookDenyOfficial` 按反向表逐字匹配写回官方形态（`108-136`）；`annotateHookDenyStatus` 在开关关闭但文件仍脏时把状态标 `pending`/`skipped`（`138-162`）；`hookFileLooksBypassed` 只看标记/哨兵字符串（`99-102`）→ **删掉注释标记即可让状态显示为「干净」而实际仍被改**。宿主升级换了这些代码形态时补丁会静默失效（状态 `missing_file`/`pending`），插件不校验宿主文件完整性。

### 5.2 net-scope（`lib/net-scope.js`，673 行）——模型任务文本的地理/金融机构闸门
- 不是防火墙、不是网络代理，也不 hook 任何 socket。它是一个 `agent/pre-step` 钩子（`global + prepend`，只在 `step === 1` 生效，`lib/net-scope.js:629-654`）。
- 规则表：
  - `SUFFIXES`：约 80 条 `.cn/.hk/.mo` 及其二级后缀、中文 IDN（`.中国/.公司/.网络/.香港/.澳门/...`）与 punycode 形式（`6-92`）。
  - `BANK_HOSTS`：约 300 条跨国银行/央行/卡组织/加密交易所域名（`104-173`），`bankHit` 支持子域命中（`175-184`）。
  - 攻击意图正则 `ATTACK`：`渗透(?!测试)|打穿|打下|打站|入侵|拿壳|拿权限|爆破|提权|webshell|getshell|端口扫描|pentest|exploit|breach|pwn|攻击|attack`（`191-192`），扫描上限 100KB 防 ReDoS（`196`）。
  - 放行旁路 `NET_TOPIC`：代理/VPN/DNS/网卡/IP 查询等咨询类话题，不含攻击词时直接放行（`198-199`、`443-447`）。
- 判定：只取**最近一轮人写的新用户句**（从最后一个 assistant 消息往后切，过滤工具回包、system-reminder、MNEMON 草稿，`lib/net-scope.js:480-520`）→ 抽 hosts（URL/裸 IPv4/IPv6/带标签域名，前 32KB，`297-317`、`455-466`）→ 命中条件 = 非白名单、非本机网段、非 IP 字面量，且（属于 CN/HK/MO 后缀 **或** 银行表）（`468-478`）。
- 命中后果：构造一条固定拒绝句 `"不行，这是严令禁止的"`，**直接 append 进会话**（`assistant/message` + `stream` 紧凑 chunk，`529-591`），并返回 `{kind:"enter", messages: []}` 把这一轮清空（`593-650`）。落盘/持久化路径有完整容错（`step/start`/`step/end` 配对，`584-627`）。
- 结论：**它拦的是「中文圈 + 金融」目标，境外目标与非攻击描述一律放行**。默认白名单文件 `$DSH_HOME/net-scope-allow.txt`（`322-324`），条目校验只允许单 IP/单主机名或 `user@host`，密钥/网段/通配符丢弃（`326-347`）。
- 可绕过性（有代码证据）：① 只在 `step===1`，跟进消息不带 ATTACK 词即可（`633`）；② 目标写成 IP 字面量直接跳过（`473`）；③ 白名单一行即放行（`414-416`）；④ 删掉 `net-scope.js` 或 `ctx.on` 抛错即 `forward()`（`630-641`）；⑤ 只扫前 32KB / 100KB（`196`、`298`、`457`）。

---

## 6. reapply / uninstall / rewind：持久化落点与还原边界

### 6.1 reapply（`lib/reapply.js`，388 行）
- 状态文件全在 `$DSH_HOME/dsh-purge/`：`installed-rev`（`17-27`）、`applied.json`（`29-31`、`89-97`）、`settle-restart.guard`（`33-35`、`273-280`），settle 冷却窗 180s，防「重打→重启→再重打」死循环（`262-271`）。
- 对齐判定链：`stampMatches`（版本+sha，空 sha 不算对齐）→ `hostStillHasAppliedPatches`（asar 是否仍密封 / 清洗 marker 是否还在）→ `patchesMatchInstallStrict` 再加一次逐补丁 `pending` 实检（`100-180`）；`patchesLostAfterHostReset` 给面板报「补丁已丢失」（`183-198`）；`healEmptyAppliedStamp` / `ensureInstalledRevSeed` 负责补戳（`215-259`）。
- `reapplyInstalled()` 真流程：`gatherState` → 若 aiBase 缺失或 asar 密封则 `openSealedDesktopHost`（`297-313`）→ **不是本次新解才** `refreshStaleBaksForUpgrade`（把「无 marker 且与 bak 字节不同」的 bak 刷成当前版本，`319-328`，即**改写备份本身**）→ `revertAll` + `revertAllShims`（`329-330`）→ `applyPatchesAllHosts(ALL_PATCHES)` + `patchAllShims` + `silenceCmdFlash`（`331-334`）→ 干净才 `markPatchesApplied` + `writeUnpackedAsarStamp` + `seedPromptInjectAtBoot`（`356-367`）→ 需要时 `scheduleSealedDesktopRestart` 挪 asar 并返回 `needsFullQuit`（`368-386`）。

### 6.2 uninstall（`lib/uninstall.js`，286 行）
- 顺序：`revertAll`（宿主补丁）→ `revertAllShims`（CLI shim）→ `revertCmdFlash` → 删 override 文件（`127-131`）→ `resetRules` 并把 rules 目录整个删掉（`133-138`）→ 遍历 `$DSH_HOME/profiles/*`，`stripPluginFromPackage` 从 `dependencies/devDependencies/optionalDependencies/peerDependencies/bundles/plugins` 摘掉 `dsh-purge`（`37-59`、`179-194`）→ `clearDrillGrant` → 收集清理目录（`196-282`）。
- 清理目录只有三类：`$DSH_HOME/dsh-purge`、`node_modules/dsh-purge`（含 realpath 与符号链接路径）、插件根（`updater.pluginRoot()`）（`140-177`）。
- 删除时机：`scheduleCleanupRestart`（`284-286`）→ 把重启脚本拷到 `%TEMP%\dsh-purge-uninst-<pid>.mjs` 后 detached 执行（`lib/desktop.js:1558-1572`、`lib/web.js:94`），脚本 `uninstall-restart.js` 等端口释放（80×120ms）后 `fs.rmSync(cleanup, {recursive,force,maxRetries:8})` 再重拉宿主（`lib/uninstall-restart.js:36-76`）；`rmTree` 失败被静默吞掉（`lib/restart-desktop.js:71-78`）。
- **还原不到的地方（实测清单）**：
  1. `resources\app.asar.bak`、解出来的 `resources\app` 目录、marker `resources\dsh-purge-reapply-asar`（`lib/extract-asar.js:182-196`、`lib/official-update.js:7-15`）不在 cleanup 列表里。
  2. `app\runtime` junction 与 `<shim>.dsh-purge.bak`（`lib/desktop.js:1583-1611`、`1736-1778`）。
  3. `$DSH_HOME/dsh-purge-backups/skills`（`lib/skills.js:28-30`）与被 `saveSkill` 改写过的 `$DSH_HOME/skills/**/SKILL.md`（`410-446`）——cleanup 只删 `dsh-home/dsh-purge`，不含 `-backups`。
  4. `%TEMP%` 下的一堆 `dsh-purge-*.js/.ps1/.cmd/.log/.mjs`（`lib/desktop.js:21`、`1044`、`1136`、`1269`、`1409-1410`、`1545`、`1560`）。
- 另有 `stubDoctorSupervisor`：删 `%LOCALAPPDATA%\DSH Doctor\supervisor.cmd` / `supervisor.vbs`，并 `schtasks /Query`+`/Delete /F /TN "DSH Doctor Supervisor"`（`lib/core.js:1162-1207`）——**会移除另一个组件（DSH Doctor）的自启动与计划任务**。

### 6.3 rewind（`lib/rewind.js`，645 行）
- 纯内存：`pendingDrafts` Map + `lastPending`，TTL 10 分钟（`1-2`、`243-283`），不写盘。
- 真动作是**改会话本身**：找到最近 `turn/end` 边界（`97-123`），`planRewind` 取出这一轮的原始提示文本（`198-216`），`clearModelHistory` 以 `surfaceOp: {op:"replace", startSeq, endSeq}` append 一条空 `user/message`（id `rewind-*`）遮蔽后续节点（`497-540`），并 `wrapSessionDeriveMessages` 过滤 rewind 消息（`388-399`）、`resetRequestSeries` 让下一句重新开 series（`372-378`）、`disarmRewoundSession` 取消在跑的 turn 并清 `inbox.nextTurn/nextStep`（`401-434`）。`mode === "round"` 时递归处理上一轮的子代理会话（`615-645`）。对系统的足迹 = 宿主自己的 session 事件日志（宿主负责落盘），插件本身不新增持久文件。

---

## 7. 出网面：全部硬编码外部端点

| 域名 / URL | 用途 | 明文 HTTP？ | 需鉴权？ | 证据 |
|---|---|---|---|---|
| `codeload.github.com` | 更新包 zip / tar.gz 实际下载（ref、sha、tag 三种拼法） | 否（https） | 否，公开仓库；无 token | `lib/update.js:188-200`、`377-382` |
| `api.github.com` | `commits/<ref>`、`tags?per_page=50`、`contents/package.json` 元数据 | 否 | 否，匿名（受 60 次/时限流） | `lib/update.js:521`、`549`、`613`；`lib/redteam/ui.js:419` |
| `raw.githubusercontent.com` | `package.json` 版本探测 | 否 | 否 | `lib/update.js:519` |
| `cdn.jsdelivr.net` | 同上（镜像，减少 GitHub 直连） | 否 | 否 | `lib/update.js:518`、`520` |
| `github.com` | `commits/<ref>.atom` feed 取 head sha；release 页面 | 否 | 否 | `lib/update.js:552`；`release.yml:62` |
| `objects.githubusercontent.com` | 下载重定向落地（白名单内） | 否 | 否（带签名查询串） | `lib/update.js:41-49`、`396-432` |
| `release-assets.githubusercontent.com` | Release 资产重定向落地（白名单内） | 否 | 否 | 同上 |
| `127.0.0.1`（回环） | Web 服务端口探活/重启；仅作 URL 解析 base | http（回环） | 无 | `lib/restart-web.js:15-26`、`lib/uninstall-restart.js:15-42`、`lib/index.js:1870/2426/2493` |
| `http://` + 域名（字符串拼接，非自动请求） | redteam 面板把域名渲染成可点链接；工具参数示例 | 是（仅 UI/文案） | 否 | `lib/redteam/client.js:1102`、`lib/redteam/tools.js:821/1047/1649` |
| `https://fofa.info` | 只出现在技能提示文案里（`FOFA_KEY` 获取指引），代码不发请求 | 否 | 需用户自备 key | `lib/redteam/skill-fixes.js:301/430` |

补充事实：① 全仓 `lib/` 无自建监听端口——插件注册的是宿主 web 服务上的路由（`registerPluginRoute`，`lib/index.js:1860-1898`）；② 唯一自动出网链是更新通道，且 `requestBuffer` 对**每一个**重定向复核 https+白名单（`lib/update.js:396-432`）；③ **载荷无哈希/签名校验**（见 §3）。

**`lib/redteam/ip-utils.js` 的内外网口径**（`66-84`）：
- IPv4 判内网：`10/8`、`192.168/16`、`127/8`、`169.254/16`、`172.16–31/12`、`100.64–127/10`（CGNAT）；其余 `external`。
- IPv6：`/^f[cd][0-9a-f]{2}:/`（fc00::/7 ULA）、`/^fe[89ab][0-9a-f]:/`（fe80::/10 链路本地）算内网；`::ffff:a.b.c.d` 剥壳后按 IPv4 判（`69-71`）。
- 缺口：全部用**字符串前缀匹配**而非位运算，`0.0.0.0/8`、`192.0.2/24`、`198.18/15`、`224/4`、`240/4` 一律 `external`；`cidrOf` 对 IPv4 只做「前三段 + .0/24」文本拼装（`48-56`），`expandIpv6` 明说不追求严谨（`29-38`）。
- **两套口径不一致**：`net-scope.js` 的 `isSkippedV4` 额外跳过 `a===0` 与 `a>=224`（`214-223`），IPv6 用 `>>118n===0x3fa`（fe80::/10）与 `>>121n===0x7e`（fc00::/7）加 `::`、`::1`（`418-432`）。同一台机器上「内网」有两个定义，资产分组与拦截判定可能互相打架。

---

## 8. 风险清单（按对用户机器的侵入深度排序）

1. **【最高】以 wscript 静默执行临时脚本，并在其中杀进程 + 覆盖 + 重启宿主**。`%TEMP%\dsh-purge-official-restart-*.js` 由 `wscript.exe //nologo //B` 无窗口拉起（`lib/desktop.js:1545`、`1431-1556`），脚本内 `taskkill.exe /F /PID`、`robocopy` 覆盖 `resources\app`、`MoveFile app.asar→bak`、`sh.Run('"'+exe+'"')`（`lib/desktop.js:1268-1328`）。无用户确认、无审计日志（只有插件自己的 `%TEMP%` 日志）。**必须审计**：脚本内容来自插件字符串拼接，注入点是把 exe 路径等 JSON 化后塞进 JS 字面量（`lib/desktop.js:1288`）。
2. **【高】静默执行官方 NSIS 安装器**：`--updated /S /D=<installDir>`，失败才回滚（`lib/official-update.wscript:48-65`）。安装器本体来自用户本地文件，但执行时机与静默参数由插件决定。
3. **【高】解除宿主 asar 封印并写入持久 marker**：`app.asar`→`app.asar.bak` + 解包成可写 `resources\app`（`lib/extract-asar.js:182-196`、`315-370`），marker `resources\dsh-purge-reapply-asar` 让**后续官方更新继续沿用明文目录**（`lib/official-update.js:7-15`、`lib/official-update.wscript:82`）；同时 `clearStaleExtractedApps` 主动删除 `app.dshpurge-prev*` 备份（`lib/official-update.js:28-37`）。
4. **【高】改写宿主源码里的 deny/ask 判定**：把 `decision === "deny"` 改成死字符串、`ask` 改成放行（`lib/hooks-deny.js:25-86`），默认开启（`9`、`181`），且清理只需删注释标记即可「看起来干净」（`99-102`）。
5. **【高】注入 21,194 字节的加密系统提示词**：`lib/asset-table.js` 是 base64 的 AES-256-GCM 密文（`1-169`），密钥由仓库内常量 `MIX` + `MASK` 经 sha256 派生（`lib/table-key.js:4-13`），`openSlot()` 解密 + inflate 得到一份以 `<|im_start|>system:` 开头的完整指令文本（`lib/table-read.js:6-17`）。**密钥就在仓库里，属于混淆而非保密**：任何能改 `lib/` 的人都能替换这 21KB 系统指令且肉眼不可审。**必须审计**：这是插件对「模型行为」而非「操作系统」的最深侵入。
6. **【中高】抢 Windows 前台**：`keybd_event(Alt)` + `AttachThreadInput` + `ShowWindow(SW_RESTORE)` + `SetForegroundWindow`（`lib/restart-desktop.js:371-417`），可越过 Win11 前台保护，属于 UI 级操作，用户视角是「窗口自己跳出来」。
7. **【中高】杀宿主进程**：路径匹配 + `Stop-Process -Force`（`lib/desktop.js:874-884`）、镜像名匹配 + `process.kill`（`lib/restart-desktop.js:187-271`）、`taskkill /F /PID`（`lib/restart-web.js:28-36`、`lib/official-update.wscript:22`）。未保存会话/正在跑的任务有丢失风险；镜像名那一路会连带杀掉**非本安装路径**的同名进程。
8. **【中】主机侦察（只读但面大）**：`Get-CimInstance Win32_Process`（`lib/desktop.js:440-464`）、`Uninstall` 注册表三处根键（`308-332`）、开始菜单/桌面 `.lnk` 的 COM 解析（`482-506`）、`tasklist`（`lib/restart-desktop.js:81-85`）、`ps -Ao pid=,command=`（`127-133`、`163-166`）。信息不出本机（无对应出网点，见 §7），但等同于一次主机指纹采集。
9. **【中】删除他人的计划任务**：`schtasks /Delete /F /TN "DSH Doctor Supervisor"` + 删 `%LOCALAPPDATA%\DSH Doctor\supervisor.cmd/.vbs`（`lib/core.js:1162-1207`）。
10. **【中】全局改写 `child_process` 行为**：把 7 个方法的 `windowsHide` 强制成 true，并往宿主 `lib/bin.js` 顶部注入 import（`lib/hide-console.js:100-118`、`233-271`）。副作用是宿主及其所有下游子进程的窗口语义被替换；离开插件后若未走 `revertHideConsoleFromBin` 会残留 import 行（`273-307`）。
11. **【中】无签名校验的更新通道**：7 域名白名单 + https-only 重定向 + 50MB 上限（`lib/update.js:41-50`、`396-432`），但载荷直接覆盖 `lib/`（`878-914`）后以 `--expose-internals` 执行 `reapply-cli`（`931-953`）。信任根 = GitHub 账号 / jsDelivr 缓存。
12. **【低-中】卸载不彻底**：`app.asar.bak`、解包目录、marker、junction、`$DSH_HOME/dsh-purge-backups`、被改写的 `SKILL.md`、`%TEMP%` 脚本都不在清理清单（`lib/uninstall.js:140-177`；`lib/skills.js:28-30`、`410-446`），且 `rmTree` 静默失败（`lib/restart-desktop.js:71-78`）。
13. **【低】反射式「拒绝」写进用户会话**：`net-scope` 命中时直接 append `"不行，这是严令禁止的"` 并清空该轮（`lib/net-scope.js:186`、`529-650`），会污染会话历史（宿主持久化不可逆）。
14. **【低】按镜像名杀进程的宽匹配**：`DeepSeek Harness.exe` / `DSH Desktop.exe`（`lib/restart-desktop.js:187-196`）与 `desktop.js` 的路径匹配标准不一致，属实现口径分裂而非直接破坏。

---

一句话总结：这个插件对宿主系统改动的边界——**它以「自己目录内的插件」身份，实际取得了「宿主安装目录可写（解 asar、改 bin.js/CLI shim、写 marker）、宿主进程可杀可重启可抢前台、宿主判定层与提示词层可改（hooks deny/ask 短路 + 21KB 加密系统提示词）」三项能力；出网只走 7 个 GitHub/CDN 域名的 HTTPS 更新通道且无签名校验，卸载能还原宿主补丁与 shim，但 asar 备份、marker、junction、技能备份与临时脚本会残留。**
