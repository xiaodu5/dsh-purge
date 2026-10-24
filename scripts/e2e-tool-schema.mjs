#!/usr/bin/env node
/**
 * 端到端校验：拿**真实宿主**的 defineTool 把 redteam 工具逐个注册一遍，
 * 证明参数 schema 全过宿主校验（不是靠"看着差不多"）。
 *
 *   cd "D:\Program Files\ai\dsh\DSH Desktop\resources\app"
 *   node "C:\...\dsh-purge优化\scripts\e2e-tool-schema.mjs" [tools.js 的路径]
 *
 * 为什么会成功：tools.js 的 loadDefineTool() 会从 `process.cwd()/package.json`
 * 解析 `@deepseek-ai/dsh-tools`，所以必须把 cwd 放在宿主 app 目录下再跑。
 * 失败时把宿主抛的 authorError 原样打出来 —— 例如 1.1.73 的
 * `parameters.parameters.additionalProperties must be explicitly true or false`。
 */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const target = resolve(process.argv[2] || new URL('../lib/redteam/tools.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

const registered = []
const fakeCtx = {
  redteam: {},
  tools: { register: (tool) => registered.push(tool) },
  effect: (fn) => { try { fn() } catch { /* ignore */ } },
  on: () => () => {},
  logger: { warn: () => {}, info: () => {}, debug: () => {} },
}

const mod = await import(pathToFileURL(target).href)
if (typeof mod.apply !== 'function') throw new Error(`${target}: no apply(ctx) export`)
try {
  mod.apply(fakeCtx)
} catch (error) {
  console.error(`FAIL ${target}`)
  console.error(`  ${error && error.message ? error.message : error}`)
  process.exitCode = 1
  process.exit()
}
const names = registered.map((tool) => tool && (tool.name || tool.toolName)).filter(Boolean)
console.log(`OK ${target}`)
console.log(`  registered ${registered.length} tools, ${new Set(names).size} unique names`)
if (registered.length === 0) {
  console.error('  注册数为 0，说明 apply() 没走到 register —— 检查 fake ctx 是否被新代码依赖')
  process.exitCode = 1
}
