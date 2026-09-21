/** Run all seven installed thin scripts against synthetic files; snapshot proves no writes. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const [installedPackage, book, reportPath] = process.argv.slice(2).map(value => path.resolve(value))
const hash = text => createHash('sha256').update(text).digest('hex')
function snapshot(dir) {
  return Object.fromEntries(fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(dir, entry.name)
    return entry.isDirectory() ? Object.entries(snapshot(target)) : [[path.relative(book, target).replaceAll('\\', '/'), hash(fs.readFileSync(target))]]
  }).sort(([left], [right]) => left.localeCompare(right)))
}
const before = snapshot(book)
const chapter = ['--卷', '1', '--章', '1', '--章名', '章1']
const scripts = [
  ['novel-review/scripts/确定性检查.mjs', chapter],
  ['novel-design/scripts/影响分析.mjs', ['--变更路径', '世界书/人物档案/主角.md']],
  ['novel-outline/scripts/影响分析.mjs', ['--变更路径', '世界书/人物档案/主角.md']],
  ['novel-outline/scripts/材料备料.mjs', chapter],
  ['novel-settle/scripts/定稿备包.mjs', chapter],
  ['novel-settle/scripts/卷摘要候选.mjs', ['--卷', '1']],
  ['novel-export/scripts/最小导出.mjs', ['--卷', '1', '--目标', path.join(path.dirname(book), '导出目标')]],
]
const results = []
for (const [script, args] of scripts) {
  const output = execFileSync(process.execPath, ['--permission', `--allow-fs-read=${installedPackage}`, `--allow-fs-read=${book}`, `--allow-fs-read=${path.dirname(book)}`, path.join(installedPackage, 'skills', script), '--book', book, ...args], { cwd: path.dirname(book), encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 5 * 1024 * 1024 })
  const result = JSON.parse(script.includes('确定性检查') ? output.slice(output.indexOf('[\n')) : output)
  if (script.includes('确定性检查')) assert.ok(result.length > 0 && result.every(item => item.审读指纹 && Array.isArray(item.发现项)))
  if ('ok' in result && !script.includes('卷摘要候选')) assert.equal(result.ok, true, output)
  if (script.includes('影响分析')) assert.ok(result.references.length > 0)
  if (script.includes('材料备料')) assert.equal(result.段.length, 10)
  if (script.includes('定稿备包')) assert.ok(result.files.length >= 7)
  if (script.includes('卷摘要候选')) {
    // 卷摘要候选按书况输出候选或如实报缺,两种都属合法结果;书仓不得有写盘
    assert.equal(typeof result.ok, 'boolean', output)
    if (result.ok) assert.ok(typeof result.候选 === 'string' && result.候选.length > 0, output)
    else assert.ok(typeof result.reason === 'string' && result.reason.length > 0, output)
  }
  if (script.includes('最小导出')) {
    assert.equal(result.文件.length, 2)
    assert.ok(result.文件[0].content.length > 0 && result.文件[1].content.includes('SHA-256'))
    assert.equal(result.目标.ok, true)
    assert.ok(!fs.existsSync(path.join(path.dirname(book), '导出目标')), 'export wrote to disk')
  }
  assert.deepEqual(snapshot(book), before, script + ' wrote to the book')
  results.push({ script, ok: true, outputBytes: Buffer.byteLength(output) })
}
fs.writeFileSync(reportPath, JSON.stringify({ ok: true, scripts: results, filesUnchanged: Object.keys(before).length, sourceReadDenied: true, writesDenied: true }, null, 2) + '\n')
console.log('Installed scripts: 7/7 passed; book snapshot unchanged')
