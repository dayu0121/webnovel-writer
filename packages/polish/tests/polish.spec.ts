import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  assembleMaterials,
  confirmOutline,
  countPendingReviewDrafts,
  deriveChapterFacts,
  listChapterDrafts,
  parseDocument,
  scanChapter,
  seedMinDesign,
  writeCandidate,
} from '@webnovel/core'
import { writeDraft } from '@webnovel/drafting'
import { polishDraft } from '../src/index'

const roots: string[] = []
function mkBook(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-polish-'))
  roots.push(dir)
  seedMinDesign(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const
const refs = ['作品契约/契约.md@1', '世界书/人物档案/主角.md@1'] as const
// Fidelity can only prove explicit text-presence rules. Semantic constraints
// are covered by review's needs-semantic-review path.
const HARD = '本章必须出现主角'

function confirmWithHard(root: string): void {
  const body = [
    '# 章细纲',
    '',
    '## 定位段',
    '',
    '### 来源窗口项及拆并关系',
    '开篇任务，单章承接',
    '',
    '### 章节功能',
    '',
    `- 〔硬〕${HARD}`,
    '',
    '### 视角与焦点',
    '主角视角',
    '',
    '### 时空锚定',
    '城门口，清晨',
    '',
    '### 起止边界',
    '从抵达城门到发现异状',
    '',
    '### 故事线与承诺分配',
    '推进主线承诺',
    '',
    '### 信息边界',
    '只披露主角所见',
    '',
    '### 情绪与节奏目标',
    '紧张后留钩子',
    '',
    '### 前置条件核对结果',
    '已核对来源与窗口，前置设定均非留白',
    '',
    '## 细纲段',
    '',
    '### 单元 1',
    '',
    '- 目标: 开场',
    '- 人物: 主角',
    '- 时空: 城门口',
    '- 行动/冲突: 盘问与发现',
    '- 信息披露: 异常线索',
    '- 状态变化: 从平静到警觉',
    '',
  ].join('\n')
  writeCandidate(root, { 卷: 1, 章: 1, 章名: '开篇任务', 来源引用: refs, body })
  const r = confirmOutline(root, key)
  if (!r.ok) throw new Error(`confirm failed:${r.gaps.join(';')}`)
}

function readyDraft(root: string, body: string): void {
  confirmWithHard(root)
  const assembled = assembleMaterials(root, key)
  if (!assembled.ok) throw new Error(`assemble failed:${assembled.gaps.join(';')}`)
  const w = writeDraft(root, { ...key, body, 选定: true })
  if (!w.ok) throw new Error(`writeDraft failed:${w.gaps.join(';')}`)
}

describe('去AI痕迹润色', () => {
  it('AI-ish opener removed', () => {
    const root = mkBook()
    readyDraft(root, `综上所述，巷口风大，灯影斜在青石板上。${HARD}。他没有回头，只把伞往肩上挪了挪。`)
    const r = polishDraft(root, key)
    expect(r.ok).toBe(true)
    const text = fs.readFileSync(path.join(root, r.relPath), 'utf-8')
    expect(text).not.toContain('综上所述')
    expect(text).toContain(HARD)
    expect(r.角色).toBe('待审稿')
  })

  it('硬约束 deleted → 保真风险, 角色 not 待审稿, derive still 润色', () => {
    const root = mkBook()
    readyDraft(root, `${HARD}。雨停了。`)
    const draftRel = '草稿区/草稿/卷01-开篇任务/稿1.md'
    const raw = fs.readFileSync(path.join(root, draftRel), 'utf-8')
    // 用一条会删掉硬约束句的稿面:规则本身不删硬约束,因此直接写一版缺失硬约束的润色输入
    fs.writeFileSync(path.join(root, draftRel), raw.replace(HARD, '综上所述'), 'utf-8')
    const r = polishDraft(root, key)
    expect(r.ok).toBe(true)
    expect(r.risks.some((x) => x.kind === '硬约束缺失')).toBe(true)
    expect(r.角色).not.toBe('待审稿')
    const doc = parseDocument(fs.readFileSync(path.join(root, r.relPath), 'utf-8'))
    expect(doc.ok && doc.data.fields['角色']).not.toBe('待审稿')
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('润色')
  })

  it('clean polish → 角色 待审稿, derive 审核', () => {    const root = mkBook()
    readyDraft(root, `巷口风大。${HARD}。他没有回头。`)
    const r = polishDraft(root, key)
    expect(r.ok).toBe(true)
    expect(r.角色).toBe('待审稿')
    expect(r.risks).toHaveLength(0)
    const facts = scanChapter(root, key)
    expect(facts.唯一待审稿).toBe(true)
    expect(deriveChapterFacts(facts).建议.环节).toBe('审核')
  })

  it('二次润色仍只有一份待审稿，旧待审稿降级为草稿', () => {
    const root = mkBook()
    readyDraft(root, `综上所述，巷口风大。${HARD}。他没有回头。`)
    const first = polishDraft(root, key)
    expect(first.角色).toBe('待审稿')
    expect(countPendingReviewDrafts(root, key)).toBe(1)

    const second = polishDraft(root, key)
    expect(second.ok).toBe(true)
    expect(second.角色).toBe('待审稿')
    expect(second.relPath).not.toBe(first.relPath)
    expect(countPendingReviewDrafts(root, key)).toBe(1)
    expect(scanChapter(root, key).唯一待审稿).toBe(true)
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('审核')

    const drafts = listChapterDrafts(root, key)
    expect(drafts.filter((d) => d.角色 === '待审稿').map((d) => d.relPath)).toEqual([second.relPath])
    expect(drafts.filter((d) => d.选定).map((d) => d.relPath)).toEqual([second.relPath])
  })

  it('二次润色以上一版待审稿为源，版本逐级递增', () => {
    const root = mkBook()
    readyDraft(root, `综上所述，巷口风大。${HARD}。他没有回头。`)
    const first = polishDraft(root, key)
    const second = polishDraft(root, key)
    const byPath = new Map(listChapterDrafts(root, key).map((d) => [d.relPath, d]))
    expect(byPath.get(first.relPath)?.版本).toBe(2)
    expect(byPath.get(second.relPath)?.版本).toBe(3)
    const doc = parseDocument(fs.readFileSync(path.join(root, second.relPath), 'utf-8'))
    expect(doc.ok && doc.data.fields['父版本']).toBe(2)
  })
})
