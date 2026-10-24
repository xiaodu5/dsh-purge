/**
 * 把 lib/redteam/client.js 抽成可嵌入的工厂片段，
 * 写进 client.js 里的 DSH_PURGE_DRILL 标记之间。
 *
 * 用法：
 *   node scripts/build-client.mjs            # 有漂移就拒绝写，只报告差异
 *   node scripts/build-client.mjs --force    # 确认"以 lib/redteam/client.js 为准"，强制覆盖
 *
 * 为什么要这道闸：
 *   client.js 是**手写源码 + 构建产物**混在一个文件里的（中间 4k 行是内嵌的演练台）。
 *   构建产物里的修补可能只存在于 client.js（历史上就领先过源文件 33 行，
 *   也就是 `api()` 的 non-json 兜底），所以无脑重跑本脚本会**静默回退**这些改动。
 *   现在默认只报告、不改盘；确认后加 --force 才写。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const drillSrc = join(root, "lib", "redteam", "client.js");
const clientPath = join(root, "client.js");

const BEGIN = "/* __DSH_PURGE_DRILL_BEGIN__ */";
const END = "/* __DSH_PURGE_DRILL_END__ */";
const FORCE = process.argv.includes("--force") || process.env.DSH_PURGE_BUILD_FORCE === "1";

const sha12 = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12);
const lf = (text) => text.replace(/\r\n/g, "\n");

/* ---------------- 1. 从源文件切出片段 ---------------- */

let raw = readFileSync(drillSrc, "utf8").replace(/\r\n/g, "\n");
const startMark = "factory: (require) => {";
const start = raw.indexOf(startMark);
if (start < 0) throw new Error("cannot find ModuleLoader factory in drill client");
const endMark = "\n    return module.exports\n  },\n})";
const end = raw.lastIndexOf(endMark);
if (end < 0) throw new Error("cannot find factory end in drill client");
let body = raw.slice(start + startMark.length, end);

// 去掉末尾 exports（return 已在 endMark 外）
body = body
	.replace(/\n\s*exports\.apply\s*=\s*apply\s*\n/, "\n")
	.replace(/\n\s*exports\.inject\s*=\s*inject\s*\n/, "\n");

// 替换 apply(ctx)：不再自己注册槽位，只导出 Panel / CSS / 状态
const applyAt = body.lastIndexOf("function apply(ctx) {");
if (applyAt < 0) throw new Error("apply(ctx) not found in drill client");
// apply() 本体没有嵌套函数花括号冲突到 CSS（CSS 在前面），用括号深度即可
let d = 0;
let j = body.indexOf("{", applyAt);
for (; j < body.length; j += 1) {
	const ch = body[j];
	if (ch === "{") d += 1;
	else if (ch === "}") {
		d -= 1;
		if (d === 0) {
			j += 1;
			break;
		}
	}
}
const applyParts = `function applyDrillParts() {
      return { CSS: CSS, Panel: Panel, setUI: setUI, useUI: useUI, isFullWindow: isFullWindow, setDockWidth: setDockWidth };
    }
`;
body = body.slice(0, applyAt) + applyParts + body.slice(j);

const fragment = `${BEGIN}
		// 内嵌演练台（源码在 lib/redteam，已并进本插件）
		const __dshPurgeDrill = (() => {
			var module = { exports: {} };
			var exports = module.exports;
${body}
			return applyDrillParts();
		})();
${END}`;

/* ---------------- 2. 和 client.js 里的现存片段比对 ---------------- */

let client = readFileSync(clientPath, "utf8");
if (!client.includes(BEGIN) || !client.includes(END)) {
	throw new Error("client.js missing drill markers; run patch-client-dock.mjs first");
}
const beginAt = client.indexOf(BEGIN);
const endAt = client.indexOf(END);
if (beginAt < 0 || endAt < 0 || endAt < beginAt) throw new Error("drill markers out of order");

const existingInner = lf(client.slice(beginAt + BEGIN.length, endAt));
const nextInner = lf(fragment.slice(BEGIN.length, fragment.length - END.length));
const identical = existingInner === nextInner;

if (!identical) {
	const a = existingInner.split("\n");
	const b = nextInner.split("\n");
	let firstDiff = 0;
	while (firstDiff < a.length && firstDiff < b.length && a[firstDiff] === b[firstDiff]) firstDiff += 1;
	console.log("[build-client] 检测到漂移（client.js 里的内嵌片段 ≠ lib/redteam/client.js 的构建结果）");
	console.log(`  现存片段 sha=${sha12(existingInner)} 行数=${a.length}`);
	console.log(`  本次产物 sha=${sha12(nextInner)} 行数=${b.length}`);
	console.log(`  首个差异在第 ${firstDiff + 1} 行：`);
	console.log(`    client.js  : ${JSON.stringify(a[firstDiff] ?? "<无此行>")}`);
	console.log(`    build 产物 : ${JSON.stringify(b[firstDiff] ?? "<无此行>")}`);
	if (!FORCE) {
		console.error("[build-client] 拒绝写盘。内嵌片段可能含有只存在于 client.js 的修补，");
		console.error("               重跑会静默回退它们。确认以 lib/redteam/client.js 为准后：");
		console.error("               node scripts/build-client.mjs --force");
		process.exitCode = 1;
		process.exit();
	}
	console.log("[build-client] --force：按源文件覆盖现存片段");
}

/* ---------------- 3. 写回并自校验 ---------------- */

/* client.js 是 CRLF 文件：片段照抄文件的换行风格，别把内嵌区写成混合 EOL。 */
const useCRLF = /\r\n/.test(client);
const writable = useCRLF ? fragment.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n") : fragment;
client = client.slice(0, beginAt) + writable + client.slice(endAt + END.length);
writeFileSync(clientPath, client);

const after = readFileSync(clientPath, "utf8");
const afterBegin = after.indexOf(BEGIN);
const afterEnd = after.indexOf(END);
const written = lf(after.slice(afterBegin + BEGIN.length, afterEnd));
if (written !== nextInner) throw new Error("self-check failed: written fragment does not match build output");
console.log(
	`embedded drill client into client.js (${Buffer.byteLength(fragment)} bytes fragment, sha=${sha12(nextInner)}` +
	`${identical ? ", 无漂移" : ", 已覆盖"})`,
);
