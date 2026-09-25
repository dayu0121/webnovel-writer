import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { scanBooks, hasBooks } from '../src/bookshelf'
import { parseBookPathInput, resolveToBookPath } from '../src/paths'
import { renderOverview, renderCurrentBook, attachStatusToAgent, progressLineOf } from '../src/status-context'
import { validateWorkspacePath, scaffoldStudy, STUDY_DIRS } from '../src/workspace'

/** 临时工作范围:建书签名+契约。 */
function makeWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-scan-'))
  const book = path.join(dir, '星辰')
  fs.mkdirSync(path.join(book, '作品契约'), { recursive: true })
  fs.writeFileSync(path.join(book, '作品契约', '契约.md'), '---\n书id: xingchen-001\n---\n正文\n', 'utf8')
  return dir
}

describe('bookshelf 书架扫描', () => {
  it('扫描出含契约的子目录为一本书,书id 从 frontmatter 读', () => {
    const ws = makeWorkspace()
    const books = scanBooks(ws)
    expect(books).toHaveLength(1)
    expect(books[0]).toMatchObject({ name: '星辰', bookId: 'xingchen-001' })
    expect(books[0].root).toBe(path.join(ws, '星辰'))
    expect(hasBooks(ws)).toBe(true)
  })

  it('空工作范围:无书', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-scan-empty-'))
    expect(scanBooks(ws)).toEqual([])
    expect(hasBooks(ws)).toBe(false)
  })

  it('无契约的子目录不算书', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-scan-nocontract-'))
    fs.mkdirSync(path.join(ws, '书房'), { recursive: true })
    fs.mkdirSync(path.join(ws, '随笔'), { recursive: true })
    expect(scanBooks(ws)).toEqual([])
  })

  it('输出有序(按目录名),确定性', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-scan-sort-'))
    for (const name of ['乙书', '甲书']) {
      fs.mkdirSync(path.join(ws, name, '作品契约'), { recursive: true })
      fs.writeFileSync(path.join(ws, name, '作品契约', '契约.md'), '---\n书id: x\n---\n', 'utf8')
    }
    expect(scanBooks(ws).map((b) => b.name)).toEqual(['乙书', '甲书'])
  })
})

describe('paths 当前书路径解析', () => {
  const roots = new Map([
    ['book-a', 'D:/repo/书仓/甲'],
    ['book-b', 'D:/repo/书仓/乙'],
  ])
  const rootOf = (id: string): string | undefined => roots.get(id)

  it('书id+仓内相对路径 → 仓内绝对路径', () => {
    const r = resolveToBookPath(rootOf, 'book-a:大纲/故事骨架.md')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.path).toContain('书仓')
  })

  it('裸相对路径拒绝(PRD §4.7)', () => {
    const r = resolveToBookPath(rootOf, '大纲/故事骨架.md')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('裸相对路径拒绝')
    expect(parseBookPathInput('大纲/故事骨架.md').kind).toBe('bare-relative')
  })

  it('未知书id 拒绝', () => {
    const r = resolveToBookPath(rootOf, 'ghost:作品契约/契约.md')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('未知书目')
  })

  it('逃逸(../)拒绝', () => {
    const r = resolveToBookPath(rootOf, 'book-a:../../outside.md')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('逃逸')
  })

  it('绝对路径:直接放行由门禁再判', () => {
    const absolute = process.platform === 'win32' ? 'D:/repo/书仓/甲/大纲/骨架.md' : '/repo/书仓/甲/大纲/骨架.md'
    const r = resolveToBookPath(rootOf, absolute)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.path).toContain('大纲/骨架.md')
  })
})

describe('status-context 状态注入', () => {
  it('renderOverview:空工作区给出新建入口', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-status-')) 
    const text = renderOverview(ws)
    expect(text).toContain('【工作区总览】')
    expect(text).toContain('目前还没有作品')
    expect(text).toContain('新建番茄短故事')
    expect(text).not.toContain('新建长篇小说')
  })

  it('renderOverview:有书列出书名与书id', () => {
    const ws = makeWorkspace()
    const text = renderOverview(ws)
    expect(text).toContain('《星辰》')
    expect(text).toContain('xingchen-001')
    expect(text).toContain('继续写这本书')
  })

  it('renderCurrentBook:选书回复包含书名、书id 与近况', () => {
    const text = renderCurrentBook('星辰', 'xingchen-001', '当前推进：第1卷·第2章 定稿准备与沉淀')
    expect(text).toContain('现在写的是《星辰》')
    expect(text).toContain('xingchen-001')
    expect(text).toContain('当前推进')
  })

  it('attach:书架事实每次从文件读取，不需要会话记录', () => {
    let registered: { name: string; order: number; text: (a: unknown) => string } | null = null
    const fakeCtx = {
      systemPrompt: {
        context: (c: unknown) => {
          const entry = c as NonNullable<typeof registered>
          if (entry.name === 'webnovel.status') registered = entry
        },
      },
      inject: (_deps: unknown, cb: (scope: unknown) => void) => {
        cb(fakeCtx)
        return { dispose: () => Promise.resolve() }
      },
    }
    const ws = makeWorkspace()
    const deps = {
      workspaceRoot: () => ws,
    }
    const dispose = attachStatusToAgent(fakeCtx as never, deps)
    expect(dispose).toBeDefined()
    expect(registered).not.toBeNull()
    expect(registered!.name).toBe('webnovel.status')
    expect(registered!.text({})).toContain('【工作区总览】')
    fs.mkdirSync(path.join(ws, '夜航', '作品契约'), { recursive: true })
    fs.writeFileSync(path.join(ws, '夜航', '作品契约', '契约.md'), '---\n书id: yehang-002\n---\n')
    expect(registered!.text({})).toContain('《夜航》')
    expect(dispose).toBeDefined()
  })
})

describe('workspace 装机', () => {
  it('校验:普通目录通过', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-ws-'))
    const r = validateWorkspacePath(dir, () => undefined, () => false)
    expect(r.ok).toBe(true)
  })

  it('校验:本身是 git 仓被拒', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-wsgit-'))
    fs.mkdirSync(path.join(dir, '.git'))
    const r = validateWorkspacePath(dir, () => undefined, () => false)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('git 仓')
  })

  it('校验:落在别人 git 仓内部被拒', () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-outer-'))
    fs.mkdirSync(path.join(outer, '.git'))
    const inner = path.join(outer, 'child')
    fs.mkdirSync(inner)
    const r = validateWorkspacePath(inner, () => undefined, () => false)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('git 仓内部')
  })

  it('校验:已是 workspace 或位于其下被拒', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-wsowned-'))
    expect(validateWorkspacePath(dir, () => ({ owned: true }), () => false).ok).toBe(false)
    const inner = path.join(dir, 'sub')
    fs.mkdirSync(inner)
    expect(validateWorkspacePath(inner, () => undefined, () => true).ok).toBe(false)
  })

  it('书房脚手架:建出四目录且幂等', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-study-'))
    const created = scaffoldStudy(dir)
    expect(created.length).toBe(STUDY_DIRS.length)
    for (const d of STUDY_DIRS) {
      expect(fs.statSync(path.join(dir, '书房', d)).isDirectory()).toBe(true)
    }
    // 幂等:再次调用不抛且目录仍在
    scaffoldStudy(dir)
    for (const d of STUDY_DIRS) {
      expect(fs.statSync(path.join(dir, '书房', d)).isDirectory()).toBe(true)
    }
  })
})

describe('progressLineOf 选书近况(一行固定形状,只扫当前卷)', () => {
  it('有章节动静时输出固定形状一行;连续两次求值完全相同', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-progress-'))
    // 构造有近期窗口+候选细纲的最小书仓
    fs.mkdirSync(path.join(dir, '大纲', '卷规划', '卷01'), { recursive: true })
    fs.writeFileSync(path.join(dir, '大纲', '卷规划', '卷01', '近期窗口.md'), '# 近期窗口\n\n- 第一章 〔已确认〕\n\n', 'utf8')
    fs.mkdirSync(path.join(dir, '草稿区', '章细纲'), { recursive: true })
    fs.writeFileSync(path.join(dir, '草稿区', '章细纲', '卷01-第一章.md'), '---\n状态: 候选\n---\n', 'utf8')
    const line = progressLineOf(dir)
    expect(line).toBe('卷01 第0000章 第一章 · 章细纲(待确认)')
    expect(progressLineOf(dir)).toBe(line)
  })

  it('无章节规划时给出推进提示', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-progress-empty-'))
    const line = progressLineOf(dir)
    expect(line).toContain('尚无已规划章节')
  })
})
