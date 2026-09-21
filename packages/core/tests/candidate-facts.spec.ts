import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  applyRevision,
  composeBody,
  confirmOutline,
  listChapterDrafts,
  parseDocument,
  seedMinDesign,
  splitCandidateFacts,
  writeCandidate,
} from '../src/index'
import { polishDraft } from '@webnovel/polish'
import { registerDefaultChecks, resetChecks, runReview } from '@webnovel/review'

const roots: string[] = []
function mkDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const
const refs = ['作品契约/契约.md@1'] as const
const HARD = '开场必须点名主角现身'
const FACTS = [
  '事实：主角在城门口捡到半枚铜符',
  '线索埋设：铜符纹路｜藏在盘问一场',
  '人物变化：守门老兵｜从盘问到放行',
]

function confirmWithHard(root: string): void {
  seedMinDesign(root)
  const body = [
    '# 章细纲', '', '## 定位段', '', '### 来源窗口项及拆并关系', '开篇任务，单章承接', '',
    '### 章节功能', '', `- 〔硬〕${HARD}`, '',
    '### 视角与焦点', '主角视角', '',
    '### 时空锚定', '城门口，清晨', '',
    '### 起止边界', '从抵达城门到发现异状', '',
    '### 故事线与承诺分配', '推进主线承诺', '',
    '### 信息边界', '只披露主角所见', '',
    '### 情绪与节奏目标', '紧张后留钩子', '',
    '### 前置条件核对结果', '已核对来源与窗口，前置设定均非留白', '',
    '## 细纲段', '', '### 单元 1', '',
    '- 目标: 开场', '- 人物: 主角', '- 时空: 城门口', '- 行动/冲突: 盘问与发现', '- 信息披露: 异常线索', '- 状态变化: 从平静到警觉', '',
  ].join('\n')
  writeCandidate(root, { 卷: 1, 章: 1, 章名: key.章名, 来源引用: [...refs], body })
  const r = confirmOutline(root, key)
  if (!r.ok) throw new Error(`confirm failed:${r.gaps.join(';')}`)
}

function putPending(root: string, body: string, file = '稿1.md'): void {
  const rel = `草稿区/草稿/卷01-${key.章名}/${file}`
  fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true })
  fs.writeFileSync(
    path.join(root, rel),
    `---\n角色: 待审稿\n选定: true\n版本: 1\n父版本: null\n生成模块: 写稿\n---\n${body}`,
    'utf-8',
  )
}

function factsOf(root: string, file: string): string[] {
  const text = fs.readFileSync(path.join(root, `草稿区/草稿/卷01-${key.章名}/${file}`), 'utf-8')
  const doc = parseDocument(text)
  expect(doc.ok).toBe(true)
  return splitCandidateFacts(doc.ok ? doc.data.body : '').facts
}

describe('候选事实通道保真(A1)', () => {
  it('splitCandidateFacts 只认整行标题,prose 不含标题行', () => {
    const body = `第一段。\n\n${'## 草稿候选事实'}\n\n- 事实：甲\n`
    const split = splitCandidateFacts(body)
    expect(split.prose).toBe('第一段。')
    expect(split.facts).toEqual(['事实：甲'])
    const decoy = '正文里的 ## 草稿候选事实补充 属于正文'
    expect(splitCandidateFacts(decoy).facts).toEqual([])
    expect(composeBody('第一段。', ['事实：甲'])).toBe('第一段。\n\n## 草稿候选事实\n\n- 事实：甲')
  })

  it('起草稿候选段经润色两批与改稿一轮后逐字相同', () => {
    const root = mkDir('webnovel-candidate-')
    confirmWithHard(root)
    const prose = `巷口风大，综上所述有人来过。${HARD}。`
    putPending(root, composeBody(prose, FACTS))

    const p1 = polishDraft(root, key)
    expect(p1.ok).toBe(true)
    const p2 = polishDraft(root, key)
    expect(p2.ok).toBe(true)
    expect(p2.relPath).not.toBe(p1.relPath)
    expect(factsOf(root, '稿2.md')).toEqual(FACTS)
    expect(factsOf(root, '稿3.md')).toEqual(FACTS)

    resetChecks()
    registerDefaultChecks()
    const reviewed = runReview(root, key)
    const finding = reviewed.record?.问题.find((p) => p.问题说明.includes('综上所述'))
    expect(finding).toBeTruthy()
    const applied = applyRevision(root, key, {
      发现项编号: finding!.发现项编号,
      处置: '已解决',
      补丁: { old: '综上所述有人来过。', new: '有人来过。' },
    })
    expect(applied.ok).toBe(true)

    const finalDraft = listChapterDrafts(root, key).find((d) => d.relPath === applied.relPath)!
    expect(finalDraft).toBeTruthy()
    expect(finalDraft.角色).toBe('待审稿')
    expect(factsOf(root, finalDraft.file)).toEqual(FACTS)
    const finalText = fs.readFileSync(path.join(root, finalDraft.relPath), 'utf-8')
    expect(finalText).toContain('有人来过。')
    expect(finalText.match(/## 草稿候选事实/g)).toHaveLength(1)
  })

  it('补丁只作用于正文:只出现在候选事实段里的旧文不命中', () => {
    const root = mkDir('webnovel-candidate-probe-')
    confirmWithHard(root)
    putPending(root, composeBody(`巷口风大，综上所述有人来过。${HARD}。`, FACTS))
    resetChecks()
    registerDefaultChecks()
    const finding = runReview(root, key).record?.问题.find((p) => p.问题说明.includes('综上所述'))
    expect(finding).toBeTruthy()
    const r = applyRevision(root, key, {
      发现项编号: finding!.发现项编号,
      处置: '已解决',
      补丁: { old: '铜符', new: '玉符' },
    })
    expect(r).toEqual({ ok: false, reason: '补丁旧文未命中待审稿' })
  })
})
