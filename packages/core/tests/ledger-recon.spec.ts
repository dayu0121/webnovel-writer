import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  LEDGER_NAMES,
  paths,
  queryLedger,
  reconcileBookLedger,
  reconcileLedger,
  seedMinDesign,
  writeFileAtomic,
} from '../src/index'
import { removeSync } from '../src/repo/remove'

const roots: string[] = []

function mkBook(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-ledger-recon-'))
  roots.push(root)
  seedMinDesign(root)
  for (const name of LEDGER_NAMES) {
    writeFileAtomic(root, paths.账本(name), `# ${name}\n`)
  }
  return root
}

afterAll(() => { for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

describe('故事账本当前态与对账', () => {
  it('同名账本条目按文件顺序归并为当前态', () => {
    const root = mkBook()
    writeFileAtomic(root, paths.账本('线索'), '# 线索\n\n## 纸鹤\n状态：已埋\n\n## 纸鹤\n状态：已示\n')
    const current = queryLedger(root, { 分类: '线索', 状态: '已埋' })
    expect(current.ok).toBe(true)
    if (current.ok) expect(current.entries).toHaveLength(0)
    const all = queryLedger(root, { 分类: '线索' })
    expect(all.ok).toBe(true)
    if (all.ok) expect(all.entries).toMatchObject([{ 名称: '纸鹤', 字段: { 状态: '已示' } }])
  })

  it('对账区分已匹配、计划未兑现和事实未计划', () => {
    const root = mkBook()
    writeFileAtomic(root, paths.计划时间线(1), '# 计划时间线\n\n## 窗口覆盖\n- 城门异响（先后：最先）〔已确认〕\n- 尚未发生的任务〔暂定〕\n- 与入城并行，间隔约两日\n\n## 备注\n- 待作者确认具体日期\n')
    writeFileAtomic(root, paths.账本('时间线'), '# 时间线\n\n## 城门异响\n事件：发现异常\n章号：第0001章\n\n## 临时发现\n事件：意外线索\n章号：第0001章\n')
    const result = reconcileLedger(root, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.状态).toBe('有偏离')
    expect(result.report.已匹配.map((item) => item.名称)).toEqual(['城门异响'])
    expect(result.report.计划未兑现.map((item) => item.名称)).toEqual(['尚未发生的任务'])
    expect(result.report.事实未计划.map((item) => item.名称)).toEqual(['临时发现'])
  })

  it('计划项以与/待/说开头不再被当噪声丢弃', () => {
    const root = mkBook()
    writeFileAtomic(root, paths.计划时间线(1), [
      '# 计划时间线',
      '',
      '## 窗口覆盖',
      '- 与师父决裂',
      '- 待宰的羔羊现身',
      '- 说服城主开门',
      '- 与入城并行，间隔约两日',
      '',
    ].join('\n'))
    const result = reconcileLedger(root, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.计划.map((item) => item.名称))
      .toEqual(['与师父决裂', '待宰的羔羊现身', '说服城主开门'])
    expect(result.report.计划未兑现.map((item) => item.名称))
      .toEqual(['与师父决裂', '待宰的羔羊现身', '说服城主开门'])
  })

  it('无法归类的计划行进入未归类清单而非静默消失', () => {
    const root = mkBook()
    writeFileAtomic(root, paths.计划时间线(1), [
      '# 计划时间线',
      '',
      '## 窗口覆盖',
      '- 城门异响',
      '- 与入城并行，间隔约两日',
      '',
    ].join('\n'))
    const result = reconcileLedger(root, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.计划.map((item) => item.名称)).toEqual(['城门异响'])
    expect(result.report.未归类计划行.map((item) => item.名称)).toEqual(['与入城并行，间隔约两日'])
    expect(result.report.未归类计划行[0]?.来源).toMatch(/计划时间线\.md#5$/)
  })

  it('计划时间线缺失的报错文案指向计划时间线而非账本', () => {
    const root = mkBook()
    removeSync(path.join(root, paths.计划时间线(1)))
    const result = reconcileLedger(root, 1)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('missing')
    expect(result.reason).not.toContain('账本文件不存在')
    expect(result.reason).toContain('计划时间线.md')
  })
})

describe('章级计划关联与对账三态(任务21, B1)', () => {
  it('①章级计划无事实 → 待核对(不报无偏离,不进计划未兑现)', () => {
    const root = mkBook()
    writeFileAtomic(root, paths.计划时间线(1), '# 计划时间线\n\n## 窗口覆盖\n- 第十二章 三签缺一（先后：最先）〔已确认〕\n')
    writeFileAtomic(root, paths.账本('时间线'), '# 时间线\n')
    const result = reconcileLedger(root, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.状态).toBe('待核对')
    expect(result.report.计划未兑现).toEqual([])
    expect(result.report.事实未计划).toEqual([])
    expect(result.report.章级待核对).toHaveLength(1)
    expect(result.report.章级待核对[0]).toMatchObject({ 章号: 12, 本章事实: [] })
  })

  it('②待核对与真实偏离并存 → 有偏离,两清单同屏', () => {
    const root = mkBook()
    writeFileAtomic(root, paths.计划时间线(1), '# 计划时间线\n\n## 窗口覆盖\n- 第十二章 三签缺一\n- 尚未发生的任务\n')
    writeFileAtomic(root, paths.账本('时间线'), '# 时间线\n\n## 临时发现\n事件：意外线索\n章号：第0003章\n')
    const result = reconcileLedger(root, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.状态).toBe('有偏离')
    expect(result.report.计划未兑现.map((i) => i.名称)).toEqual(['尚未发生的任务'])
    expect(result.report.事实未计划.map((i) => i.名称)).toEqual(['临时发现'])
    expect(result.report.章级待核对).toHaveLength(1)
  })

  it('⑤同章事件与计划项精确同名 → 已匹配,不进待核对', () => {
    const root = mkBook()
    writeFileAtomic(root, paths.计划时间线(1), '# 计划时间线\n\n## 窗口覆盖\n- 第十二章 三签缺一\n')
    writeFileAtomic(root, paths.账本('时间线'), '# 时间线\n\n## 第十二章 三签缺一\n事件：画指一栏空白\n章号：第0012章\n')
    const result = reconcileLedger(root, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.状态).toBe('无偏离')
    expect(result.report.已匹配.map((i) => i.名称)).toEqual(['第十二章 三签缺一'])
    expect(result.report.章级待核对).toEqual([])
  })

  it('⑥不同章号事实不关联:本章事实为空,事件仍列事实未计划', () => {
    const root = mkBook()
    writeFileAtomic(root, paths.计划时间线(1), '# 计划时间线\n\n## 窗口覆盖\n- 第十二章 三签缺一\n')
    writeFileAtomic(root, paths.账本('时间线'), '# 时间线\n\n## 船帮夜载\n事件：深夜换载\n章号：第0013章\n')
    const result = reconcileLedger(root, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.章级待核对[0]?.本章事实).toEqual([])
    expect(result.report.事实未计划.map((i) => i.名称)).toEqual(['船帮夜载'])
    expect(result.report.状态).toBe('有偏离')
  })

  it('⑦章级计划＋同章无关事件 → 有偏离(事实未计划)且保留待核对', () => {
    const root = mkBook()
    writeFileAtomic(root, paths.计划时间线(1), '# 计划时间线\n\n## 窗口覆盖\n- 第十二章 三签缺一\n')
    writeFileAtomic(root, paths.账本('时间线'), '# 时间线\n\n## 船帮夜载\n事件：深夜换载\n章号：第0012章\n')
    const result = reconcileLedger(root, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.状态).toBe('有偏离')
    expect(result.report.事实未计划.map((i) => i.名称)).toEqual(['船帮夜载'])
    expect(result.report.章级待核对).toHaveLength(1)
    expect(result.report.章级待核对[0]?.本章事实.map((i) => i.名称)).toEqual(['船帮夜载'])
  })

  it('④全书汇总:任一卷待核对 → 书级非无偏离', () => {
    const root = mkBook()
    writeFileAtomic(root, paths.计划时间线(1), '# 计划时间线\n\n## 窗口覆盖\n- 第十二章 三签缺一\n')
    const book = reconcileBookLedger(root)
    expect(book.ok).toBe(true)
    if (!book.ok) return
    expect(book.report.状态).toBe('待核对')
    expect(book.report.状态).not.toBe('无偏离')
  })
})
