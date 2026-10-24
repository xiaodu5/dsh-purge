#!/usr/bin/env node
/**
 * 优化自检：把 P0 + P1 修复钉成可执行断言。
 *
 *   node scripts/selfcheck.mjs
 *
 * 覆盖：
 *   1. param-schema 归一化（宿主 additionalProperties 契约）
 *   2. tools.js 里的值 schema 不得再漏写 additionalProperties
 *   3. migrate() 传参后真的回填 attack_step.stage_code / asset.scope（1.1.71 里是死代码）
 *   4. migrate() 不传参时不抛 ReferenceError（旧调用方兼容）
 *   5. build-client.mjs 的漂移闸（默认不写盘）
 *   6. stubDoctorSupervisor 的 opt-out 开关与审计留痕
 *   7. 加密槽 openSlotDetailed：成功 / 分类失败 / openSlot 兼容（P1-6）
 *   8. apply 报告落盘 persistPatchReport / readPatchReport（P1-5）
 *   9. report-replay 纯函数回归（P2-12③，含 Host 头真 bug 的锁）
 *  10. 更新通道哈希钉死与 SHA256SUMS（P1-7，静态）
 */
import assert from 'node:assert/strict'
import { readFileSync, statSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, createCipheriv } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import { migrate } from '../lib/redteam/schema.js'
import { withExplicitAdditionalProperties } from '../lib/redteam/param-schema.js'
import * as core from '../lib/core.js'
import { openSlotDetailed } from '../lib/table-read.js'
import { mixKey } from '../lib/table-key.js'
import { IV, MASK, SLOT, TAG } from '../lib/asset-table.js'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const pass = []
const ok = (name) => pass.push(name)

/* ---------------------------------------------------------------- 1. 归一化 */

{
  const spec = {
    name: 'demo',
    parameters: {
      engagement: { type: 'string' },
      /* 就是这条把 1.1.73 的 56 个工具带下去的：参数名叫 parameters 的自由对象 */
      parameters: { type: 'object', description: '自由 JSON' },
      ports: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, properties: { port: { type: 'number' } } },
      },
      evidence: { type: 'array', items: { type: 'object', properties: { shot: { type: 'object' } } } },
      either: { oneOf: [{ type: 'object' }, { type: 'string' }] },
    },
  }
  const out = withExplicitAdditionalProperties(spec)
  assert.equal(out.parameters.parameters.additionalProperties, true, '自由对象应补 true')
  assert.equal(out.parameters.ports.items.additionalProperties, false, '显式 false 必须保留')
  assert.equal(out.parameters.evidence.items.additionalProperties, true, 'items 里的 object 也要补')
  assert.equal(out.parameters.evidence.items.properties.shot.additionalProperties, true, 'properties 深层也要补')
  assert.equal(out.parameters.either.oneOf[0].additionalProperties, true, 'oneOf 分支也要补')
  assert.equal('additionalProperties' in spec.parameters.parameters, false, '不得改动调用方对象')
  assert.deepEqual(
    withExplicitAdditionalProperties(out).parameters.evidence,
    out.parameters.evidence,
    '归一化必须幂等',
  )
  assert.equal(out.name, 'demo', '其余字段原样保留')
  ok('param-schema 归一化（补缺省 / 保留显式 / 幂等 / 不改入参）')
}

/* ------------------------------------------------- 2. tools.js 静态不变量 */

{
  const lines = read('lib/redteam/tools.js').split('\n')
  const offenders = []
  lines.forEach((line, index) => {
    if (!/type:\s*'object'/.test(line)) return
    const window = `${line} ${lines[index + 1] ?? ''}`
    if (!/additionalProperties/.test(window)) offenders.push(index + 1)
  })
  assert.deepEqual(
    offenders,
    [],
    `lib/redteam/tools.js 这些行的 object schema 漏了 additionalProperties：${offenders.join(', ')}`,
  )
  ok(`tools.js 的 object schema 全部显式（扫描 ${lines.length} 行）`)
}

/* ------------------------------------------------------- 3+4. migrate 行为 */

const LEGACY_SCHEMA = [
  'CREATE TABLE attack_step (id INTEGER PRIMARY KEY, stage TEXT)',
  'CREATE TABLE asset (id INTEGER PRIMARY KEY, ip TEXT, scope TEXT)',
]

{
  const db = new DatabaseSync(':memory:')
  for (const ddl of LEGACY_SCHEMA) db.exec(ddl)
  db.exec("INSERT INTO attack_step (stage) VALUES ('踩点'), ('边界突破'), ('recon')")
  db.exec("INSERT INTO asset (ip) VALUES ('10.1.2.3'), ('8.8.8.8')")

  /* 真实调用点（store-core.js 的 db()）传的就是这两个值 */
  migrate(db, {
    legacyStageMap: { '踩点': 'recon', '边界突破': 'boundary' },
    scopeSql: "CASE WHEN ip LIKE '10.%' THEN 'internal' ELSE 'external' END",
  })

  const stages = Object.fromEntries(
    db.prepare('SELECT stage, stage_code FROM attack_step').all().map((r) => [r.stage, r.stage_code]),
  )
  assert.equal(stages['踩点'], 'recon', '历史 stage 必须回填成阶段码')
  assert.equal(stages['边界突破'], 'boundary')
  assert.equal(stages.recon, null, '映射表里没有的保持空，不瞎猜')

  const scopes = Object.fromEntries(
    db.prepare('SELECT ip, scope FROM asset').all().map((r) => [r.ip, r.scope]),
  )
  assert.equal(scopes['10.1.2.3'], 'internal', 'scope 回填必须真的执行')
  assert.equal(scopes['8.8.8.8'], 'external')
  db.close()
  ok('migrate(db, {legacyStageMap, scopeSql}) 回填生效（1.1.71 里是 ReferenceError 死代码）')
}

{
  const db = new DatabaseSync(':memory:')
  for (const ddl of LEGACY_SCHEMA) db.exec(ddl)
  db.exec("INSERT INTO attack_step (stage) VALUES ('踩点')")
  /* 旧调用方：不传 options，必须安静跳过而不是把 ReferenceError 吞掉后又装作跑过 */
  assert.doesNotThrow(() => migrate(db), 'migrate(db) 不得抛错')
  const row = db.prepare('SELECT stage_code FROM attack_step').get()
  assert.equal(row.stage_code, null, '没给映射表就不该回填')
  db.close()
  ok('migrate(db) 无参兼容（不抛错、不乱填）')
}

/* ------------------------------------------------- schema/store 调用点绑定 */

{
  const schemaSrc = read('lib/redteam/schema.js')
  assert.equal(/Object\.entries\(LEGACY_STAGE_MAP\)/.test(schemaSrc), false, 'schema.js 不得再裸用 LEGACY_STAGE_MAP')
  assert.equal(/\(\$\{SCOPE_SQL\}\)/.test(schemaSrc), false, 'schema.js 不得再裸用 SCOPE_SQL')
  const storeSrc = read('lib/redteam/store-core.js')
  assert.match(
    storeSrc,
    /migrate\(handle, \{ legacyStageMap: LEGACY_STAGE_MAP, scopeSql: SCOPE_SQL \}\)/,
    'store-core.js 的 db() 必须把两个常量传进去',
  )
  ok('schema.js / store-core.js 的调用点已对齐')
}

/* ------------------------------------------------- 5. build-client 漂移闸 */

{
  const target = fileURLToPath(new URL('../client.js', import.meta.url))
  const before = createHash('sha256').update(readFileSync(target)).digest('hex')
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./build-client.mjs', import.meta.url))], {
    encoding: 'utf8',
  })
  const after = createHash('sha256').update(readFileSync(target)).digest('hex')
  const text = `${run.stdout || ''}${run.stderr || ''}`
  if (run.status === 0) {
    assert.match(text, /无漂移|已覆盖/, '退出码 0 必须是"无漂移"或显式 --force 覆盖')
  } else {
    assert.equal(run.status, 1, '漂移时退出码必须是 1')
    assert.match(text, /拒绝写盘/, '漂移时必须明确说明拒绝写盘')
    assert.equal(after, before, '拒绝写盘时 client.js 不得被改动')
  }
  assert.ok(statSync(target).size > 0)
  ok(`build-client 漂移闸（本次结果：${run.status === 0 ? '无漂移' : '检测到漂移并拒绝写盘'}）`)
}

/* --------------------------------------- 6. Doctor supervisor opt-out 门 */

{
  const src = read('lib/core.js')
  assert.match(src, /export function keepDoctorSupervisor\(env = process\.env\)/, '缺 opt-out 判定函数')
  assert.match(src, /if \(keepDoctorSupervisor\(\)\) \{/, 'stubDoctorSupervisor 必须先过开关')
  assert.match(src, /DSH_PURGE_KEEP_DOCTOR/, '开关名要能被搜到')
  assert.match(src, /auditDoctorStub\(out\)/, '真删了东西必须留审计')
  ok('stubDoctorSupervisor：opt-out 开关 + 审计留痕')
}

/* --------------------------------------- 7. 加密槽健康状态（P1-6） -------- */

{
  /* 真槽：本树内置的出厂默认必须能解开（这是全插件最核心的资产） */
  const good = openSlotDetailed()
  assert.equal(good.ok, true, `内置加密槽应能解开（reason=${good.reason}）`)
  assert.ok(good.text.length > 10000, `槽正文应有实质内容（${good.text.length} 字符）`)
  assert.equal(good.reason, null)

  /* 篡改认证标签 → 必须归类为 decrypt，且正文为空 */
  const badTag = openSlotDetailed({ IV, MASK, SLOT, TAG: Buffer.alloc(16).toString('base64') })
  assert.equal(badTag.ok, false)
  assert.equal(badTag.reason, 'decrypt', `TAG 篡改应归为 decrypt，实际 ${badTag.reason}`)
  assert.equal(badTag.text, '')

  /* 空载荷 → empty：用同一把钥匙封一个空正文，解得开但没内容 */
  const cipher = createCipheriv('aes-256-gcm', mixKey(MASK), Buffer.from(IV, 'base64'))
  const emptyCipher = Buffer.concat([cipher.update(deflateSync(Buffer.alloc(0))), cipher.final()])
  const emptySlot = openSlotDetailed({ IV, MASK, SLOT: emptyCipher.toString('base64'), TAG: cipher.getAuthTag().toString('base64') })
  assert.equal(emptySlot.ok, false)
  assert.equal(emptySlot.reason, 'empty', `合法密文 + 空正文应归为 empty，实际 ${emptySlot.reason}`)

  /* core 的 slotStatus/defaultOverrideText 走同一份缓存 */
  const st = core.slotStatus()
  assert.equal(st.ok, true)
  assert.ok(st.chars > 10000)
  assert.equal(core.defaultOverrideText(), good.text, 'defaultOverrideText 必须等价于槽正文')
  ok(`加密槽健康状态（正文 ${good.text.length} 字符；篡改 TAG → decrypt）`)
}

/* --------------------------------------- 8. apply 报告落盘（P1-5） -------- */

{
  const home = mkdtempSync(join(tmpdir(), 'dsh-purge-selfcheck-'))
  const multi = {
    hosts: [
      {
        aiBase: 'C:/fake/host/a',
        report: [
          { patch_id: 1, name: 'A', status: 'applied' },
          { patch_id: 2, name: 'B', status: 'already' },
          { patch_id: 3, name: 'C', status: 'pattern_not_found' },
          { patch_id: 4, name: 'D', status: 'missing_file' },
          { patch_id: 5, name: 'E', status: 'na' },
          { patch_id: 6, name: 'F', status: 'write_error:EBUSY' },
        ],
      },
    ],
  }
  const doc = await core.persistPatchReport(home, multi)
  assert.equal(doc.failed_total, 3, 'pattern_not_found + missing_file + error 都算未命中')
  assert.equal(doc.hosts[0].applied, 1)
  assert.equal(doc.hosts[0].pattern_not_found[0].name, 'C')
  assert.equal(doc.hosts[0].errors[0].status, 'write_error:EBUSY')
  assert.ok(existsSync(core.patchReportPath(home)), 'patch-report.json 必须落盘')
  const back = core.readPatchReport(home)
  assert.equal(back.failed_total, 3)
  assert.equal(core.readPatchReport(join(home, 'nope')), null, '读不到就返回 null，不抛')
  assert.equal(await core.persistPatchReport('', multi), null, '没有 dshHome 时安静跳过')
  ok('persistPatchReport / readPatchReport 落盘闭环')
}

/* --------------------------------------- 9. report-replay 回归（P2-12③）-- */

{
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./test-report-replay.mjs', import.meta.url))], { encoding: 'utf8' })
  assert.equal(run.status, 0, `report-replay 回归必须全绿：\n${run.stdout || ''}${run.stderr || ''}`)
  assert.match(run.stdout, /test-report-replay OK/)
  ok(`report-replay 纯函数回归（${(run.stdout.match(/✓/g) || []).length} 例，含 Host 头锁）`)
}

/* --------------------------------------- 10. 更新通道（P1-7，静态）-------- */

{
  const updateSrc = read('lib/update.js')
  assert.match(updateSrc, /DSH_PURGE_EXPECT_SHA/, '必须支持 DSH_PURGE_EXPECT_SHA 哈希钉死')
  assert.match(updateSrc, /createHash\("sha256"\)/, '下载后必须先算 sha256')
  assert.match(updateSrc, /recordDownload\(\{ ref/, '下载必须留痕 last-download.json')
  assert.match(updateSrc, /assertExpectedSha\(sha256, url\)/, '解压前必须过哈希闸')
  const yml = read('.github/workflows/release.yml')
  assert.match(yml, /SHA256SUMS\.txt/, 'release 必须产出 SHA256SUMS.txt')
  const coreSrc = read('lib/core.js')
  assert.match(coreSrc, /await persistPatchReport\(findDshHome\(\), \{ hosts \}\)/, 'applyPatchesAllHosts 必须落盘 apply 报告')
  assert.match(coreSrc, /slot: slotStatus\(\)/, 'gatherState 必须暴露加密槽状态')
  assert.match(coreSrc, /patch_report: readPatchReport\(dshHome\)/, 'gatherState 必须暴露上次 apply 报告')
  const indexSrc = read('lib/index.js')
  assert.match(indexSrc, /上次 apply 未命中/, 'purge_status 必须渲染未命中清单')
  ok('更新通道哈希钉死 + apply 报告接线（静态）')
}

console.log('selfcheck OK')
for (const line of pass) console.log(`  ✓ ${line}`)
