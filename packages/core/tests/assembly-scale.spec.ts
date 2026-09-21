import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { assembleMaterials, paths, readManifest, serializeDocument, writeFileAtomic } from '../src/index'
import { makeFixtureBook } from './helpers/fixture-book'

const roots: string[] = []
function mkDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

const KEY51 = { 卷: 2, 章: 51, 章名: '章51' } as const

function sectionText(root: string, 章名: string, name: string): string {
  const dir = paths.材料包目录(KEY51.卷, 章名)
  const files = fs.readdirSync(path.join(root, dir))
  const file = files.find((f) => f.includes(name))
  expect(file, `材料包段文件存在:${name}`).toBeTruthy()
  return fs.readFileSync(path.join(root, dir, file!), 'utf-8')
}

describe('材料包切片与规模不变量', () => {
  it('200 章书:时间线段只含最近 20 条＋命中项;活跃账本项一行制;清单每段有字数(A5)', () => {
    const root = mkDir('webnovel-scale200-')
    makeFixtureBook(root, 200)
    const r = assembleMaterials(root, KEY51)
    expect(r.ok).toBe(true)

    const tl = sectionText(root, KEY51.章名, '当前事实与连续性')
    const tlEntries = tl.match(/^## /gm) ?? []
    expect(tlEntries.length).toBeLessThanOrEqual(21) // 20 最近 + 命中的城门异响(若不在最近 20 内)

    const ledger = sectionText(root, KEY51.章名, '故事线承诺线索')
    const roster = ledger.split('### 其余活跃条目')[1] ?? ''
    const rosterLines = roster.split('\n').filter((l) => /^- .+〔.+〕$/.test(l.trim()))
    expect(rosterLines.length).toBeGreaterThan(0)
    expect(rosterLines.length).toBeLessThanOrEqual(100) // 1200 条账本里活跃项一行制,不随书规模倾倒全文

    const manifest = readManifest(root, { 卷: KEY51.卷, 章名: KEY51.章名 })
    expect(manifest).toBeTruthy()
    expect(manifest!.段).toHaveLength(10)
    for (const s of manifest!.段) {
      expect(typeof s.字数, `段「${s.段}」有字数`).toBe('number')
    }
    expect(manifest!.合计字数).toBe(manifest!.段.reduce((sum, s) => sum + s.字数, 0))
  })

  it('第 51 章衔接段含第 50 章末尾与 48-50 章摘要;第 1 章标无上一章定稿(A6)', () => {
    const root = mkDir('webnovel-scale-link-')
    makeFixtureBook(root, 200)
    const r = assembleMaterials(root, KEY51)
    expect(r.ok).toBe(true)
    const link = sectionText(root, KEY51.章名, '近期正文衔接')
    expect(link).toContain('本章收束于城门，主角正要进城')
    expect(link).toContain('### 第0048章 章48')
    expect(link).toContain('### 第0049章 章49')
    expect(link).toContain('### 第0050章 章50')
    expect(link).not.toContain('### 第0047章')

    const first = assembleMaterials(root, { 卷: 1, 章: 1, 章名: '章1' })
    expect(first.ok).toBe(true)
    const dir1 = paths.材料包目录(1, '章1')
    const linkFile = fs.readdirSync(path.join(root, dir1)).find((f) => f.includes('近期正文衔接'))!
    const link1 = fs.readFileSync(path.join(root, dir1, linkFile), 'utf-8')
    expect(link1).toContain('（无上一章定稿）')
    const manifest1 = readManifest(root, { 卷: 1, 章名: '章1' })
    expect(manifest1!.段.find((s) => s.段 === '近期正文衔接')!.完整性).toBe('空')
  })

  it('2 章书与 200 章书材料包合计字数比值 ≤ 1.5(A7)', () => {
    const small = mkDir('webnovel-scale2-')
    makeFixtureBook(small, 2)
    expect(assembleMaterials(small, { 卷: 1, 章: 2, 章名: '章2' }).ok).toBe(true)
    const smallTotal = readManifest(small, { 卷: 1, 章名: '章2' })!.合计字数

    const big = mkDir('webnovel-scale200b-')
    makeFixtureBook(big, 200)
    expect(assembleMaterials(big, KEY51).ok).toBe(true)
    const bigTotal = readManifest(big, { 卷: KEY51.卷, 章名: KEY51.章名 })!.合计字数

    expect(bigTotal / smallTotal).toBeLessThanOrEqual(1.5)
  })

  it('超原段上限的段不再截断:正文逐字保留、完整性非截断、清单无原始字数', () => {
    const root = mkDir('webnovel-scale-cap-')
    makeFixtureBook(root, 1)
    const 基调正文 = '基调要求：句子短促，画面先行，不解释情绪。'.repeat(200)
    const 巨型契约 = serializeDocument({ 状态: '已确认' }, [
      '# 契约', '', '## 叙事方式与文风基调', '', 基调正文, '',
      '## 创作禁区与不可妥协项', '', '- 〔硬〕主角不得死亡', '',
    ].join('\n'))
    writeFileAtomic(root, paths.契约(), 巨型契约)
    expect(assembleMaterials(root, { 卷: 1, 章: 1, 章名: '章1' }).ok).toBe(true)

    const manifest = readManifest(root, { 卷: 1, 章名: '章1' })!
    const 暂定 = manifest.段.find((s) => s.段 === '暂定与警告')!
    expect(暂定.字数).toBeGreaterThan(2500) // 超原 2500 上限,证明确实进了取消上限的路径
    expect(暂定.完整性).not.toBe('截断')
    expect(暂定).not.toHaveProperty('原始字数')

    const dir = paths.材料包目录(1, '章1')
    const files = fs.readdirSync(path.join(root, dir))
    const file = files.find((f) => f.includes('暂定与警告'))!
    const body = fs.readFileSync(path.join(root, dir, file), 'utf-8')
    expect(body).toContain(基调正文) // 逐字保留,未被裁到上限
  })
})
