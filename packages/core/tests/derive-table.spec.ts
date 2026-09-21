import { describe, expect, it } from 'vitest'
import type { ChapterFacts } from '../src/derive/scan'
import { deriveChapterFacts } from '../src/derive/derive'

function facts(over: Partial<ChapterFacts> = {}): ChapterFacts {
  return {
    key: { 卷: 1, 章: 1, 章名: '初见' },
    窗口就绪: false, 候选细纲: false, 确认细纲: false, 材料包状态: null,
    有草稿: false, 唯一待审稿: false, 有审核记录: false, 审核完成: false,
    待定稿包完整: false, 裁决: null, 已定稿: false, 需复核标记: [],
    ...over,
  }
}

function row(d: ReturnType<typeof deriveChapterFacts>, n: number): boolean {
  return d.事实项.find((r) => r.row === n)!.事实
}

describe('§8 扫描事实项清单(R1:逐行如实报告+可选建议,无权威位置)', () => {
  it('行1 窗口就绪:该行事实成立,建议=行1', () => {
    const d = deriveChapterFacts(facts({ 窗口就绪: true }))
    expect(row(d, 1)).toBe(true)
    expect(d.建议).toEqual({ row: 1, 环节: '章细纲(待定位)' })
  })
  it('行2 候选细纲:该行事实成立,建议=行2', () => {
    const d = deriveChapterFacts(facts({ 候选细纲: true }))
    expect(row(d, 2)).toBe(true)
    expect(d.建议).toEqual({ row: 2, 环节: '章细纲(待确认)' })
  })
  it('行3 确认细纲:该行事实成立,与材料包中间态无关(事实清单不是位置)', () => {
    for (const 状态 of [null, '组装中', '段有缺', '有冲突', '已过期'] as const) {
      const d = deriveChapterFacts(facts({ 确认细纲: true, 材料包状态: 状态 }))
      expect(row(d, 3)).toBe(true)
      expect(row(d, 4)).toBe(false)
      expect(d.建议).toEqual({ row: 3, 环节: '写作备料' })
    }
  })
  it('行4 材料包段齐备:行3/行4 同时成立,建议取最靠后(行4)', () => {
    const d = deriveChapterFacts(facts({ 确认细纲: true, 材料包状态: '段齐备' }))
    expect(row(d, 3)).toBe(true)
    expect(row(d, 4)).toBe(true)
    expect(d.建议).toEqual({ row: 4, 环节: '写稿' })
  })
  it('行5 有草稿无待审→建议润色', () => {
    expect(deriveChapterFacts(facts({ 有草稿: true })).建议).toEqual({ row: 5, 环节: '润色' })
  })
  it('行6 唯一待审稿→建议审核', () => {
    expect(deriveChapterFacts(facts({ 唯一待审稿: true })).建议).toEqual({ row: 6, 环节: '审核' })
  })
  it('行7 有审核记录未处置→建议改稿', () => {
    expect(deriveChapterFacts(facts({ 有审核记录: true })).建议).toEqual({ row: 7, 环节: '改稿' })
  })
  it('行8 审核完成无包→建议定稿准备与沉淀', () => {
    const d = deriveChapterFacts(facts({ 有审核记录: true, 审核完成: true }))
    expect(row(d, 8)).toBe(true)
    expect(d.建议).toEqual({ row: 8, 环节: '定稿准备与沉淀' })
  })
  it('行9 包完整无裁决→建议作者定稿裁决(控制点)', () => {
    const d = deriveChapterFacts(facts({ 审核完成: true, 待定稿包完整: true }))
    expect(d.建议).toEqual({ row: 9, 环节: '作者定稿裁决' })
  })
  it('行10 已批准未入档:行9/行10 同时成立,建议取行10', () => {
    const d = deriveChapterFacts(facts({ 待定稿包完整: true, 裁决: '已批准' }))
    expect(row(d, 9)).toBe(true)
    expect(row(d, 10)).toBe(true)
    expect(d.建议).toEqual({ row: 10, 环节: '定稿入档' })
  })
  it('行11 定稿文件在→建议完成', () => {
    expect(deriveChapterFacts(facts({ 已定稿: true })).建议).toEqual({ row: 11, 环节: '完成' })
  })

  it('退回:包完整但已退回→行9/行10 不成立,建议回落改稿(行 7)', () => {
    const d = deriveChapterFacts(facts({ 审核完成: true, 待定稿包完整: true, 裁决: '已退回', 有审核记录: true }))
    expect(row(d, 9)).toBe(false)
    expect(row(d, 10)).toBe(false)
    expect(d.建议).toEqual({ row: 7, 环节: '改稿' })
  })
  it('叠加标记:需复核随结果返回,不影响事实与建议', () => {
    const d = deriveChapterFacts(facts({ 窗口就绪: true, 需复核标记: ['细纲'] }))
    expect(d.建议).toEqual({ row: 1, 环节: '章细纲(待定位)' })
    expect(d.叠加标记).toContain('细纲')
  })
  it('兜底:全行不成立→建议行1 并播报窗口无可进入项(建议仍无权威)', () => {
    const d = deriveChapterFacts(facts())
    expect(d.建议).toEqual({ row: 1, 环节: '章细纲(待定位)' })
    expect(d.叠加标记).toContain('窗口无可进入项→当前卷规划滚动补充')
  })
})
