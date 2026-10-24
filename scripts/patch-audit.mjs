#!/usr/bin/env node
/**
 * 补丁命中矩阵（P2-12① 的可执行版）。
 *
 * 把本仓库的 82 条补丁对**指定宿主**做一次只读体检（patchStatus 只读不写），
 * 输出每一条的 matched / unmatched / missing 状态 —— 宿主升级后"哪条补丁失配了"
 * 从猜测变成一张表。
 *
 *   node scripts/patch-audit.mjs [宿主 app 目录] [--json <输出文件>]
 *
 * 不传宿主路径时用插件自己的 findAiBase()（和运行时同一套定位逻辑）。
 * 注意：宿主若已被**别的版本**的 dsh-purge 打过补丁，本表反映的是
 * "本仓库的 pattern 对那台宿主还能不能命中"，这正是版本漂移时最想知道的事。
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as core from '../lib/core.js'

const jsonIdx = process.argv.indexOf('--json')
const jsonOut = jsonIdx >= 0 ? process.argv[jsonIdx + 1] : null
const positional = process.argv.slice(2).filter((a, i) => (jsonIdx >= 0 && i === jsonIdx - 2 ? false : a !== '--json' && a !== jsonOut))
const aiBase = positional[0] ? resolve(positional[0]) : core.findAiBase()

if (!aiBase) {
  console.error('patch-audit: 没定位到宿主目录。用法: node scripts/patch-audit.mjs [宿主 app 目录]')
  process.exit(1)
}

const status = await core.patchStatus(aiBase)
const rows = core.ALL_PATCHES.map((p) => ({
  id: p.id,
  name: p.name,
  layer: p.layer || '',
  applies: core.patchAppliesHere(p),
  status: status[p.id] || 'unknown',
  optional: p.optional === true,
  strict: p.strictFiles === true,
}))

const byStatus = new Map()
for (const r of rows) {
  const key = r.applies ? r.status : 'na(surface)'
  if (!byStatus.has(key)) byStatus.set(key, [])
  byStatus.get(key).push(r)
}

const ORDER = ['applied', 'pending', 'unmatched', 'skipped', 'missing_file', 'na', 'na(surface)', 'unknown']
console.log(`patch-audit @ ${aiBase}`)
console.log(`补丁总数 ${rows.length}，状态分布：`)
for (const key of ORDER) {
  const list = byStatus.get(key)
  if (!list) continue
  console.log(`  ${key.padEnd(14)} ${String(list.length).padStart(3)}`)
}
const interesting = rows.filter((r) => r.applies && !['applied', 'na'].includes(r.status))
if (interesting.length > 0) {
  console.log('\n非 applied 明细（升级后重点核对这些）：')
  for (const r of interesting) {
    const patch = core.ALL_PATCHES.find((x) => x.id === r.id)
    const keys = Array.isArray(patch?.file) ? patch.file.join(', ') : String(patch?.file || '?')
    console.log(`  [${String(r.status).padEnd(14)}] #${String(r.id).padEnd(2)} ${r.name}${r.strict ? ' (strict)' : ''}${r.optional ? ' (optional)' : ''} → 目标键: ${keys}`)
  }
  console.log('\n注意：missing_file 可能是审计环境的解析差异（如 desktop-shell / liangshen 的目标文件')
  console.log('要在宿主进程里才解析得到），以 dsh 内 `purge_status` 或 apply 后的 patch-report.json 为准。')
} else {
  console.log('\n所有适用补丁均 applied ✓')
}

if (jsonOut) {
  writeFileSync(resolve(jsonOut), `${JSON.stringify({ aiBase, at: new Date().toISOString(), rows }, null, 2)}\n`, 'utf8')
  console.log(`\nJSON → ${resolve(jsonOut)}`)
}
