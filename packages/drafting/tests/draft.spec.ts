import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  assembleMaterials,
  confirmOutline,
  deriveChapterFacts,
  scanChapter,
  seedMinDesign,
  writeCandidate,
} from '@webnovel/core'
import { loadDraftContext, writeDraft } from '../src/index'

const roots: string[] = []
function mkBook(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-draft-'))
  roots.push(dir)
  seedMinDesign(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const
const refs = ['作品契约/契约.md@1', '世界书/人物档案/主角.md@1'] as const

function confirmReady(root: string): void {
  const body = [
    '# 章细纲', '', '## 定位段', '',
    '### 来源窗口项及拆并关系', '开篇任务，单章承接', '',
    '### 章节功能', '建立开场冲突', '- 〔软〕节奏平稳', '',
    '### 视角与焦点', '主角视角', '',
    '### 时空锚定', '城门口，清晨', '',
    '### 起止边界', '从抵达城门到发现异状', '',
    '### 故事线与承诺分配', '推进主线承诺', '',
    '### 信息边界', '只披露主角所见', '',
    '### 情绪与节奏目标', '紧张后留钩子', '',
    '### 前置条件核对结果', '已核对来源与窗口，前置设定均非留白', '',
    '## 细纲段', '', '### 单元 1', '',
    '- 目标: 找到异常', '- 人物: 主角', '- 时空: 城门口',
    '- 行动/冲突: 盘问与发现', '- 信息披露: 异常线索', '- 状态变化: 从平静到警觉', '',
  ].join('\n')
  writeCandidate(root, { 卷: 1, 章: 1, 章名: '开篇任务', 来源引用: refs, body })
  const r = confirmOutline(root, key)
  if (!r.ok) throw new Error(`confirm failed:${r.gaps.join(';')}`)
}

describe('单稿写作(插件规格 §5 草稿协议)', () => {
  it('R1 播报:细纲未确认/材料包未组装不拒绝写稿,播报随结果返回', () => {
    const root = mkBook()
    const r = writeDraft(root, { ...key, body: '他走进雨里。' })
    expect(r.ok).toBe(true)
    expect(r.播报).toContain('细纲未确认')
    expect(r.播报).toContain('材料包未组装')
    expect(fs.existsSync(path.join(root, '草稿区/草稿/卷01-开篇任务/稿1.md'))).toBe(true)
  })

  it('after assemble + writeDraft → derive 润色 (有草稿, no 待审稿)', () => {
    const root = mkBook()
    confirmReady(root)
    const assembled = assembleMaterials(root, key)
    expect(assembled.ok).toBe(true)
    const r = writeDraft(root, { ...key, body: '他走进雨里。', 选定: true })
    expect(r.ok).toBe(true)
    expect(r.relPath).toBe('草稿区/草稿/卷01-开篇任务/稿1.md')
    const text = fs.readFileSync(path.join(root, r.relPath), 'utf-8')
    expect(text).not.toMatch(/角色:\s*待审稿/)
    expect(text).toMatch(/选定:\s*true/)
    const facts = scanChapter(root, key)
    expect(facts.有草稿).toBe(true)
    expect(facts.唯一待审稿).toBe(false)
    expect(deriveChapterFacts(facts).建议.环节).toBe('润色')
  })

  it('context loader does not include 审核 files', () => {
    const root = mkBook()
    confirmReady(root)
    assembleMaterials(root, key)
    fs.mkdirSync(path.join(root, '草稿区/审核'), { recursive: true })
    fs.writeFileSync(path.join(root, '草稿区/审核/卷01-开篇任务.json'), '{"schemaVersion":1,"完成":false,"问题":[]}', 'utf-8')
    const ctx = loadDraftContext(root, key)
    expect(ctx.细纲).toMatch(/章细纲/)
    expect(Object.keys(ctx.材料段).some((k) => k.includes('本章任务'))).toBe(true)
    const dumped = JSON.stringify(ctx)
    expect(dumped).not.toContain('草稿区/审核')
    expect(dumped).not.toContain('卷01-开篇任务.json')
    expect(dumped).not.toMatch(/"完成"\s*:/)
  })

  it('候选事实 stays in workspace draft only', () => {
    const root = mkBook()
    confirmReady(root)
    assembleMaterials(root, key)
    const r = writeDraft(root, {
      ...key,
      body: '他走进雨里。\n\n## 草稿候选事实\n\n- 巷口多了一盏灯',
    })
    expect(r.ok).toBe(true)
    const draft = fs.readFileSync(path.join(root, r.relPath), 'utf-8')
    expect(draft).toContain('巷口多了一盏灯')
    expect(fs.existsSync(path.join(root, '世界书'))).toBe(true)
    const world = fs.readFileSync(path.join(root, '世界书/人物档案/主角.md'), 'utf-8')
    expect(world).not.toContain('巷口多了一盏灯')
    expect(fs.existsSync(path.join(root, '大纲/卷规划/卷01/章细纲/0001-开篇任务.md'))).toBe(true)
    const outline = fs.readFileSync(path.join(root, '大纲/卷规划/卷01/章细纲/0001-开篇任务.md'), 'utf-8')
    expect(outline).not.toContain('巷口多了一盏灯')
  })

  it('「草稿候选事实补充」这类同前缀标题不被当成候选事实分隔线', () => {
    const root = mkBook()
    confirmReady(root)
    assembleMaterials(root, key)
    const r = writeDraft(root, {
      ...key,
      body: '他走进雨里。\n\n## 草稿候选事实补充说明\n\n这段是正文的一部分。',
    })
    expect(r.ok).toBe(true)
    const draft = fs.readFileSync(path.join(root, r.relPath), 'utf-8')
    expect(draft).toContain('## 草稿候选事实补充说明')
    expect(draft).toContain('这段是正文的一部分。')
    expect(draft).not.toMatch(/^- 这段是正文的一部分。$/m)
  })
})
