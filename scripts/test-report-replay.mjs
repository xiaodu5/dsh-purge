#!/usr/bin/env node
/**
 * `lib/redteam/report-replay.js` 纯函数回归（P2-12③）。
 *
 * report-replay.js:16-26 自己记录过一次真实事故：IPv6 方括号写法被一条正则
 * 一起抓，host 解析成 `2001:db8:`、报文首行成了 `GET :8080/x HTTP/1.1`。
 * 这份测试把它和同族边界钉死 —— 这些函数是"报告里每条得分的复现入口"，
 * 坏一次就是验收人拿着错误报文去打别人的靶标。
 *
 *   node scripts/test-report-replay.mjs
 */
import assert from 'node:assert/strict'
import { parseTarget, commandKind, parseCurl, buildHttpRequest, buildCurlCommand, fillTemplate } from '../lib/redteam/report-replay.js'

let count = 0
const t = (name, fn) => { fn(); count += 1; console.log(`  ✓ ${name}`) }

/* ------------------------------------------------------------- parseTarget */

t('IPv6 + 端口（历史事故现场）：host 不是 "2001:db8:"，首行不是 "GET :8080/x"', () => {
  const r = parseTarget('http://[2001:db8::1]:8080/x')
  assert.equal(r.host, '2001:db8::1')
  assert.equal(r.port, 8080)
  assert.equal(r.path, '/x')
  assert.equal(r.ipv6, true)
  const msg = buildHttpRequest({ url: 'http://[2001:db8::1]:8080/x' })
  assert.equal(msg.split('\r\n')[0], 'GET /x HTTP/1.1')
  assert.equal(msg.split('\r\n')[1], 'Host: [2001:db8::1]:8080')
})

t('IPv6 默认端口：Host 头不带 :80（RFC 3986 方括号写法）', () => {
  const r = parseTarget('http://[::1]/')
  assert.equal(r.host, '::1')
  assert.equal(r.port, 80)
  const msg = buildHttpRequest({ url: 'http://[::1]/' })
  assert.equal(msg.split('\r\n')[1], 'Host: [::1]')
})

t('IPv6 无协议：[::1]:22 → host ::1, port 22, scheme null', () => {
  const r = parseTarget('[::1]:22')
  assert.equal(r.host, '::1')
  assert.equal(r.port, 22)
  assert.equal(r.scheme, null)
  assert.equal(r.ipv6, true)
})

t('IPv6 只有方括号没有端口 → port null', () => {
  const r = parseTarget('[2001:db8::1]')
  assert.equal(r.host, '2001:db8::1')
  assert.equal(r.port, null)
})

t('https 默认 443 / http 默认 80', () => {
  assert.equal(parseTarget('https://example.com').port, 443)
  assert.equal(parseTarget('http://example.com').port, 80)
})

t('host:port 无协议', () => {
  const r = parseTarget('10.0.0.5:6379')
  assert.equal(r.host, '10.0.0.5')
  assert.equal(r.port, 6379)
  assert.equal(r.scheme, null)
})

t('空串 / 乱形态不炸：返回 null 或只取头段', () => {
  assert.equal(parseTarget(''), null)
  assert.equal(parseTarget(null), null)
  const weird = parseTarget('foo bar/path')
  assert.ok(weird === null || typeof weird.host === 'string')
})

/* --------------------------------------------------------------- parseCurl */

t('完整 curl：方法/数据/头/cookie/开关全抽出', () => {
  const r = parseCurl("curl -i -s -k -L -X POST -H 'Content-Type: application/json' -H \"X-A: 1\" -d '{\"a\":1}' -b 'sid=1' 'http://1.2.3.4:8080/api'")
  assert.equal(r.method, 'POST')
  assert.equal(r.data, '{"a":1}')
  assert.deepEqual(r.headers, ['Content-Type: application/json', 'X-A: 1'])
  assert.equal(r.cookie, 'sid=1')
  assert.equal(r.insecure, true)
  assert.equal(r.followRedirect, true)
  assert.equal(r.url, 'http://1.2.3.4:8080/api')
})

t('curl 无 -X 且有 -d → POST；纯 URL → GET', () => {
  assert.equal(parseCurl("curl -d 'x=1' http://h/a").method, 'POST')
  assert.equal(parseCurl('curl http://h/a').method, 'GET')
})

t('非 curl / 无 URL → null（不猜）', () => {
  assert.equal(parseCurl('wget http://h/a'), null)
  assert.equal(parseCurl('curl'), null)
  assert.equal(parseCurl(''), null)
})

/* --------------------------------------------------------- buildHttpRequest */

t('合成报文：JSON 体自动 Content-Type + 正确 Content-Length（多字节按字节算）', () => {
  const msg = buildHttpRequest({ url: 'http://10.0.0.5:8080/api', method: 'POST', data: '{"k":"中文"}' })
  const lines = msg.split('\r\n')
  assert.equal(lines[0], 'POST /api HTTP/1.1')
  assert.ok(lines.includes('Content-Type: application/json'))
  assert.ok(lines.includes(`Content-Length: ${Buffer.byteLength('{"k":"中文"}', 'utf8')}`))
})

t('已有 Content-Type 头不重复；默认补 UA/Accept/Connection', () => {
  const msg = buildHttpRequest({ url: 'http://h/a', headers: ['Content-Type: text/plain'] })
  const n = msg.split('\r\n').filter((l) => /^Content-Type:/i.test(l)).length
  assert.equal(n, 1)
  assert.ok(msg.includes('User-Agent:'))
  assert.ok(msg.includes('Accept: */*'))
  assert.ok(msg.includes('Connection: close'))
})

t('cookie 进报文；无 URL → null', () => {
  const msg = buildHttpRequest({ url: 'http://h/a', cookie: 'sid=1' })
  assert.ok(msg.includes('Cookie: sid=1'))
  assert.equal(buildHttpRequest({}), null)
})

/* -------------------------------------------------------- buildCurlCommand */

t('真实 curl 命令原样保留（可信度最高，不改写）', () => {
  const raw = "curl -i -s 'http://h/a'"
  assert.equal(buildCurlCommand({ tool: raw, url: 'http://other/b' }), raw)
})

t('按 URL 合成 curl：IPv6 方括号 + 非默认端口 + POST + -d', () => {
  const cmd = buildCurlCommand({ url: 'http://[::1]:8080/x', method: 'POST', data: "a'b" })
  assert.ok(cmd.startsWith('curl -i -s'))
  assert.ok(cmd.includes('-X POST'))
  assert.ok(cmd.includes("'http://[::1]:8080/x'"))
  assert.ok(cmd.includes(`-d 'a'\\''b'`)) /* 单引号转义 */
})

t('无 URL 无工具 → null', () => {
  assert.equal(buildCurlCommand({}), null)
})

/* ------------------------------------------------------------- fillTemplate */

t('已知值填充模板；没填的占位符如实报告', () => {
  const r = fillTemplate('mysql -h <host> -P <port> -u <user> -p -e "select 1"', { host: '10.0.0.5', user: 'root' })
  assert.equal(r.cmd, 'mysql -h 10.0.0.5 -P <port> -u root -p -e "select 1"')
  assert.ok(r.filled.length >= 2)
  assert.deepEqual(r.remaining, ['<port>'])
})

t('空值不替换、不误伤（<p> 这类短占位符只按表来）', () => {
  const r = fillTemplate('mysql -h <host> -p<密码>', {})
  assert.equal(r.cmd, 'mysql -h <host> -p<密码>')
  assert.equal(r.filled.length, 0)
  const r2 = fillTemplate('redis-cli -h <host>', { pass: 'secret' })
  assert.equal(r2.cmd, 'redis-cli -h <host>')
})

console.log(`test-report-replay OK (${count} cases)`)
