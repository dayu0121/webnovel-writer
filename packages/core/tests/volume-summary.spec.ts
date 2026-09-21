import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { computeVolumeSummaryCandidate, parseDocument, paths, prepareVolumeSummary, seedMinDesign, serializeDocument, writeFileAtomic } from '../src/index'
import { removeSync } from '../src/repo/remove'

const roots: string[] = []
function mkBook(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-volsum-'))
  roots.push(dir)
  seedMinDesign(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放 */ } } })

/** 卷一 N 章定稿；章摘要按 needSummaries 决定是否写齐；另附账本线索与卷纲卷末兑现。 */
function mkVolumeBook(root: string, chapters: number, opts: { 缺摘要?: number[] } = {}): void {
  writeFileAtomic(root, paths.卷纲(1), [
    '# 卷纲', '', '卷01｜1 案／3 章，单章约 100 字', '',
    '## 叙事结构 〔已确认〕', '', '三章立规矩', '',
    '## 弧线 〔已确认〕', '', 'x', '',
    '## 线索推进 〔已确认〕', '', 'x', '',
    '## 卷末兑现 〔已确认〕', '', '- 结案 1 案，真凶点明。', '- 主角付出代价。', '',
  ].join('\n'))
  for (let n = 1; n <= chapters; n += 1) {
    const name = `第${n}案`
    const fin = path.join(root, `定稿/卷01/${String(n).padStart(4, '0')}-${name}.md`)
    fs.mkdirSync(path.dirname(fin), { recursive: true })
    fs.writeFileSync(fin, serializeDocument({ 状态: '已定稿' }, `第${n}章正文`), 'utf-8')
    if (opts.缺摘要?.includes(n)) continue
    const sum = path.join(root, paths.章摘要(1, n, name))
    fs.mkdirSync(path.dirname(sum), { recursive: true })
    fs.writeFileSync(sum, `# 章摘要\n\n${name}摘要：灯灭之因第${n}步。`, 'utf-8')
  }
  for (const name of ['故事线', '人物弧线', '承诺', '时间线'] as const) {
    writeFileAtomic(root, paths.账本(name), `# ${name}\n`)
  }
  writeFileAtomic(root, paths.账本('线索'), '# 线索\n\n## 铜托座\n状态：已收\n埋设点：第0001章\n\n### 正文\n铜托座有新磕痕，与灯竿同源。\n\n## 糖纸\n状态：已埋\n埋设点：第0002章\n\n### 正文\n甜味引向第二案。\n')
}

describe('卷摘要候选与落盘(任务21, 件一/AC2)', () => {
  it('章摘要齐全 → 候选含章摘要汇编/线索收束/卷末兑现;只算不写', () => {
    const root = mkBook()
    mkVolumeBook(root, 3)
    const before = fs.existsSync(path.join(root, paths.卷摘要(1)))
    const r = computeVolumeSummaryCandidate(root, 1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.候选).toContain('第1案摘要')
    expect(r.候选).toContain('第3案摘要')
    expect(r.候选).toContain('铜托座〔已收〕')
    expect(r.候选).toContain('糖纸〔已埋〕')
    expect(r.候选).toContain('结案 1 案，真凶点明')
    expect(r.章摘要来源).toHaveLength(3)
    // 只算不写:不产卷摘要文件
    expect(fs.existsSync(path.join(root, paths.卷摘要(1)))).toBe(before)
  })

  it('缺章摘要 → 如实报缺清单,不产候选不落盘', () => {
    const root = mkBook()
    mkVolumeBook(root, 3, { 缺摘要: [2] })
    const r = computeVolumeSummaryCandidate(root, 1)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.缺章摘要).toEqual([2])
    expect(r.reason).toContain('报缺')
    expect(fs.existsSync(path.join(root, paths.卷摘要(1)))).toBe(false)
  })

  it('无定稿章 → 如实报缺', () => {
    const root = mkBook()
    const r = computeVolumeSummaryCandidate(root, 1)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.缺章摘要).toEqual([])
    expect(r.reason).toContain('无定稿章')
  })

  it('落盘:首次 v1、原样重跑复用版本、正文变化 v2 父版本 1', () => {
    const root = mkBook()
    mkVolumeBook(root, 3)
    const c = computeVolumeSummaryCandidate(root, 1)
    if (!c.ok) throw new Error('候选生成失败')
    const op1 = prepareVolumeSummary(root, 1, c.候选)
    fs.mkdirSync(path.join(root, path.dirname(paths.卷摘要(1))), { recursive: true })
    fs.writeFileSync(path.join(root, op1.relPath), op1.content, 'utf-8')
    expect(op1.result.版本).toBe(1)
    expect(op1.result.首次写入).toBe(true)
    const doc1 = parseDocument(fs.readFileSync(path.join(root, paths.卷摘要(1)), 'utf-8'))
    expect(doc1.ok && doc1.data.fields['状态']).toBe('已确认')
    expect(doc1.ok && doc1.data.fields['生成模块']).toBe('卷摘要确认')

    const op2 = prepareVolumeSummary(root, 1, c.候选)
    expect(op2.result.版本).toBe(1)
    expect(op2.result.首次写入).toBe(false)
    expect(op2.content).toBe(fs.readFileSync(path.join(root, paths.卷摘要(1)), 'utf-8'))

    const op3 = prepareVolumeSummary(root, 1, `${c.候选}\n补一行修订。\n`)
    expect(op3.result.版本).toBe(2)
    const doc3 = parseDocument(op3.content)
    expect(doc3.ok && doc3.data.fields['父版本']).toBe(1)
  })
})

describe('卷摘要事实边界与账本失败(F21-1/F21-2)', () => {
  function mkLedgerBook(root: string, chapters: number, ledgerText: string | null): void {
    mkVolumeBook(root, chapters)
    // 账本五件齐(故事线/人物弧线/承诺/时间线空壳,线索按用例覆写或删除)
    for (const name of ['故事线', '人物弧线', '承诺', '时间线'] as const) {
      writeFileAtomic(root, paths.账本(name), `# ${name}\n`)
    }
    if (ledgerText === null) {
      removeSync(path.join(root, paths.账本('线索')))
    } else {
      writeFileAtomic(root, paths.账本('线索'), ledgerText)
    }
  }

  it('①后卷新增秘密不入旧卷摘要(埋设点第9章超过卷末)', () => {
    const root = mkBook()
    mkLedgerBook(root, 1, '# 线索\n\n## 秘密\n状态：已埋\n埋设点：第0009章\n\n### 正文\nFUTURE_ONLY_SECRET。\n')
    const r = computeVolumeSummaryCandidate(root, 1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.候选).not.toContain('FUTURE_ONLY_SECRET')
    expect(r.候选).not.toContain('秘密')
  })

  it('②同一线索后卷已收/更新正文,旧卷摘要保留当时状态与正文(不回流不消失)', () => {
    const root = mkBook()
    mkLedgerBook(root, 3, [
      '# 线索', '',
      '## 灯油账', '状态：已埋', '埋设点：第0002章', '',
      '### 正文', '油里掺水，账上多记三成。', '',
      '## 灯油账', '状态：已收', '埋设点：第0002章', '实际落点：定稿/卷02/0009-第九章.md', '',
      '### 正文', 'FUTURE_STATE_后卷已收正文。', '',
    ].join('\n'))
    const r = computeVolumeSummaryCandidate(root, 1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.候选).toContain('灯油账〔已埋〕')
    expect(r.候选).toContain('油里掺水')
    expect(r.候选).not.toContain('FUTURE_STATE')
    expect(r.候选).not.toContain('灯油账〔已收〕')
  })

  it('③卷内正常线索与合理延续线索(已收/已示)均保留', () => {
    const root = mkBook()
    mkLedgerBook(root, 3, [
      '# 线索', '',
      '## 铜灯钩', '状态：已收', '埋设点：第0001章', '',
      '### 正文', '钩上新划痕。', '',
      '## 灯油账', '状态：已示', '埋设点：第0002章', '预期兑现区间：第4-6章', '',
      '### 正文', '账目存疑，卷二再接。', '',
    ].join('\n'))
    const r = computeVolumeSummaryCandidate(root, 1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.候选).toContain('铜灯钩〔已收〕')
    expect(r.候选).toContain('灯油账〔已示〕')
    expect(r.候选).toContain('账目存疑')
  })

  it('④无法判定发生时点的条目报边界不明,不静默当作卷内事实', () => {
    const root = mkBook()
    mkLedgerBook(root, 1, '# 线索\n\n## 无根线索\n状态：已埋\n计划来源：大纲/分卷布局.md@1\n\n### 正文\n无时点。\n')
    const r = computeVolumeSummaryCandidate(root, 1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.线索边界不明).toEqual(['无根线索'])
    expect(r.候选).not.toContain('无根线索〔已埋〕')
    expect(r.候选).toContain('边界不明')
  })

  it('⑤删线索账本(missing) → 不产候选不落盘,报可操作缺失信息', () => {
    const root = mkBook()
    mkLedgerBook(root, 1, null)
    const r = computeVolumeSummaryCandidate(root, 1)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('账本')
    expect(fs.existsSync(path.join(root, paths.卷摘要(1)))).toBe(false)
  })

  it('⑥账本损坏(parse-error) → 不产候选,报解析信息', () => {
    const root = mkBook()
    mkLedgerBook(root, 1, '# 线索\n\n## 坏条目\n状态：已埋\n状态：已示\n\n### 正文\n重复字段。\n')
    const r = computeVolumeSummaryCandidate(root, 1)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('解析')
    expect(fs.existsSync(path.join(root, paths.卷摘要(1)))).toBe(false)
  })

  it('⑦部分账本可读但整体 ok:false(他卷账本损坏) → 仍不产候选', () => {
    const root = mkBook()
    mkLedgerBook(root, 1, '# 线索\n\n## 铜灯钩\n状态：已收\n埋设点：第0001章\n\n### 正文\n钩上新划痕。\n')
    writeFileAtomic(root, paths.账本('故事线'), '# 故事线\n\n## 坏\n状态：进行中\n状态：已结束\n')
    const r = computeVolumeSummaryCandidate(root, 1)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('解析')
  })

  it('⑧成功空线索 → 候选如实写无线索(ok:true)', () => {
    const root = mkBook()
    mkLedgerBook(root, 1, '# 线索\n')
    const r = computeVolumeSummaryCandidate(root, 1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.候选).toContain('无已收或进行中线索')
    expect(r.线索边界不明).toEqual([])
  })
})
