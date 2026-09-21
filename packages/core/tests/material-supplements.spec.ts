import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  assembleMaterials, computeMaterials, loadMaterialPackage, rebuildResume, scanChapter,
  serializeDocument, writeReviewRecord, type SupplementEdit,
} from '../src/index'
import { removeSync } from '../src/repo/remove'
import { makeFixtureBook } from './helpers/fixture-book'
import { loadDraftContext } from '../../drafting/src/context'
import { computeReview, registerCheck, registerDefaultChecks, resetChecks } from '../../review/src/index'
import * as rename from '../src/repo/rename'

const roots: string[] = []
const key = { 卷: 1, 章: 3, 章名: '章3' }
afterAll(() => roots.forEach(root => removeSync(root)))
beforeEach(() => { resetChecks(); registerDefaultChecks() })
afterEach(() => vi.restoreAllMocks())

function fixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-supplements-'))
  roots.push(workspace)
  const root = path.join(workspace, '测试书')
  makeFixtureBook(root, 3)
  const put = (base: string, rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true })
    fs.writeFileSync(path.join(base, rel), body)
  }
  put(root, '大纲/卷规划/卷01/卷纲.md', '# 卷纲\n\n' + ['叙事结构', '弧线', '线索推进', '卷末兑现'].map(name => `## ${name}\n\n章3承接城门事件，核对铜符。\n`).join('\n'))
  put(root, '草稿区/草稿/卷01-章3/稿1.md', serializeDocument({ 角色: '待审稿', 版本: 1 }, '主角继续前行，铜符仍在袖中。'))
  put(root, '世界书/人物档案/关系补记.md', '# 关系原文\n第二章后两人约定共同守门。【关系变化样本】\n')
  put(workspace, '书房/作者记忆/早期决定.md', '# 作者决定\n主角始终拒绝加入内卫。【早期决策样本】\n')
  const earlier = path.join(root, '定稿/卷01/0001-章1.md')
  fs.appendFileSync(earlier, '\n守门人遗落一枚旧铜符。【伏笔回收样本】\n')
  const operations: SupplementEdit[] = [
    { 操作: '设置', 编号: 'earlier', 标题: '早期伏笔', 理由: '本章回收第一章线索', 性质: '原文', 来源: { 域: '本书', 路径: '定稿/卷01/0001-章1.md' } },
    { 操作: '设置', 编号: 'relationship', 标题: '关系变化', 理由: '核对两人当前约定', 性质: '原文', 来源: { 域: '本书', 路径: '世界书/人物档案/关系补记.md' } },
    { 操作: '设置', 编号: 'decision', 标题: '作者早期决定', 理由: '保持早期裁决', 性质: '建议', 来源: { 域: '书房', 路径: '作者记忆/早期决定.md' } },
  ]
  const preview = (edits = operations) => computeMaterials(root, { ...key, 仅预览: true, 补充操作: edits })
  const save = (edits = operations) => {
    const prepared = preview(edits)
    expect(prepared.ok, prepared.gaps.join(';')).toBe(true)
    return assembleMaterials(root, { ...key, 材料清单哈希: prepared.已有清单哈希, 补充操作: prepared.补充预览!.map(item => item.操作) })
  }
  return { workspace, root, put, operations, preview, save, dir: path.join(root, '草稿区/材料包/卷01-章3') }
}

describe('持久补料与实际消费（15B）', () => {
  it('公开预览入口不进入写锁或事务恢复', () => {
    const f = fixture()
    const lock = path.join(f.root, '.webnovel/book.lock')
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }))
    const before = fs.readFileSync(lock, 'utf8')
    expect(assembleMaterials(f.root, { ...key, 仅预览: true, 补充操作: f.operations }).ok).toBe(true)
    expect(fs.readFileSync(lock, 'utf8')).toBe(before)
    expect(fs.existsSync(f.dir)).toBe(false)
    fs.unlinkSync(lock)
  })
  it('预览零写盘；三种来源进入写稿、恢复和实际审读模块/输出', () => {
    const f = fixture()
    const beforeSource = fs.readFileSync(path.join(f.root, '定稿/卷01/0001-章1.md'), 'utf8')
    const preview = f.preview()
    expect(preview.ok, preview.gaps.join(';')).toBe(true)
    expect(fs.existsSync(f.dir)).toBe(false)
    expect(preview.补充预览).toHaveLength(3)
    expect(f.save().ok).toBe(true)
    let seen: Readonly<Record<string, string>> | undefined
    registerCheck({ 名称: '补料消费验收', 审什么: '实际材料', 依赖材料: [], 执行形态: '确定性代码', 适用范围: '章', run(input) { seen = input.材料段; return [] } })
    const draft = loadDraftContext(f.root, key)
    const restored = rebuildResume(f.root, key)
    const review = computeReview(f.root, key)
    expect(review.ok).toBe(true)
    for (const materials of [draft.材料段, restored.injection.材料段, review.材料段, seen]) {
      const text = JSON.stringify(materials)
      expect(text).toContain('伏笔回收样本')
      expect(text).toContain('关系变化样本')
      expect(text).toContain('早期决策样本')
      expect(text).toContain('不是自动确认的事实')
    }
    expect(fs.readFileSync(path.join(f.root, '定稿/卷01/0001-章1.md'), 'utf8')).toBe(beforeSource)
  })

  it('普通重建保留快照，重复提交不重复添加，移除后不读取遗留附件', () => {
    const f = fixture()
    const p = f.preview()
    const input = { ...key, 材料清单哈希: p.已有清单哈希, 补充操作: p.补充预览!.map(item => item.操作) }
    expect(assembleMaterials(f.root, input).ok).toBe(true)
    const manifestPath = path.join(f.dir, '材料清单.json')
    const first = fs.readFileSync(manifestPath, 'utf8')
    expect(assembleMaterials(f.root, input).ok).toBe(true)
    expect(assembleMaterials(f.root, key).ok).toBe(true)
    expect(fs.readFileSync(manifestPath, 'utf8')).toBe(first)
    expect(f.save([{ 操作: '移除', 编号: 'decision' }]).ok).toBe(true)
    expect(fs.existsSync(path.join(f.dir, '补充/decision.md'))).toBe(true)
    expect(JSON.stringify(loadMaterialPackage(f.root, key).段)).not.toContain('早期决策样本')
    expect(loadMaterialPackage(f.root, key).补充).toHaveLength(2)
  })

  it('来源漂移保留旧摘录并报过期，三个消费方一致，旧审核失效', () => {
    const f = fixture()
    expect(f.save().ok).toBe(true)
    const reviewed = computeReview(f.root, key)
    expect(reviewed.ok).toBe(true)
    writeReviewRecord(f.root, key, reviewed.record!)
    expect(scanChapter(f.root, key).审核证据过期).toBe(false)
    const snapshot = fs.readFileSync(path.join(f.dir, '补充/relationship.md'), 'utf8')
    f.put(f.root, '世界书/人物档案/关系补记.md', '# 关系原文\n两人已经分道扬镳。【新关系不能静默替换】\n')
    const rebuilt = assembleMaterials(f.root, key)
    expect(rebuilt).toMatchObject({ ok: false, 状态: '已过期' })
    expect(fs.readFileSync(path.join(f.dir, '补充/relationship.md'), 'utf8')).toBe(snapshot)
    expect(JSON.stringify(rebuildResume(f.root, key).injection)).toContain('已过期')
    expect(JSON.stringify(loadDraftContext(f.root, key))).not.toContain('新关系不能静默替换')
    expect(scanChapter(f.root, key)).toMatchObject({ 审核证据过期: true, 材料包状态: '已过期' })
    expect(computeReview(f.root, key)).toMatchObject({ ok: false, reason: expect.stringContaining('材料需要核对') })
    expect(f.save([f.operations[1]!]).ok).toBe(true)
    expect(JSON.stringify(loadDraftContext(f.root, key))).toContain('新关系不能静默替换')
  })

  it('仅改附件也使旧审核失效，损坏内容不当作已核对原文消费', () => {
    const f = fixture()
    f.save()
    const review = computeReview(f.root, key)
    writeReviewRecord(f.root, key, review.record!)
    fs.appendFileSync(path.join(f.dir, '补充/earlier.md'), '篡改附件')
    expect(scanChapter(f.root, key).审核证据过期).toBe(true)
    const loaded = loadMaterialPackage(f.root, key)
    expect(loaded.问题.join(';')).toContain('附件哈希不匹配')
    expect(JSON.stringify(loaded.段)).not.toContain('篡改附件')
    expect(computeReview(f.root, key).ok).toBe(false)
  })

  it('预览后来源/材料包被修改时拒绝旧版本，清单不被覆盖', () => {
    const f = fixture()
    const p = f.preview()
    fs.appendFileSync(path.join(f.workspace, '书房/作者记忆/早期决定.md'), '修改')
    const stale = assembleMaterials(f.root, { ...key, 材料清单哈希: p.已有清单哈希, 补充操作: p.补充预览!.map(item => item.操作) })
    expect(stale.ok).toBe(false)
    expect(fs.existsSync(f.dir)).toBe(false)
    f.save()
    const old = f.preview([{ 操作: '移除', 编号: 'decision' }])
    f.save([{ 操作: '移除', 编号: 'relationship' }])
    const before = fs.readFileSync(path.join(f.dir, '材料清单.json'), 'utf8')
    expect(assembleMaterials(f.root, { ...key, 材料清单哈希: old.已有清单哈希, 补充操作: old.补充预览!.map(item => item.操作) }).ok).toBe(false)
    expect(fs.readFileSync(path.join(f.dir, '材料清单.json'), 'utf8')).toBe(before)
  })

  it.each(['escape', 'index', 'future', 'range', 'duplicate', 'link'])('%s来源/操作被拒绝且零落盘', kind => {
    const f = fixture()
    let op = structuredClone(f.operations[0]!)
    if (op.操作 !== '设置') throw new Error('fixture')
    if (kind === 'escape') op = { ...op, 来源: { 域: '本书', 路径: '../另一书/正文.md' } }
    if (kind === 'index') op = { ...op, 来源: { 域: '本书', 路径: '本书记忆/索引.md' } }
    if (kind === 'future') { f.put(f.root, '定稿/卷01/0004-未来.md', '未来正文'); op = { ...op, 来源: { 域: '本书', 路径: '定稿/卷01/0004-未来.md' } } }
    if (kind === 'range') op = { ...op, 来源: { ...op.来源, 起行: 99999 } }
    if (kind === 'link') {
      fs.symlinkSync(path.join(f.workspace, '书房'), path.join(f.root, '链接'), process.platform === 'win32' ? 'junction' : 'dir')
      op = { ...op, 来源: { 域: '本书', 路径: '链接/作者记忆/早期决定.md' } }
    }
    const p = f.preview(kind === 'duplicate' ? [op, op] : [op])
    expect(p.ok).toBe(false)
    expect(p.文件).toBeUndefined()
    expect(fs.existsSync(f.dir)).toBe(false)
  })

  it('旧十段包保留原审读身份，新增补充的字数计入同一清单', () => {
    const f = fixture()
    expect(assembleMaterials(f.root, key).ok).toBe(true)
    const old = loadMaterialPackage(f.root, key)
    expect(old.审读材料标识).toBe(old.清单)
    const result = f.save()
    const manifest = JSON.parse(fs.readFileSync(path.join(f.dir, '材料清单.json'), 'utf8'))
    expect(manifest.段).toHaveLength(13)
    expect(result.合计字数).toBe(manifest.段.reduce((sum: number, item: { 字数: number }) => sum + item.字数, 0))
  })

  it('清单最后落盘失败时，已更新附件和基础材料一起回滚', () => {
    const f = fixture()
    f.save()
    const manifestPath = path.join(f.dir, '材料清单.json')
    const oldManifest = fs.readFileSync(manifestPath, 'utf8')
    const oldAttachment = fs.readFileSync(path.join(f.dir, '补充/relationship.md'), 'utf8')
    f.put(f.root, '世界书/人物档案/关系补记.md', '关系更新待写入。')
    const prepared = f.preview([f.operations[1]!])
    const original = rename.renameSync
    let failed = false
    vi.spyOn(rename, 'renameSync').mockImplementation((source, target) => {
      if (!failed && target === manifestPath) { failed = true; throw new Error('material manifest write failed') }
      return original(source, target)
    })
    expect(() => assembleMaterials(f.root, { ...key, 材料清单哈希: prepared.已有清单哈希, 补充操作: prepared.补充预览!.map(p => p.操作) })).toThrow('material manifest write failed')
    expect(failed).toBe(true)
    expect(fs.readFileSync(manifestPath, 'utf8')).toBe(oldManifest)
    expect(fs.readFileSync(path.join(f.dir, '补充/relationship.md'), 'utf8')).toBe(oldAttachment)
  })

  it('坏清单、缺失附件与未来事实范围明确报出，不取未登记文件', () => {
    const f = fixture()
    f.save()
    fs.unlinkSync(path.join(f.dir, '补充/earlier.md'))
    expect(loadMaterialPackage(f.root, key).问题.join(';')).toContain('补充附件不可读')
    const manifestPath = path.join(f.dir, '材料清单.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.段.find((item: { 编号?: string }) => item.编号 === 'decision').文件 = '../../作者资料.md'
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    expect(computeReview(f.root, key).ok).toBe(false)
    expect(loadMaterialPackage(f.root, key).问题.join(';')).toContain('补充材料字段')
    const future = fixture()
    future.put(future.root, '世界书/人物档案/关系补记.md', '# 关系\n当前约定。\n### 事实@第 4 章\n未来关系。\n')
    expect(future.preview([future.operations[1]!]).ok).toBe(false)
    future.put(future.root, '世界书/人物档案/关系补记.md', '---\n来源: 定稿/卷01/0004-未来.md\n---\n未来来源不能补入第三章。')
    expect(future.preview([future.operations[1]!]).ok).toBe(false)
  })
})
