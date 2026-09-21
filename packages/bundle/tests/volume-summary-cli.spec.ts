import { afterAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { paths, seedMinDesign, serializeDocument, writeFileAtomic } from '@webnovel/core'
import { volumeSummaryCli } from '../src/scripts/volume-summary-cli'

const roots: string[] = []
function mkBook(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-volsum-cli-'))
  roots.push(dir)
  seedMinDesign(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放 */ } } })

function finalize(root: string, chapters: number, opts: { 缺摘要?: number[] } = {}): void {
  writeFileAtomic(root, paths.卷纲(1), '# 卷纲\n\n卷01｜1 案／3 章\n\n## 叙事结构 〔已确认〕\n\nx\n\n## 卷末兑现 〔已确认〕\n\n- 结案。\n')
  for (const name of ['故事线', '人物弧线', '承诺', '时间线'] as const) {
    writeFileAtomic(root, paths.账本(name), `# ${name}\n`)
  }
  for (let n = 1; n <= chapters; n += 1) {
    const fin = path.join(root, `定稿/卷01/${String(n).padStart(4, '0')}-第${n}案.md`)
    fs.mkdirSync(path.dirname(fin), { recursive: true })
    fs.writeFileSync(fin, serializeDocument({ 状态: '已定稿' }, '正文'), 'utf-8')
    if (opts.缺摘要?.includes(n)) continue
    const sum = path.join(root, paths.章摘要(1, n, `第${n}案`))
    fs.mkdirSync(path.dirname(sum), { recursive: true })
    fs.writeFileSync(sum, `# 章摘要\n\n第${n}案摘要。`, 'utf-8')
  }
}

function captureRun(argv: string[]): { code: number; out: string } {
  const lines: string[] = []
  const logSpy = vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => { lines.push(String(msg)) })
  const errSpy = vi.spyOn(console, 'error').mockImplementation((msg?: unknown) => { lines.push(String(msg)) })
  try {
    const code = volumeSummaryCli(argv)
    return { code, out: lines.join('\n') }
  } finally {
    logSpy.mockRestore()
    errSpy.mockRestore()
  }
}

describe('卷摘要候选薄入口退出码(F21-2)', () => {
  it('账本缺失/损坏 → exit 1(前置不满足);正常与如实报缺 → exit 0', () => {
    // 正常:账本在线索有卷内条目
    const okBook = mkBook()
    finalize(okBook, 3)
    writeFileAtomic(okBook, paths.账本('线索'), '# 线索\n\n## 铜灯钩\n状态：已收\n埋设点：第0001章\n\n### 正文\n划痕。\n')
    const okRun = captureRun(['--book', okBook, '--卷', '1'])
    expect(okRun.code).toBe(0)
    expect(JSON.parse(okRun.out).ok).toBe(true)

    // 如实报缺:缺第2章摘要(账本在线索空) → exit 0,ok:false
    const lackBook = mkBook()
    finalize(lackBook, 3, { 缺摘要: [2] })
    writeFileAtomic(lackBook, paths.账本('线索'), '# 线索\n')
    const lackRun = captureRun(['--book', lackBook, '--卷', '1'])
    expect(lackRun.code).toBe(0)
    expect(JSON.parse(lackRun.out).ok).toBe(false)

    // 账本缺失:不创建线索账本 → exit 1
    const missingBook = mkBook()
    finalize(missingBook, 3)
    const missingRun = captureRun(['--book', missingBook, '--卷', '1'])
    expect(missingRun.code).toBe(1)
    expect(JSON.parse(missingRun.out).ok).toBe(false)

    // 账本损坏:重复字段 → exit 1
    const badBook = mkBook()
    finalize(badBook, 3)
    writeFileAtomic(badBook, paths.账本('线索'), '# 线索\n\n## 坏\n状态：已埋\n状态：已示\n')
    const badRun = captureRun(['--book', badBook, '--卷', '1'])
    expect(badRun.code).toBe(1)
    expect(JSON.parse(badRun.out).ok).toBe(false)
  })
})
