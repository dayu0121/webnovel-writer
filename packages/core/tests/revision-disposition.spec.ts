import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  applyRevision, applyRevisionBatch, draftHashOf, normalizeFinding, parseDocument,
  paths, reviewInputFingerprintOf, reviewRecordHashOf, scanChapter, serializeDocument,
  type ReviewRecord,
} from '../src/index'
import * as rename from '../src/repo/rename'
import { removeSync } from '../src/repo/remove'

const roots: string[] = []
const key = { 卷: 1, 章: 1, 章名: '中文处置' }
const pendingRel = paths.草稿目录(1, key.章名) + '/稿1.md'
const reviewRel = paths.审核记录(1, key.章名)
afterAll(() => roots.forEach(root => removeSync(root)))
afterEach(() => vi.restoreAllMocks())

function fixture(count = 21, upstream = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-disposition-'))
  roots.push(root)
  const put = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), text)
  }
  const draft = serializeDocument({ 角色: '待审稿', 选定: true, 版本: 1 }, '他站在城门口。\n\n## 草稿候选事实\n\n- 事实：铜符仍在。')
  put(pendingRel, draft)
  const doc = parseDocument(draft)
  if (!doc.ok) throw new Error('bad fixture')
  const 方案 = { 动作: '全维审读', 理由: '回归', 跳过: [], 扩展说明: '不可丢失' }
  const record = {
    schemaVersion: 1, 完成: true, 审稿哈希: draftHashOf(doc.data.body),
    审读指纹: reviewInputFingerprintOf({ 正文: doc.data.body, 细纲: '', 材料清单: null, 方案 }),
    方案, 扩展证据: { 来源: '测试', 标记: ['保留'] },
    模块: { 设定核对: { 完成: true, 失败: false, 待回写: false, 扩展字段: 17 } },
    问题: Array.from({ length: count }, (_, i) => ({ ...normalizeFinding({
      审核编号: '审-01-0001', 模块名: '设定核对', 发现项编号: `f-${i + 1}`,
      严重程度: '中', 是否建议阻断: false, 证据位置: `第${i + 1}段`, 所依据材料及版本: '稿1@1',
      问题说明: `中文，标点“保留”😀 é #${i}`, 影响范围: upstream && i === 0 ? '世界书/人物档案/主角.md' : '正文',
      不确定性说明: '待作者判断', 修改建议: '核对来源', 建议返回节点: '改稿', 建议复审模块: '设定核对',
      材料完整性: '完整', 处置状态: i === 0 ? '待处理' : '作者保留', 处置说明: '原说明',
    })!, 扩展字段: { 定位: i } })),
  }
  put(reviewRel, JSON.stringify(record, null, 2) + '\n')
  put('世界书/人物档案/主角.md', '既有真源。')
  return { root, record, put, text: () => fs.readFileSync(path.join(root, reviewRel), 'utf8'), draft }
}

describe('处置只改所选字段，审核证据保持原始适用范围', () => {
  it.each([21, 128])('%i条记录的一次定点更新保留全部非处置字段和有效证据', count => {
    const f = fixture(count)
    const hash = scanChapter(f.root, key).审核记录哈希!
    expect(hash).toBe(reviewRecordHashOf(f.text()))
    const result = applyRevisionBatch(f.root, { ...key, 审核记录哈希: hash, 处置: [{ 发现项编号: 'f-1', 处置: '作者保留', 改动说明: '作者确认保留。' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.更新条数).toBe(1)
    expect(result.审核记录哈希).toBe(reviewRecordHashOf(f.text()))
    const expected = structuredClone(f.record)
    expected.问题[0]!.处置 = expected.问题[0]!.处置状态 = '作者保留'
    expected.问题[0]!.处置说明 = '作者确认保留。'
    expect(JSON.parse(f.text())).toEqual(expected)
    expect(scanChapter(f.root, key)).toMatchObject({ 审核完成: true, 审核证据过期: false })
    expect(fs.readFileSync(path.join(f.root, pendingRel), 'utf8')).toBe(f.draft)
  })

  it('上游条目允许纯保留/驳回，真源和Git HEAD不变，批次校验值可接续', () => {
    const f = fixture(21, true)
    const git = (...args: string[]) => execFileSync('git', args, { cwd: f.root, windowsHide: true, encoding: 'utf8' }).trim()
    git('init', '--quiet'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid')
    git('config', 'commit.gpgsign', 'false'); git('add', '.'); git('commit', '--quiet', '-m', 'fixture')
    const head = git('rev-parse', 'HEAD')
    const first = applyRevision(f.root, key, { 发现项编号: 'f-1', 处置: '作者保留', 改动说明: '不改上游', 审核记录哈希: reviewRecordHashOf(f.text()) })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = applyRevisionBatch(f.root, { ...key, 审核记录哈希: first.审核记录哈希, 处置: [{ 发现项编号: 'f-1', 处置: '已驳回' }] })
    expect(second.ok).toBe(true)
    expect(JSON.parse(f.text()).问题[0]).toMatchObject({ 处置状态: '已驳回', 处置说明: '不改上游' })
    expect(fs.readFileSync(path.join(f.root, '世界书/人物档案/主角.md'), 'utf8')).toBe('既有真源。')
    expect(git('rev-parse', 'HEAD')).toBe(head)
  })

  it('正文变更保留旧审读指纹而不伪造新稿已审', () => {
    const f = fixture()
    const result = applyRevisionBatch(f.root, { ...key, 新稿正文: '她离开城门。', 处置: [{ 发现项编号: 'f-1', 处置: '已解决' }] })
    expect(result.ok).toBe(true)
    expect(JSON.parse(f.text()).审读指纹).toBe(f.record.审读指纹)
    expect(scanChapter(f.root, key)).toMatchObject({ 审核完成: false, 审核证据过期: true })
  })

  it('旧校验值和非法校验值被拒绝，不覆盖其他写入者的处置', () => {
    const f = fixture()
    const oldHash = reviewRecordHashOf(f.text())
    expect(applyRevision(f.root, key, { 发现项编号: 'f-2', 处置: '已驳回', 审核记录哈希: oldHash }).ok).toBe(true)
    const before = f.text()
    expect(applyRevisionBatch(f.root, { ...key, 审核记录哈希: oldHash, 处置: [{ 发现项编号: 'f-1', 处置: '作者保留' }] })).toMatchObject({ ok: false, reason: expect.stringContaining('已变化') })
    expect(applyRevision(f.root, key, { 发现项编号: 'f-1', 处置: '作者保留', 审核记录哈希: 'bad' })).toMatchObject({ ok: false, reason: expect.stringContaining('格式无效') })
    expect(f.text()).toBe(before)
  })

  it.each(['duplicate-input', 'unknown-id', 'invalid-state', 'duplicate-record', 'broken-record', 'invalid-module'])('%s在任何改稿前拒绝，记录与原稿不变', condition => {
    const f = fixture()
    let dispositions = [{ 发现项编号: 'f-1', 处置: '已解决' as const }]
    if (condition === 'duplicate-input') dispositions = [...dispositions, ...dispositions]
    if (condition === 'unknown-id') dispositions.push({ 发现项编号: 'missing', 处置: '已解决' })
    if (condition === 'invalid-state') dispositions[0]!.处置 = '任意' as never
    if (condition === 'duplicate-record') { f.record.问题[1]!.发现项编号 = 'f-1'; f.put(reviewRel, JSON.stringify(f.record)) }
    if (condition === 'broken-record') f.put(reviewRel, '{broken')
    if (condition === 'invalid-module') f.put(reviewRel, JSON.stringify({ ...f.record, 模块: { broken: null } }))
    const before = f.text()
    const result = applyRevisionBatch(f.root, { ...key, 新稿正文: '不可写入', 处置: dispositions })
    expect(result.ok).toBe(false)
    expect(f.text()).toBe(before)
    expect(fs.readFileSync(path.join(f.root, pendingRel), 'utf8')).toBe(f.draft)
    expect(fs.readdirSync(path.join(f.root, paths.草稿目录(1, key.章名)))).toEqual(['稿1.md'])
  })

  it('上游实际修改不能借纯处置放行', () => {
    const f = fixture(21, true)
    const before = f.text()
    for (const disposition of ['已解决', '已接受修改'] as const) {
      expect(applyRevision(f.root, key, { 发现项编号: 'f-1', 处置: disposition })).toEqual({ ok: false, reason: '须呈报上游' })
    }
    expect(applyRevisionBatch(f.root, { ...key, 新稿正文: '新稿', 处置: [{ 发现项编号: 'f-1', 处置: '作者保留' }] })).toEqual({ ok: false, reason: '须呈报上游' })
    expect(f.text()).toBe(before)
  })

  it.each(['single', 'batch'])('%s落审核记录失败时回滚旧稿降级和新稿', mode => {
    const f = fixture()
    const before = f.text()
    const original = rename.renameSync
    let failed = false
    vi.spyOn(rename, 'renameSync').mockImplementation((source, target) => {
      if (!failed && target === path.join(f.root, reviewRel)) { failed = true; throw Object.assign(new Error('injected failure'), { code: 'EIO' }) }
      return original(source, target)
    })
    expect(() => mode === 'single'
      ? applyRevision(f.root, key, { 发现项编号: 'f-1', 处置: '已解决', 补丁: { old: '他站在城门口。', new: '她离开了。' } })
      : applyRevisionBatch(f.root, { ...key, 新稿正文: '她离开了。', 处置: [{ 发现项编号: 'f-1', 处置: '已解决' }] })).toThrow('injected failure')
    expect(failed).toBe(true)
    expect(f.text()).toBe(before)
    expect(fs.readFileSync(path.join(f.root, pendingRel), 'utf8')).toBe(f.draft)
    expect(fs.readdirSync(path.join(f.root, paths.草稿目录(1, key.章名)))).toEqual(['稿1.md'])
  })
})
