import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  checkConceptCompleteness,
  deleteNote,
  destOf,
  ingestNote,
  listNotes,
  parseConcept,
  routeIntake,
  searchNotes,
  serializeConcept,
  type Concept,
} from '../src/inspire'

const roots: string[] = []
function mkRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-inspire-'))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

function confirmed(over: Partial<Concept> = {}): Concept {
  return {
    状态: '已确认',
    核心创意: '被系统选中的普通人',
    题材与目标读者: '都市异能向网文读者',
    ...over,
  }
}

describe('构想完整度(插件规格 §5 / PRD §3.1)', () => {
  it('构想缺失→不通过', () => {
    expect(checkConceptCompleteness(null).ok).toBe(false)
    expect(checkConceptCompleteness(undefined).ok).toBe(false)
    const r = checkConceptCompleteness(null)
    if (!r.ok) expect(r.gaps).toContain('构想不存在')
  })

  it('必填留白或空→不通过', () => {
    const blankCore = checkConceptCompleteness(confirmed({ 核心创意: '留白' }))
    expect(blankCore.ok).toBe(false)
    if (!blankCore.ok) expect(blankCore.gaps).toContain('核心创意')

    const emptyGenre = checkConceptCompleteness(confirmed({ 题材与目标读者: '' }))
    expect(emptyGenre.ok).toBe(false)
    if (!emptyGenre.ok) expect(emptyGenre.gaps).toContain('题材与目标读者')
  })

  it('未确认→不通过', () => {
    const r = checkConceptCompleteness(confirmed({ 状态: '候选' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.gaps).toContain('构想未确认')
  })

  it('必填已确认、可选留白→通过,且不代填', () => {
    const c = confirmed({
      主角核心欲望: '留白',
      主要冲突: '',
      核心看点: '〔留白〕',
    })
    expect(checkConceptCompleteness(c)).toEqual({ ok: true })
    expect(c.主角核心欲望).toBe('留白')
    expect(c.主要冲突).toBe('')
  })

  it('Markdown 往返保留七要素与状态', () => {
    const c = confirmed({ 明确不要什么: '不写后宫' })
    const text = serializeConcept(c)
    expect(text).toContain('核心创意')
    expect(text).toContain('〔已确认〕')
    const parsed = parseConcept(text)
    expect(parsed).not.toBeNull()
    expect(parsed?.状态).toBe('已确认')
    expect(parsed?.核心创意).toContain('被系统选中的普通人')
    expect(checkConceptCompleteness(text)).toEqual({ ok: true })
  })
})

describe('作者层灵感池', () => {
  it('ingest/list/delete/search 落盘且跨读可见', () => {
    const author = mkRoot()
    const id = ingestNote(author, '夜里忽然想到的金手指')
    expect(id.length).toBeGreaterThan(0)
    expect(listNotes(author).map((n) => n.body)).toContain('夜里忽然想到的金手指')

    const again = listNotes(author)
    expect(again).toHaveLength(1)
    expect(searchNotes(author, '金手指')).toHaveLength(1)
    expect(searchNotes(author, '没有这个')).toHaveLength(0)

    expect(deleteNote(author, id)).toBe(true)
    expect(listNotes(author)).toHaveLength(0)
    expect(fs.existsSync(path.join(author, '记忆/灵感', `${id}.md`))).toBe(false)
  })
})

describe('参考摄入三分流', () => {
  it('设定/文风/方法各走对应提案域,不写真源', () => {
    expect(destOf('设定候选')).toBe('书仓提案')
    expect(destOf('文风候选')).toBe('记忆提案')
    expect(destOf('方法候选')).toBe('方法库提案')

    const author = mkRoot()
    const r = routeIntake('某本参考书的设定摘录', '设定候选', author)
    expect(r.dest).toBe('书仓提案')
    expect(r.proposal.source).toContain('设定摘录')
    const files = fs.readdirSync(path.join(author, '提案'))
    expect(files.some((f) => f.endsWith('.md'))).toBe(true)
    expect(fs.existsSync(path.join(author, '世界书'))).toBe(false)
  })
})
