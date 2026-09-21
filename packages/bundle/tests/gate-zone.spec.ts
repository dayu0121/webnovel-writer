import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { decideTargetForFile } from '../src/gates'

/** 构造临时工作范围:书房 + 书仓(草稿区/定稿/作品契约)。 */
function makeWorkspace(): { ws: string; bookRoot: string } {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-gate-'))
  const bookRoot = path.join(ws, '星辰')
  fs.mkdirSync(path.join(bookRoot, '草稿区', '章细纲'), { recursive: true })
  fs.mkdirSync(path.join(bookRoot, '草稿区', '草稿', '卷01-第一章'), { recursive: true })
  fs.mkdirSync(path.join(bookRoot, '定稿'), { recursive: true })
  fs.mkdirSync(path.join(bookRoot, '作品契约'), { recursive: true })
  fs.mkdirSync(path.join(ws, '书房', '知识库'), { recursive: true })
  return { ws, bookRoot }
}

function depsOf(ws: string, bookRoot: string) {
  return {
    bookRootOfId: (id: string) => (id === 'xingchen-001' ? bookRoot : undefined),
    bookRootForAbs: (abs: string) => {
      const rel = path.relative(bookRoot, abs)
      return rel !== '' && !rel.startsWith('..') ? bookRoot : undefined
    },
    workspaceRoot: () => ws,
  }
}

describe('gate 分区判定（A2a/A2b + N5/N10 修复）', () => {
  it('A2a: 裸相对路径拒绝', () => {
    const { ws, bookRoot } = makeWorkspace()
    const d = depsOf(ws, bookRoot)
    const r = decideTargetForFile('草稿区/章细纲/x.md', d)
    expect(r.kind).toBe('deny')
    expect(r.kind === 'deny' ? r.reason : '').toContain('裸相对路径拒绝')
  })

  it('A2b: 书房写入允许（以 工作范围/书房 为界）', () => {
    const { ws, bookRoot } = makeWorkspace()
    const d = depsOf(ws, bookRoot)
    const studyFile = path.join(ws, '书房', '知识库', '技法.md')
    expect(decideTargetForFile(studyFile, d)).toEqual({ kind: 'allow' })
  })

  it('书id:仓内相对路径 → 草稿区章细纲可写', () => {
    const { ws, bookRoot } = makeWorkspace()
    const d = depsOf(ws, bookRoot)
    expect(decideTargetForFile('xingchen-001:草稿区/章细纲/0001-第一章.md', d)).toEqual({ kind: 'allow' })
  })

  it('书id:仓内相对路径 → R1 落码:未确认细纲写草稿放行(播报不拒绝)', () => {
    const { ws, bookRoot } = makeWorkspace()
    const d = depsOf(ws, bookRoot)
    const r = decideTargetForFile('xingchen-001:草稿区/草稿/卷01-第一章/稿1.md', d)
    expect(r.kind).toBe('allow')
  })

  it('书id:仓内相对路径 → 定稿只读', () => {
    const { ws, bookRoot } = makeWorkspace()
    const d = depsOf(ws, bookRoot)
    const r = decideTargetForFile('xingchen-001:定稿/卷01/0001-第一章.md', d)
    expect(r.kind).toBe('deny')
    expect(r.kind === 'deny' ? r.reason : '').toContain('定稿')
  })

  it('书id:仓内相对路径 → 真源（作品契约）拒绝', () => {
    const { ws, bookRoot } = makeWorkspace()
    const d = depsOf(ws, bookRoot)
    const r = decideTargetForFile('xingchen-001:作品契约/契约.md', d)
    expect(r.kind).toBe('deny')
    expect(r.kind === 'deny' ? r.reason : '').toContain('真源')
  })

  it('绝对路径在工作范围外触发 ask (N10)', () => {
    const { ws, bookRoot } = makeWorkspace()
    const d = depsOf(ws, bookRoot)
    const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-out-')), 'x.md')
    const r = decideTargetForFile(outside, d)
    expect(r.kind).toBe('ask')
  })

  it('未知书id 拒绝', () => {
    const { ws, bookRoot } = makeWorkspace()
    const d = depsOf(ws, bookRoot)
    const r = decideTargetForFile('ghost:草稿区/x.md', d)
    expect(r.kind).toBe('deny')
    expect(r.kind === 'deny' ? r.reason : '').toContain('未知书目')
  })
})
