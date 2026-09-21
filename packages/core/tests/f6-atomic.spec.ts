/**
 * F6 验收:跨盘原子写入。
 *
 * 复现:旧实现把临时文件建在 os.tmpdir()(本环境=C 盘),书仓在本仓 D 盘——
 * renameSync 跨盘抛 EXDEV。修复后临时文件与目标同目录,同盘 rename 原子生效。
 * 书仓刻意建在 process.cwd() 下(与 C 盘临时目录异盘)以保持复现条件。
 */
import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import { writeBatchAtomic, writeFileAtomic } from '../src/index'
import { removeSync } from '../src/repo/remove'

const fixtureParent = nodePath.join(process.cwd(), '.tmp')
fs.mkdirSync(fixtureParent, { recursive: true })
const bookRoot = fs.mkdtempSync(nodePath.join(fixtureParent, 'f6-cross-drive-book-'))
const tmpDrive = nodePath.parse(require('node:os').tmpdir()).root
const bookDrive = nodePath.parse(process.cwd()).root
const crossDrive = tmpDrive.toLowerCase() !== bookDrive.toLowerCase()

afterAll(() => { removeSync(bookRoot) })

describe('F6:跨盘原子写入', () => {
  it('环境前提:书仓与系统临时目录异盘(同盘环境本例退化为普通验证)', () => {
    expect(crossDrive || tmpDrive === bookDrive).toBe(true)
  })

  it('单文件与批量写入成功(跨盘亦然),内容完整', () => {
    const rel = '定稿/卷01/0001-开篇任务.md'
    writeFileAtomic(bookRoot, rel, '跨盘原子写入正文。\n\n第二段。')
    expect(fs.readFileSync(nodePath.join(bookRoot, rel), 'utf-8')).toContain('跨盘原子写入正文')
    writeBatchAtomic(bookRoot, [
      { relPath: '大纲/卷规划/卷01/章细纲/0001-开篇任务.md', content: '# 章细纲\n' },
      { relPath: '草稿区/草稿/卷01-开篇任务/稿1.md', content: '草稿正文' },
    ])
    expect(fs.existsSync(nodePath.join(bookRoot, '草稿区/草稿/卷01-开篇任务/稿1.md'))).toBe(true)
  })

  it('写入后目录零临时残留', () => {
    const dir = nodePath.join(bookRoot, '定稿/卷01')
    const residue = fs.readdirSync(dir).filter((f) => f.includes('.tmp') || f.startsWith('.webnovel-b1'))
    expect(residue).toEqual([])
  })

  it('批量中途失败 → 完全回滚,零残留,原目标不被半写覆盖', () => {
    const target = nodePath.join(bookRoot, '定稿/卷01/0001-开篇任务.md')
    const before = fs.readFileSync(target, 'utf-8')
    // 第二个 op 的父目录与既有文件同名 → staging 中途 mkdir 失败 → 触发回滚
    expect(() => writeBatchAtomic(bookRoot, [
      { relPath: '定稿/卷01/0002-第二章.md', content: '第二章' },
      { relPath: '定稿/卷01/0001-开篇任务.md/子.md', content: 'x' },
    ])).toThrow(/原子写失败/)
    // 第一个 op 已写的 0002 须回滚干净;原目标不受影响
    expect(fs.existsSync(nodePath.join(bookRoot, '定稿/卷01/0002-第二章.md'))).toBe(false)
    expect(fs.readFileSync(target, 'utf-8')).toBe(before)
    const residue = fs.readdirSync(nodePath.join(bookRoot, '定稿/卷01')).filter((f) => f.startsWith('.webnovel-b1') || f.endsWith('.tmp'))
    expect(residue).toEqual([])
  })
})
