import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createBook, generateBookId } from '../src/book/create'
import { deriveDesign, scanDesign } from '../src/derive/design'
import type { Concept } from '../src/inspire/concept'

const roots: string[] = []
function mkRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-create-'))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

function git(cwd: string, args: readonly string[]): ReturnType<typeof spawnSync> {
  return spawnSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true })
}

const sampleConcept: Concept = {
  状态: '已确认',
  核心创意: '夜航船上的时空异变与修仙长生',
  题材与目标读者: '古典仙侠，志怪探索读者',
  主角核心欲望: '求长生与揭开航船秘密',
  主要冲突: '古修遗骸苏醒与船规反噬',
  核心看点: '怪诞水域与微冲突信息差',
  差异化方向: '水路密闭空间下的规则怪谈仙侠',
  明确不要什么: '无脑系统打脸与退婚流',
}

describe('建书动作(PRD §3.2 / R20 / N2 构想确认)', () => {
  it('快乐路径:脚手架+构想快照+首提交,无登记文件,契约含书id→作品定调', () => {
    const ws = mkRoot()
    const r = createBook({ workspaceRoot: ws, 书名: '夜航船', concept: sampleConcept })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const root = r.bookRoot
    expect(fs.existsSync(path.join(root, '作品契约/契约.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, '构想/构想快照.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, '大纲/故事骨架.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, '大纲/分卷布局.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, '大纲/卷规划/卷01/卷纲.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, '大纲/卷规划/卷01/计划时间线.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, '大纲/卷规划/卷01/近期窗口.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, '世界书/模块声明.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, '定稿/卷01'))).toBe(true)
    expect(fs.existsSync(path.join(root, '账本/时间线.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, '本书记忆/灵感.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, '草稿区/提案'))).toBe(true)

    // 书id: b- 前缀且写入契约 frontmatter
    expect(r.bookId).toMatch(/^b-[a-z0-9]+$/)
    const contract = fs.readFileSync(path.join(root, '作品契约/契约.md'), 'utf-8')
    expect(contract).toContain(`书id: ${r.bookId}`)

    // 快照含版本与已确认内容
    const snap = fs.readFileSync(path.join(root, '构想/构想快照.md'), 'utf-8')
    expect(snap).toContain('版本:')
    expect(snap).toContain('夜航船上的时空异变与修仙长生')

    // git 首提交
    const log = git(root, ['log', '--oneline'])
    expect(log.status).toBe(0)
    const lines = (log.stdout ?? '').trim().split('\n').filter((l) => l !== '')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/vol:.*建书/)

    // 草稿区不入版本库(拍板 1):.gitignore 排除、无 .gitkeep、git status 干净
    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf-8')).toContain('草稿区/')
    const tracked = git(root, ['-c', 'core.quotepath=false', 'ls-files']).stdout ?? ''
    expect(tracked).not.toContain('草稿区')
    expect(tracked).toContain('定稿/卷01/.gitkeep')
    expect(git(root, ['status', '--porcelain']).stdout?.trim()).toBe('')
    expect(fs.existsSync(path.join(root, '草稿区/草稿'))).toBe(true)

    // R16:无登记文件
    expect(fs.existsSync(path.join(ws, 'books/登记.jsonl'))).toBe(false)

    expect(deriveDesign(scanDesign(root)).建议).toBe('作品定调')
  })

  it('N2: 拒绝未确认或残缺构想建书', () => {
    const ws = mkRoot()
    const incompleteConcept: Concept = {
      状态: '候选',
      核心创意: '脑洞',
      题材与目标读者: '留白',
      主角核心欲望: '留白',
      主要冲突: '留白',
      核心看点: '留白',
      差异化方向: '留白',
      明确不要什么: '留白',
    }
    const r = createBook({ workspaceRoot: ws, 书名: '半成品', concept: incompleteConcept })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain('构想未确认或未完整')
    }
  })

  it('同书id 前缀稳定且不随书名漂移(生成即固定)', () => {
    const a = generateBookId('书甲')
    const b = generateBookId('书甲')
    expect(a).toMatch(/^b-[a-z0-9]+$/)
    expect(a).toBe(b) // 同输入同结果(确定性)
    const c = generateBookId('书乙')
    expect(c).not.toBe(a) // 不同书名不同 id(大概率)
  })

  it('拒绝非法书名', () => {
    const ws = mkRoot()
    expect(createBook({ workspaceRoot: ws, 书名: 'a/b', concept: sampleConcept }).ok).toBe(false)
    expect(createBook({ workspaceRoot: ws, 书名: 'CON', concept: sampleConcept }).ok).toBe(false)
  })

  it('拒绝同名目录,失败无残留', () => {
    const ws = mkRoot()
    fs.mkdirSync(path.join(ws, '已有书'))
    const r = createBook({ workspaceRoot: ws, 书名: '已有书', concept: sampleConcept })
    expect(r.ok).toBe(false)
    expect(fs.existsSync(path.join(ws, '已有书'))).toBe(true) // 原目录保留
    expect(fs.existsSync(path.join(ws, 'books/登记.jsonl'))).toBe(false)
  })

  it('工作范围不存在拒绝', () => {
    const r = createBook({ workspaceRoot: path.join(mkRoot(), 'ghost'), 书名: '幽灵书', concept: sampleConcept })
    expect(r.ok).toBe(false)
  })
})

// 原「书登记(registry 自身)」describe 块随 src/book/registry.ts 删除(2026-09-01,审计丁4):
// spec §12 明写「原 books/登记.jsonl 删除」,该模块零生产调用方、仅自身测试养着。
// 书目录改由扫描工作范围发现,覆盖它的断言在上方「无登记文件」一条。
