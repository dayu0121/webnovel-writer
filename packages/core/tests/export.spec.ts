import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import {
  computeExport, inspectExportTarget, verifyExportTarget, parseDocument, paths, serializeDocument,
} from '../src/index'
import { removeSync } from '../src/repo/remove'
import { makeFixtureBook } from './helpers/fixture-book'

const roots: string[] = []
afterAll(() => roots.forEach((root) => removeSync(root)))

function fixture(chapters = 5, opts?: { 每卷章数?: number; 书名?: string }) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-export-'))
  roots.push(workspace)
  const root = path.join(workspace, opts?.书名 ?? '测试书')
  makeFixtureBook(root, chapters, { 每卷章数: opts?.每卷章数 ?? 2 })
  return { workspace, root }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

describe('最小 Markdown 导出（任务 13）', () => {
  it('默认全书合集：卷/章标题分隔、连续章号排序、正文逐字节一致且确定', () => {
    const { root } = fixture(5, { 每卷章数: 2 })
    const result = computeExport(root)
    expect(result.ok, result.gaps.join(';')).toBe(true)
    expect(result.章列表.map((c) => c.章)).toEqual([1, 2, 3, 4, 5])
    expect(result.范围).toBe('全书')
    // 卷标题按连续章号顺序切换：卷01(1-2章)、卷02(3-4章)、卷03(第5章)
    const volumeOrder = [...result.合集.matchAll(/^## 卷(\d+)$/gm)].map((m) => m[1])
    expect(volumeOrder).toEqual(['01', '02', '03'])
    const chapterOrder = [...result.合集.matchAll(/^### 第(\d{4})章 (.+)$/gm)].map((m) => [m[1], m[2]])
    expect(chapterOrder).toEqual([['0001', '章1'], ['0002', '章2'], ['0003', '章3'], ['0004', '章4'], ['0005', '章5']])
    // 正文与定稿逐字节一致（frontmatter 不进合集）
    for (const c of result.章列表) {
      const source = fs.readFileSync(path.join(root, c.相对路径), 'utf-8')
      const parsed = parseDocument(source)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(result.合集).toContain(parsed.data.body.replace(/\n+$/, ''))
      expect(result.合集).not.toContain('状态: 已定稿')
      expect(c.内容哈希).toBe(sha256(source))
      expect(c.版本).toBe(1)
    }
    // 确定性：同状态重算字节相同
    const again = computeExport(root)
    expect(again.合集).toBe(result.合集)
    expect(again.合集哈希).toBe(result.合集哈希)
    expect(again.清单).toBe(result.清单)
  })

  it('范围选择：单卷、起止章号与空选择', () => {
    const { root } = fixture(5, { 每卷章数: 2 })
    const volume = computeExport(root, { 卷: 2 })
    expect(volume.ok).toBe(true)
    expect(volume.章列表.map((c) => c.章)).toEqual([3, 4])
    expect(volume.范围).toBe('卷02')
    const span = computeExport(root, { 起章: 2, 止章: 3 })
    expect(span.ok).toBe(true)
    expect(span.章列表.map((c) => c.章)).toEqual([2, 3])
    expect(span.范围).toBe('第0002–0003章')
    const combined = computeExport(root, { 卷: 1, 起章: 2 })
    expect(combined.章列表.map((c) => c.章)).toEqual([2])
    const empty = computeExport(root, { 卷: 9 })
    expect(empty.ok).toBe(false)
    expect(empty.gaps.join(';')).toContain('空选择')
    expect(computeExport(root, { 卷: 0 }).ok).toBe(false)
    expect(computeExport(root, { 起章: 4, 止章: 2 }).ok).toBe(false)
    // 无定稿的书也是空选择，不是异常
    const blank = fixture(0)
    const none = computeExport(blank.root)
    expect(none.ok).toBe(false)
    expect(none.gaps.join(';')).toContain('空选择')
  })

  it('来源清单注明相对路径与版本/哈希；导出前后源仓字节不变', () => {
    const { root } = fixture(3)
    const snapshot = new Map<string, string>()
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(abs)
        else snapshot.set(abs, sha256(fs.readFileSync(abs, 'utf-8')))
      }
    }
    walk(root)
    const result = computeExport(root)
    expect(result.ok).toBe(true)
    for (const c of result.章列表) {
      expect(result.清单).toContain(`${c.相对路径} | ${c.版本 ?? '无'} | ${c.内容哈希}`)
    }
    expect(result.清单).toContain(`合集 SHA-256：${result.合集哈希}`)
    expect(result.清单).toContain('最后落盘')
    expect(sha256(result.合集)).toBe(result.合集哈希)
    walk(root)
    for (const [file, hash] of snapshot) expect(sha256(fs.readFileSync(file, 'utf-8')), file).toBe(hash)
  })

  it('中文书名进入导出文件名；不合法书名回退', () => {
    const { root } = fixture(1, { 书名: '安装验收书' })
    const result = computeExport(root)
    expect(result.合集文件).toBe('安装验收书-定稿合集.md')
    expect(result.清单文件).toBe('安装验收书-来源清单.md')
    expect(result.合集).toContain('# 《安装验收书》定稿合集')
    const odd = fixture(1, { 书名: 'CON' })
    expect(computeExport(odd.root).合集文件).toBe('书稿-定稿合集.md')
  })

  it('目标目录只读检查：定稿目录、文件目标、链接与既有冲突', () => {
    const { workspace, root } = fixture(2)
    const result = computeExport(root)
    const names = [result.合集文件, result.清单文件]
    // 目标位于定稿目录内（含自身）拒绝
    expect(inspectExportTarget(root, path.join(root, '定稿'), names).ok).toBe(false)
    expect(inspectExportTarget(root, path.join(root, '定稿', '卷01'), names).ok).toBe(false)
    // 目标是已存在文件
    const fileTarget = path.join(root, paths.契约())
    const asFile = inspectExportTarget(root, fileTarget, names)
    expect(asFile.ok).toBe(false)
    expect(asFile.problems.join(';')).toContain('不是目录')
    // 不存在的目录可用；已存在目录列出冲突但不默认覆盖
    const fresh = inspectExportTarget(root, path.join(workspace, '导出'), names)
    expect(fresh.ok).toBe(true)
    expect(fresh.已存在).toBe(false)
    expect(fresh.冲突).toEqual([])
    const occupied = path.join(workspace, '已占')
    fs.mkdirSync(occupied)
    fs.writeFileSync(path.join(occupied, result.合集文件), '旧导出')
    const conflict = inspectExportTarget(root, occupied, names)
    expect(conflict.ok).toBe(false)
    expect(conflict.冲突).toEqual([result.合集文件])
    // 链接目标解析到真实落点：报告披露真实目录，别名指向定稿仍拒绝
    const link = path.join(workspace, '链接')
    fs.symlinkSync(occupied, link, 'junction')
    const aliased = inspectExportTarget(root, link, names)
    expect(aliased.ok).toBe(false)
    expect(aliased.目标目录).toBe(conflict.目标目录)
    expect(aliased.冲突).toEqual([result.合集文件])
    fs.symlinkSync(path.join(root, '定稿'), path.join(workspace, '定稿别名'), 'junction')
    expect(inspectExportTarget(root, path.join(workspace, '定稿别名'), names).ok).toBe(false)
    // 检查本身零写盘
    expect(fs.existsSync(path.join(workspace, '导出'))).toBe(false)
  })

  it('完整性异常 fail-closed：坏 frontmatter、非已定稿、章号撞卷、链接章', () => {
    const { root } = fixture(2)
    // 坏 frontmatter
    fs.writeFileSync(path.join(root, '定稿/卷01/0001-章1.md'), '---\n[坏\n---\n正文')
    let result = computeExport(root)
    expect(result.ok).toBe(false)
    expect(result.gaps.join(';')).toContain('frontmatter 解析失败')
    // 状态不是已定稿
    fs.writeFileSync(path.join(root, '定稿/卷01/0001-章1.md'), serializeDocument({ 状态: '待复核' }, '正文'))
    result = computeExport(root)
    expect(result.ok).toBe(false)
    expect(result.gaps.join(';')).toContain('状态不是已定稿')
    // 同一章号出现在两个卷
    fs.writeFileSync(path.join(root, '定稿/卷01/0001-章1.md'), serializeDocument({ 状态: '已定稿', 版本: 1 }, '正文'))
    fs.mkdirSync(path.join(root, '定稿/卷03'), { recursive: true })
    fs.writeFileSync(path.join(root, '定稿/卷03/0001-撞号.md'), serializeDocument({ 状态: '已定稿', 版本: 1 }, '另一卷同章号'))
    result = computeExport(root)
    expect(result.ok).toBe(false)
    expect(result.gaps.join(';')).toContain('章号全书不连续')
    fs.unlinkSync(path.join(root, '定稿/卷03/0001-撞号.md'))
    fs.rmdirSync(path.join(root, '定稿/卷03'))
    // 链接章文件
    fs.unlinkSync(path.join(root, '定稿/卷01/0001-章1.md'))
    if (process.platform === 'win32') {
      // Junctions exercise the real reparse-point guard without Windows file-symlink privileges.
      fs.symlinkSync(path.join(root, '定稿/卷01'), path.join(root, '定稿/卷03'), 'junction')
    } else {
      fs.symlinkSync(path.join(root, '定稿/卷01/0002-章2.md'), path.join(root, '定稿/卷01/0001-章1.md'))
    }
    result = computeExport(root)
    expect(result.ok).toBe(false)
  })

  it('落盘验收读取两个文件，拒绝缺清单、损坏和旧清单配新合集；重跑不覆盖', () => {
    const { root, workspace } = fixture(2)
    const result = computeExport(root)
    const target = path.join(workspace, '验收')
    fs.mkdirSync(target)
    const verify = () => verifyExportTarget(root, target, result)
    expect(verify().ok).toBe(false)
    fs.writeFileSync(path.join(target, result.合集文件), result.合集)
    expect(verify().ok).toBe(false)
    fs.writeFileSync(path.join(target, result.清单文件), result.清单)
    expect(verify().ok).toBe(true)
    fs.writeFileSync(path.join(target, result.合集文件), '截断')
    expect(verify().problems.join(';')).toContain('内容不一致')
    fs.writeFileSync(path.join(target, result.合集文件), result.合集)
    fs.writeFileSync(path.join(target, result.清单文件), computeExport(root, { 止章: 1 }).清单)
    expect(verify().ok).toBe(false)
    const previous = fs.readFileSync(path.join(target, result.清单文件))
    expect(inspectExportTarget(root, target, [result.合集文件, result.清单文件]).ok).toBe(false)
    expect(fs.readFileSync(path.join(target, result.清单文件))).toEqual(previous)
    expect(verifyExportTarget(root, path.join(root, '定稿'), result).ok).toBe(false)
  })

  it('导出往返比对：合集拆回各章正文与真源一致，合计字数正确', () => {
    const { root } = fixture(3, { 每卷章数: 3 })
    const result = computeExport(root)
    expect(result.ok).toBe(true)
    const bodies = new Map<number, string>()
    for (const c of result.章列表) {
      const parsed = parseDocument(fs.readFileSync(path.join(root, c.相对路径), 'utf-8'))
      if (parsed.ok) bodies.set(c.章, parsed.data.body.replace(/\n+$/, ''))
    }
    const sections = result.合集.split(/^### 第(\d{4})章 .+$/m).slice(1)
    for (let i = 0; i < sections.length; i += 2) {
      const chapter = Number(sections[i])
      const body = sections[i + 1]!.replace(/^\n+/, '').replace(/\n+$/, '')
      expect(body, `第${chapter}章`).toBe(bodies.get(chapter))
    }
    expect(result.合计字数).toBe([...bodies.values()].reduce((sum, b) => sum + [...b].length, 0))
  })
})
