import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { withBookWrite, writeBatchAtomic, writeContract, paths } from '../src'
import { removeSync } from '../src/repo/remove'

const roots: string[] = []
function root(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-process-'))
  roots.push(value)
  return value
}
let moduleUrl: string
beforeAll(() => {
  const localRequire = createRequire(import.meta.url)
  const vitestRequire = createRequire(localRequire.resolve('vitest/package.json'))
  const viteRequire = createRequire(vitestRequire.resolve('vite/package.json'))
  const { buildSync } = viteRequire('esbuild') as { buildSync(options: Record<string, unknown>): unknown }
  const outfile = path.join(root(), 'atomic.mjs')
  buildSync({ entryPoints: [fileURLToPath(new URL('../src/repo/atomic.ts', import.meta.url))], outfile, bundle: true, platform: 'node', format: 'esm' })
  moduleUrl = pathToFileURL(outfile).href
})
afterAll(() => { for (const value of roots.reverse()) removeSync(value) })

const childSource = `
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const [url, root, mode, count, rawOps] = process.argv.slice(1);
const rename = fs.renameSync;
let applied = 0;
fs.renameSync = (from, to) => {
  const result = rename(from, to);
  if (mode === 'rename' && path.basename(String(from)).startsWith('.webnovel-txn-') && ++applied === Number(count)) process.exit(88);
  if (mode === 'commit' && path.basename(String(to)) === 'manifest.json' && JSON.parse(fs.readFileSync(to, 'utf8')).phase === 'committed') process.exit(88);
  return result;
};
syncBuiltinESMExports();
const { withBookWrite, writeBatchAtomic } = await import(url);
withBookWrite(root, () => {
  if (mode === 'hold') {
    fs.writeFileSync(path.join(root, 'ready'), '');
    const end = Date.now() + 10000;
    while (!fs.existsSync(path.join(root, 'release')) && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    return;
  }
  writeBatchAtomic(root, JSON.parse(rawOps));
}, { operationId: 'process-operation', sessionId: 'process-session', callId: 'process-call' });
`

const ops = [
  { relPath: '正文/a.md', content: 'new-a' },
  { relPath: '正文/b.md', content: 'new-b' },
  { relPath: '正文/c.md', content: 'new-c' },
]
function fixture(): string {
  const value = root()
  fs.mkdirSync(path.join(value, '正文'))
  fs.writeFileSync(path.join(value, '正文/a.md'), 'old-a')
  fs.writeFileSync(path.join(value, '正文/b.md'), 'old-b')
  return value
}
function crash(value: string, mode: string, count: number, files = ops): void {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource, moduleUrl, value, mode, String(count), JSON.stringify(files)], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
  expect(child.status, child.stderr).toBe(88)
}

describe('real process interruption', () => {
  it.each([1, 2, 3])('recovers before a writer reads after target rename %s', (count) => {
    const value = fixture()
    crash(value, 'rename', count)
    const txs = path.join(value, '.webnovel/transactions')
    const manifest = JSON.parse(fs.readFileSync(path.join(txs, fs.readdirSync(txs)[0]!, 'manifest.json'), 'utf8'))
    expect(manifest.provenance).toMatchObject({ operationId: 'process-operation', sessionId: 'process-session', callId: 'process-call' })
    withBookWrite(value, () => {
      expect(fs.readFileSync(path.join(value, '正文/a.md'), 'utf8')).toBe('old-a')
      expect(fs.readFileSync(path.join(value, '正文/b.md'), 'utf8')).toBe('old-b')
      expect(fs.existsSync(path.join(value, '正文/c.md'))).toBe(false)
    })
    expect(fs.readdirSync(txs)).toEqual([])
    expect(fs.readdirSync(path.join(value, '正文')).sort()).toEqual(['a.md', 'b.md'])
  })

  it('keeps every committed target when the process exits before cleanup', () => {
    const value = fixture()
    crash(value, 'commit', 0)
    withBookWrite(value, () => {
      for (const op of ops) expect(fs.readFileSync(path.join(value, op.relPath), 'utf8')).toBe(op.content)
    })
    expect(fs.readdirSync(path.join(value, '.webnovel/transactions'))).toEqual([])
  })

  it('retains all evidence and all targets when any target conflicts', () => {
    const value = fixture()
    crash(value, 'rename', 2)
    fs.writeFileSync(path.join(value, '正文/b.md'), 'author-edit')
    expect(() => withBookWrite(value, () => 'unreachable')).toThrow(/恢复冲突/)
    expect(fs.readFileSync(path.join(value, '正文/a.md'), 'utf8')).toBe('new-a')
    expect(fs.readFileSync(path.join(value, '正文/b.md'), 'utf8')).toBe('author-edit')
    const tx = path.join(value, '.webnovel/transactions', fs.readdirSync(path.join(value, '.webnovel/transactions'))[0]!)
    expect(fs.existsSync(path.join(tx, 'manifest.json'))).toBe(true)
    expect(fs.readFileSync(path.join(tx, 'backups/0.bak'), 'utf8')).toBe('old-a')
  })

  it('public contract writer recovers its input before merging an update', () => {
    const value = root()
    writeContract(value, { 题材与读者定位: { state: '已确认', body: 'OLD-CONTRACT' } })
    const original = fs.readFileSync(path.join(value, paths.契约()), 'utf8')
    crash(value, 'rename', 1, [{ relPath: paths.契约(), content: original.replace('OLD-CONTRACT', 'CRASH-CONTRACT') }])
    writeContract(value, { 核心看点与差异化: { state: '已确认', body: 'NEW-PART' } })
    const result = fs.readFileSync(path.join(value, paths.契约()), 'utf8')
    expect(result).toContain('OLD-CONTRACT')
    expect(result).toContain('NEW-PART')
    expect(result).not.toContain('CRASH-CONTRACT')
  })

  it('refuses a real live writer in another process', async () => {
    const value = root()
    const child = spawn(process.execPath, ['--input-type=module', '-e', childSource, moduleUrl, value, 'hold', '0', '[]'], { windowsHide: true, stdio: 'ignore' })
    const exited = new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', () => resolve())
    })
    try {
      const end = Date.now() + 5000
      while (!fs.existsSync(path.join(value, 'ready')) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10))
      expect(fs.existsSync(path.join(value, 'ready'))).toBe(true)
      expect(() => writeBatchAtomic(value, [{ relPath: 'blocked.md', content: 'blocked' }])).toThrow(/锁定中/)
      expect(fs.existsSync(path.join(value, 'blocked.md'))).toBe(false)
    } finally {
      fs.writeFileSync(path.join(value, 'release'), '')
      await exited
    }
  })

  it('uses one lock for a canonical root and a junction alias', () => {
    const value = root()
    const alias = path.join(root(), 'alias')
    fs.symlinkSync(value, alias, process.platform === 'win32' ? 'junction' : 'dir')
    withBookWrite(alias, () => writeBatchAtomic(value, [{ relPath: 'alias.md', content: 'ok' }]))
    expect(fs.readFileSync(path.join(value, 'alias.md'), 'utf8')).toBe('ok')
  })
})
