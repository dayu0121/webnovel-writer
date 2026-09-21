import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

export async function checkMinimalExport({ root, workspace, check, report }) {
  const core = await import(pathToFileURL(path.join(root, 'native-write-core.mjs')).href)
  await check('最小导出合集清单、范围冲突与确定重跑', async () => {
    const book = path.join(workspace, '导出验收书')
    core.makeFixtureBook(book, 3, { 每卷章数: 2 })
    const snapshot = () => {
      const out = {}
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, entry.name)
          if (entry.isDirectory()) walk(abs)
          else out[abs] = sha256(fs.readFileSync(abs))
        }
      }
      walk(book)
      return out
    }
    const before = snapshot()
    // Thin entry resolves ../../../lib/index.js from the packaged skills tree.
    fs.copyFileSync(path.join(root, 'lib/webnovel.mjs'), path.join(root, 'lib/index.js'))
    const script = path.join(root, 'skills/novel-export/scripts/最小导出.mjs')
    const run = (args, options = {}) => execFileSync(process.execPath, [script, '--book', book, ...args], { cwd: workspace, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 5 * 1024 * 1024, ...options })

    const whole = JSON.parse(run([]))
    assert.equal(whole.ok, true)
    assert.equal(whole.章数, 3)
    assert.equal(whole.书名, '导出验收书')
    assert.deepEqual(whole.文件.map((f) => f.名称), ['导出验收书-定稿合集.md', '导出验收书-来源清单.md'])
    const compendium = whole.文件[0].content
    const manifest = whole.文件[1].content
    assert.deepEqual([...compendium.matchAll(/^### 第(\d{4})章 /gm)].map((m) => m[1]), ['0001', '0002', '0003'])
    assert.deepEqual([...compendium.matchAll(/^## 卷(\d+)$/gm)].map((m) => m[1]), ['01', '02'])
    assert.ok(!compendium.includes('状态: 已定稿'))
    for (const entry of whole.章列表) {
      const source = fs.readFileSync(path.join(book, entry.相对路径), 'utf8')
      const parsed = core.parseDocument(source)
      assert.equal(parsed.ok, true)
      assert.ok(compendium.includes(parsed.data.body.replace(/\n+$/, '')), entry.相对路径)
      assert.equal(entry.内容哈希, sha256(source))
      assert.ok(manifest.includes(`${entry.相对路径} | ${entry.版本} | ${entry.内容哈希}`))
    }
    assert.ok(manifest.includes(`合集 SHA-256：${whole.合集哈希}`))
    assert.equal(sha256(compendium), whole.合集哈希)

    const scoped = JSON.parse(run(['--卷', '2']))
    assert.deepEqual(scoped.章列表.map((c) => c.章), [3])
    assert.throws(() => run(['--卷', '9'], { stdio: 'pipe' }), /exit code 1|Command failed/)
    const rerun = JSON.parse(run([]))
    assert.equal(rerun.合集哈希, whole.合集哈希)
    assert.equal(rerun.文件[1].content, manifest)
    assert.equal(rerun.文件[0].content, compendium)

    const target = path.join(workspace, '通读导出')
    const withTarget = JSON.parse(run(['--目标', target]))
    assert.equal(withTarget.目标.ok, true)
    assert.equal(withTarget.目标.已存在, false)
    assert.ok(!fs.existsSync(target))
    assert.throws(() => run(['--目标', path.join(book, '定稿')], { stdio: 'pipe' }))

    // Author-confirmed write: compendium first, manifest last; rerun verifies hash.
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, whole.合集文件), compendium)
    fs.writeFileSync(path.join(target, whole.清单文件), manifest)
    assert.throws(() => run(['--目标', target], { stdio: 'pipe' }))
    const verify = JSON.parse(run(['--目标', target, '--校验', 'true']))
    assert.equal(verify.ok, true)
    assert.equal(verify.校验.ok, true)
    assert.ok(verify.校验.文件.every(file => file.实际哈希 === file.预期哈希))
    assert.equal(verify.合集哈希, whole.合集哈希)
    assert.deepEqual(verify.目标.冲突, [whole.合集文件, whole.清单文件])
    fs.writeFileSync(path.join(target, whole.合集文件), '截断的临时副本')
    assert.throws(() => run(['--目标', target, '--校验', 'true'], { stdio: 'pipe' }))
    fs.writeFileSync(path.join(target, whole.合集文件), compendium)
    fs.unlinkSync(path.join(target, whole.清单文件))
    assert.throws(() => run(['--目标', target, '--校验', 'true'], { stdio: 'pipe' }))
    fs.writeFileSync(path.join(target, whole.清单文件), manifest)
    for (const flag of ['--卷', '--起章', '--止章', '--目标', '--校验']) {
      assert.throws(() => run([flag], { stdio: 'pipe' }))
    }
    assert.throws(() => run(['--止章', '--卷', '1'], { stdio: 'pipe' }))

    const after = snapshot()
    assert.deepEqual(after, before)
    report.minimalExport = {
      chapters: whole.章数, volumes: 2, totalChars: whole.合计字数, compendiumBytes: Buffer.byteLength(compendium),
      manifestListed: true, deterministicRerun: true, targetChecks: true, bookUnchanged: true, externalModelTokens: null,
    }
  })
}
