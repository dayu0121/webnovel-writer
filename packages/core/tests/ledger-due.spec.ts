import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  LEDGER_NAMES,
  paths,
  queryDueLedger,
  queryLedger,
  reconcileBookLedger,
  reconcileLedger,
  seedMinDesign,
  writeFileAtomic,
} from '../src/index'

const roots: string[] = []

function mkBook(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-ledger-due-'))
  roots.push(root)
  seedMinDesign(root)
  for (const name of LEDGER_NAMES) {
    writeFileAtomic(root, paths.账本(name), `# ${name}\n`)
  }
  return root
}

afterAll(() => { for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

function listRel(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, prefix: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === '' ? ent.name : `${prefix}/${ent.name}`
      if (ent.isDirectory()) walk(path.join(dir, ent.name), rel)
      else out.push(rel.replaceAll('\\', '/'))
    }
  }
  walk(root, '')
  return out.sort()
}

describe('账本到期与跨卷对账', () => {
  it('到期查询只返回已埋/已示线索，章区间进入才到期，怪格式进区间不明', () => {
    const root = mkBook()
    writeFileAtomic(root, paths.账本('线索'), [
      '# 线索',
      '',
      '## 纸鹤',
      '状态：已埋',
      '计划来源：卷纲#4',
      '埋设点：第1章',
      '预期兑现区间：第8-12章',
      '',
      '## 已收线',
      '状态：已收',
      '计划来源：卷纲#5',
      '埋设点：第1章',
      '预期兑现区间：第8-12章',
      '',
      '## 已弃线',
      '状态：已弃',
      '计划来源：卷纲#6',
      '埋设点：第1章',
      '预期兑现区间：第8-12章',
      '弃因：砍掉',
      '',
      '## 怪格式',
      '状态：已示',
      '计划来源：卷纲#7',
      '埋设点：第1章',
      '预期兑现区间：大约年底',
      '',
      '## 卷线索',
      '状态：已埋',
      '计划来源：卷纲#8',
      '埋设点：第1章',
      '预期兑现区间：卷一',
      '',
      '## 信物',
      '状态：已示',
      '计划来源：卷纲#9',
      '埋设点：第1章',
      '预期兑现区间：第8—12章',
      '',
    ].join('\n'))
    writeFileAtomic(root, paths.账本('承诺'), [
      '# 承诺',
      '',
      '## 到期承诺',
      '状态：进行中',
      '计划来源：卷纲#1',
      '预期兑现区间：第8-12章',
      '',
    ].join('\n'))
    const before = queryDueLedger(root, { 卷: 1, 章: 7 })
    expect(before.ok).toBe(true)
    if (!before.ok) return
    expect(before.到期.map((item) => item.名称)).toEqual(['卷线索'])
    expect(before.到期.map((item) => item.名称)).not.toContain('纸鹤')
    expect(before.到期.map((item) => item.名称)).not.toContain('信物')
    expect(before.到期.map((item) => item.名称)).not.toContain('已收线')
    expect(before.到期.map((item) => item.名称)).not.toContain('已弃线')
    expect(before.区间不明.map((item) => item.名称)).toEqual(['怪格式'])
    const due = queryDueLedger(root, { 卷: 1, 章: 8 })
    expect(due.ok).toBe(true)
    if (!due.ok) return
    expect(due.到期.map((item) => item.名称)).toEqual(['纸鹤', '卷线索', '信物'])
    expect(due.到期.some((item) => item.名称 === '已收线' || item.名称 === '已弃线')).toBe(false)
    expect(due.到期.map((item) => item.名称)).not.toContain('到期承诺')
    expect(due.区间不明.map((item) => item.名称)).toEqual(['怪格式'])
    expect(due.到期[0]).toMatchObject({
      名称: '纸鹤',
      状态: '已埋',
      预期兑现区间: '第8-12章',
      计划来源: '卷纲#4',
      来源文件: paths.账本('线索'),
    })
  })

  it('账本缺失时到期查询返回 kind，并保留已读线索派生项', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-ledger-due-'))
    roots.push(root)
    seedMinDesign(root)
    for (const name of LEDGER_NAMES) {
      if (name === '时间线') continue
      writeFileAtomic(root, paths.账本(name), `# ${name}\n`)
    }
    writeFileAtomic(root, paths.账本('线索'), '# 线索\n\n## 纸鹤\n状态：已埋\n计划来源：卷纲#4\n埋设点：第1章\n预期兑现区间：第8-12章\n')
    const result = queryDueLedger(root, { 卷: 1, 章: 8 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('missing')
    expect(result.file).toBe(paths.账本('时间线'))
    expect(result.到期.map((item) => item.名称)).toEqual(['纸鹤'])
  })

  it('故事线解析失败时到期查询仍带 kind，并保留已读线索派生项', () => {
    const root = mkBook()
    writeFileAtomic(root, paths.账本('故事线'), '# 故事线\n\n## 重复\n状态：进行中\n状态：已兑现\n')
    writeFileAtomic(root, paths.账本('线索'), '# 线索\n\n## 纸鹤\n状态：已埋\n计划来源：卷纲#4\n埋设点：第1章\n预期兑现区间：第8-12章\n')
    const result = queryDueLedger(root, { 卷: 1, 章: 8 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('parse-error')
    expect(result.到期.map((item) => item.名称)).toEqual(['纸鹤'])
  })

  it('两卷书中卷2事实不进入卷1事实未计划，全书对账分卷汇总', () => {
    const root = mkBook()
    writeFileAtomic(root, paths.计划时间线(1), '# 计划时间线\n\n## 窗口覆盖\n- 城门异响〔已确认〕\n')
    writeFileAtomic(root, paths.计划时间线(2), '# 计划时间线\n\n## 窗口覆盖\n- 卷二后事〔已确认〕\n')
    writeFileAtomic(root, paths.账本('时间线'), [
      '# 时间线',
      '',
      '## 城门异响',
      '事件：发现异常',
      '实际落点：定稿/卷01/0001-开篇任务.md',
      '',
      '## 卷二后事',
      '事件：后事',
      '来源：定稿/卷02/0002-后事.md',
      '',
      '## 无路径事件',
      '事件：无法归属',
      '章号：第0003章',
      '',
    ].join('\n'))
    const volume1 = reconcileLedger(root, 1)
    expect(volume1.ok).toBe(true)
    if (!volume1.ok) return
    expect(volume1.report.已匹配.map((item) => item.名称)).toEqual(['城门异响'])
    expect(volume1.report.事实未计划.map((item) => item.名称)).not.toContain('卷二后事')
    expect(volume1.report.事实未计划.map((item) => item.名称)).not.toContain('无路径事件')
    const volume2 = reconcileLedger(root, 2)
    expect(volume2.ok).toBe(true)
    if (!volume2.ok) return
    expect(volume2.report.已匹配.map((item) => item.名称)).toEqual(['卷二后事'])
    expect(volume2.report.事实未计划.map((item) => item.名称)).not.toContain('无路径事件')
    const book = reconcileBookLedger(root)
    expect(book.ok).toBe(true)
    if (!book.ok) return
    expect(book.report.各卷.map((report) => report.卷)).toEqual([1, 2])
    expect(book.report.未归属事实.map((item) => item.名称)).toEqual(['无路径事件'])
    expect(book.report.状态).toBe('有偏离')
  })

  it('仅多出规划目录、尚无计划时间线时，无路径与他卷路径事实都不进入本卷事实未计划', () => {
    const root = mkBook()
    writeFileAtomic(root, paths.计划时间线(1), '# 计划时间线\n\n## 窗口覆盖\n- 城门异响〔已确认〕\n')
    writeFileAtomic(root, paths.卷纲(2), '# 卷纲\n')
    writeFileAtomic(root, paths.账本('时间线'), [
      '# 时间线',
      '',
      '## 城门异响',
      '事件：发现异常',
      '实际落点：定稿/卷01/0001-开篇任务.md',
      '',
      '## 卷二已落',
      '事件：后事',
      '来源：定稿/卷02/0002-后事.md',
      '',
      '## 无路径事件',
      '事件：无法归属',
      '章号：第0003章',
      '',
    ].join('\n'))
    const volume1 = reconcileLedger(root, 1)
    expect(volume1.ok).toBe(true)
    if (!volume1.ok) return
    expect(volume1.report.已匹配.map((item) => item.名称)).toEqual(['城门异响'])
    expect(volume1.report.事实未计划.map((item) => item.名称)).not.toContain('卷二已落')
    expect(volume1.report.事实未计划.map((item) => item.名称)).not.toContain('无路径事件')
    const book = reconcileBookLedger(root)
    expect(book.ok).toBe(true)
    if (!book.ok) return
    expect(book.report.各卷.map((report) => report.卷)).toEqual([1])
    expect(book.report.未归属事实.map((item) => item.名称)).toEqual(['卷二已落', '无路径事件'])
    expect(book.report.状态).toBe('有偏离')
  })

  it('到期项区分刚到期与已逾期，逾期带超出幅度', () => {
    const root = mkBook()
    writeFileAtomic(root, paths.账本('线索'), [
      '# 线索',
      '',
      '## 纸鹤',
      '状态：已埋',
      '计划来源：卷纲#4',
      '埋设点：第1章',
      '预期兑现区间：第8-12章',
      '',
      '## 单章线',
      '状态：已示',
      '计划来源：卷纲#5',
      '埋设点：第1章',
      '预期兑现区间：第20章',
      '',
      '## 卷线索',
      '状态：已埋',
      '计划来源：卷纲#6',
      '埋设点：第1章',
      '预期兑现区间：卷一',
      '',
    ].join('\n'))

    // 第 10 章:落在 8-12 区间内 → 到期未逾期
    const 区间内 = queryDueLedger(root, { 卷: 1, 章: 10 })
    expect(区间内.ok).toBe(true)
    if (!区间内.ok) return
    expect(区间内.到期.find((i) => i.名称 === '纸鹤')?.逾期).toBe(false)
    expect(区间内.逾期.map((i) => i.名称)).toEqual([])

    // 第 30 章:超过上界 12 共 18 章 → 逾期
    const 已逾期 = queryDueLedger(root, { 卷: 1, 章: 30 })
    expect(已逾期.ok).toBe(true)
    if (!已逾期.ok) return
    const 纸鹤 = 已逾期.到期.find((i) => i.名称 === '纸鹤')
    expect(纸鹤?.逾期).toBe(true)
    expect(纸鹤?.超出幅度).toBe(18)
    // 单章区间的上界等于下界
    const 单章 = 已逾期.到期.find((i) => i.名称 === '单章线')
    expect(单章?.逾期).toBe(true)
    expect(单章?.超出幅度).toBe(10)
    // 卷级区间只有下界,不判逾期
    expect(已逾期.到期.find((i) => i.名称 === '卷线索')?.逾期).toBe(false)
    expect(已逾期.逾期.map((i) => i.名称)).toEqual(['纸鹤', '单章线'])
    // 逾期是到期的子集
    for (const item of 已逾期.逾期) expect(已逾期.到期).toContain(item)
  })

  it('到期与全书对账不写真源，卷纲保持不变', () => {
    const root = mkBook()
    writeFileAtomic(root, paths.账本('线索'), '# 线索\n\n## 纸鹤\n状态：已埋\n计划来源：卷纲#4\n埋设点：第1章\n预期兑现区间：第8-12章\n')
    const outline = fs.readFileSync(path.join(root, paths.卷纲(1)), 'utf-8')
    const files = listRel(root)
    queryDueLedger(root, { 卷: 1, 章: 8 })
    reconcileBookLedger(root)
    expect(fs.readFileSync(path.join(root, paths.卷纲(1)), 'utf-8')).toBe(outline)
    expect(listRel(root)).toEqual(files)
  })

  it('重复系统字段返回 parse-error 且行号指向实际行', () => {
    const malformed = mkBook()
    writeFileAtomic(malformed, paths.账本('故事线'), '# 故事线\n\n## 重复\n状态：进行中\n状态：已兑现\n')
    const malformedResult = queryLedger(malformed, { 分类: '故事线' })
    expect(malformedResult.ok).toBe(false)
    if (!malformedResult.ok) {
      expect(malformedResult.kind).toBe('parse-error')
      expect(malformedResult.reason).toMatch(/:5:字段重复/)
    }
  })
})
