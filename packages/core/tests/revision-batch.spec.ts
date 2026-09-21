import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  applyRevisionBatch,
  confirmOutline,
  listChapterDrafts,
  loadReviewRecord,
  parseDocument,
  seedMinDesign,
  writeCandidate,
} from '../src/index'
import { ingestFindings, registerDefaultChecks, resetChecks, runReview } from '@webnovel/review'

const roots: string[] = []
function mkDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const
const HARD = '开场必须点名主角现身'
const FACTS = ['事实：主角捡到半枚铜符', '时间线：盘问结束｜第三日清晨']

function confirmWithHard(root: string): void {
  seedMinDesign(root)
  for (const name of ['故事线', '人物弧线', '承诺', '线索', '时间线'] as const) {
    fs.mkdirSync(path.join(root, '账本'), { recursive: true })
    fs.writeFileSync(path.join(root, '账本', `${name}.md`), `# ${name}\n`, 'utf-8')
  }
  const body = [
    '# 章细纲', '', '## 定位段', '', '### 来源窗口项及拆并关系', '开篇任务，单章承接', '',
    '### 章节功能', '', `- 〔硬〕${HARD}`, '',
    '### 视角与焦点', '主角视角', '', '### 时空锚定', '城门口，清晨', '',
    '### 起止边界', '从抵达城门到发现异状', '', '### 故事线与承诺分配', '推进主线承诺', '',
    '### 信息边界', '只披露主角所见', '', '### 情绪与节奏目标', '紧张后留钩子', '',
    '### 前置条件核对结果', '已核对来源与窗口，前置设定均非留白', '',
    '## 细纲段', '', '### 单元 1', '',
    '- 目标: 开场', '- 人物: 主角', '- 时空: 城门口', '- 行动/冲突: 盘问与发现', '- 信息披露: 异常线索', '- 状态变化: 从平静到警觉', '',
  ].join('\n')
  writeCandidate(root, { 卷: 1, 章: 1, 章名: key.章名, 来源引用: ['作品契约/契约.md@1'], body })
  const r = confirmOutline(root, key)
  if (!r.ok) throw new Error(`confirm failed:${r.gaps.join(';')}`)
}

function putPending(root: string, body: string): void {
  const rel = `草稿区/草稿/卷01-${key.章名}/稿1.md`
  fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true })
  fs.writeFileSync(
    path.join(root, rel),
    `---\n角色: 待审稿\n选定: true\n版本: 1\n父版本: null\n生成模块: 写稿\n---\n${body}`,
    'utf-8',
  )
}

/** 经「作者意见」通道回写三条处置目标(发现项编号 P1/P2/P3)。 */
function seedFindings(root: string): void {
  resetChecks()
  registerDefaultChecks()
  runReview(root, key)
  const r = ingestFindings(root, key, '作者意见', [
    { 审核编号: 'R-作者意见-1', 模块名: '作者意见', 发现项编号: '审-01-0001-作者意见-1', 严重程度: '中', 是否建议阻断: false, 证据位置: '第一段', 所依据材料及版本: '稿1@1', 问题说明: '开头节奏拖沓', 影响范围: '正文', 不确定性说明: '', 修改建议: '合并前两句', 建议返回节点: '改稿', 建议复审模块: '作者意见', 材料完整性: '完整', 处置状态: '待处理', 处置: '待处理' },
    { 审核编号: 'R-作者意见-2', 模块名: '作者意见', 发现项编号: '审-01-0001-作者意见-2', 严重程度: '低', 是否建议阻断: false, 证据位置: '第二段', 所依据材料及版本: '稿1@1', 问题说明: '口头语重复', 影响范围: '正文', 不确定性说明: '', 修改建议: '删除一处', 建议返回节点: '改稿', 建议复审模块: '作者意见', 材料完整性: '完整', 处置状态: '待处理', 处置: '待处理' },
    { 审核编号: 'R-作者意见-3', 模块名: '作者意见', 发现项编号: '审-01-0001-作者意见-3', 严重程度: '低', 是否建议阻断: false, 证据位置: '结尾', 所依据材料及版本: '稿1@1', 问题说明: '钩子偏弱', 影响范围: '正文', 不确定性说明: '', 修改建议: '保留现状也可', 建议返回节点: '改稿', 建议复审模块: '作者意见', 材料完整性: '完整', 处置状态: '待处理', 处置: '待处理' },
  ])
  expect(r.ok).toBe(true)
}

describe('改稿批(A8)', () => {
  it('一次写新稿并回写 3 条处置:旧稿降级、版本+1、处置说明回填、候选事实保留', () => {
    const root = mkDir('webnovel-batch-')
    confirmWithHard(root)
    putPending(root, `综上所述，${HARD}。\n\n## 草稿候选事实\n\n${FACTS.map((f) => `- ${f}`).join('\n')}\n`)
    seedFindings(root)

    const res = applyRevisionBatch(root, {
      卷: 1, 章: 1, 章名: key.章名,
      新稿正文: `改后正文。${HARD}。`,
      生成模块: '作者手改',
      处置: [
        { 发现项编号: '审-01-0001-作者意见-1', 处置: '已解决', 改动说明: '合并了前两句' },
        { 发现项编号: '审-01-0001-作者意见-2', 处置: '作者保留' },
        { 发现项编号: '审-01-0001-作者意见-3', 处置: '已驳回', 改动说明: '作者裁决：保留原钩子' },
      ],
    })
    expect(res.ok).toBe(true)
    expect(res.relPath).toBe(`草稿区/草稿/卷01-${key.章名}/稿2.md`)

    const drafts = listChapterDrafts(root, key)
    expect(drafts.filter((d) => d.角色 === '待审稿').map((d) => d.file)).toEqual(['稿2.md'])
    const 新稿 = drafts.find((d) => d.file === '稿2.md')!
    expect(新稿.版本).toBe(2)
    const doc = parseDocument(新稿.text)
    expect(doc.ok).toBe(true)
    if (doc.ok) {
      expect(doc.data.fields['父版本']).toBe(1)
      expect(doc.data.fields['生成模块']).toBe('作者手改')
      expect(doc.data.fields['来源快照']).toMatchObject({ 处置编号: ['审-01-0001-作者意见-1', '审-01-0001-作者意见-2', '审-01-0001-作者意见-3'] })
      const body = doc.data.body
      expect(body).toContain('改后正文')
      expect(body).toContain('事实：主角捡到半枚铜符')
      expect(body).toContain('时间线：盘问结束｜第三日清晨')
    }
    // 旧稿原样留档且已降级
    const 旧稿 = drafts.find((d) => d.file === '稿1.md')!
    expect(旧稿.角色).toBe('草稿')
    expect(旧稿.选定).toBe(false)
  })

  it('审核记录 3 条处置状态与处置说明均已更新', () => {
    const root = mkDir('webnovel-batch-record-')
    confirmWithHard(root)
    putPending(root, `综上所述，${HARD}。`)
    seedFindings(root)
    const res = applyRevisionBatch(root, {
      卷: 1, 章: 1, 章名: key.章名,
      新稿正文: `改后正文。${HARD}。`,
      处置: [
        { 发现项编号: '审-01-0001-作者意见-1', 处置: '已解决', 改动说明: '合并了前两句' },
        { 发现项编号: '审-01-0001-作者意见-2', 处置: '作者保留' },
        { 发现项编号: '审-01-0001-作者意见-3', 处置: '已驳回', 改动说明: '作者裁决：保留原钩子' },
      ],
    })
    expect(res.ok).toBe(true)
    const record = loadReviewRecord(root, key)
    expect(record).toBeTruthy()
    const byId = new Map(record!.问题.map((p) => [p.发现项编号, p]))
    expect(byId.get('审-01-0001-作者意见-1')?.处置状态).toBe('已解决')
    expect(byId.get('审-01-0001-作者意见-1')?.处置说明).toBe('合并了前两句')
    expect(byId.get('审-01-0001-作者意见-2')?.处置状态).toBe('作者保留')
    expect(byId.get('审-01-0001-作者意见-3')?.处置状态).toBe('已驳回')
    expect(byId.get('审-01-0001-作者意见-3')?.处置说明).toBe('作者裁决：保留原钩子')
  })

  it('不带新稿正文时只回写处置,不产生新文件', () => {
    const root = mkDir('webnovel-batch-nodraft-')
    confirmWithHard(root)
    putPending(root, `综上所述，${HARD}。`)
    seedFindings(root)
    const res = applyRevisionBatch(root, {
      卷: 1, 章: 1, 章名: key.章名,
      处置: [
        { 发现项编号: '审-01-0001-作者意见-1', 处置: '作者保留' },
        { 发现项编号: '审-01-0001-作者意见-2', 处置: '已驳回', 改动说明: '误报' },
        { 发现项编号: '审-01-0001-作者意见-3', 处置: '待处理' },
      ],
    })
    expect(res.ok).toBe(true)
    expect(res.relPath).toBeUndefined()
    expect(listChapterDrafts(root, key).map((d) => d.file)).toEqual(['稿1.md'])
  })

  it('含不存在的发现项编号 → 整批不写', () => {
    const root = mkDir('webnovel-batch-miss-')
    confirmWithHard(root)
    putPending(root, `综上所述，${HARD}。`)
    seedFindings(root)
    const res = applyRevisionBatch(root, {
      卷: 1, 章: 1, 章名: key.章名,
      新稿正文: `改后正文。${HARD}。`,
      处置: [
        { 发现项编号: '审-01-0001-作者意见-1', 处置: '已解决' },
        { 发现项编号: '不存在', 处置: '已解决' },
      ],
    })
    expect(res).toEqual({ ok: false, reason: '发现项不存在:不存在' })
    expect(listChapterDrafts(root, key).map((d) => d.file)).toEqual(['稿1.md'])
    const record = loadReviewRecord(root, key)!
    expect(record.问题.find((p) => p.发现项编号 === '审-01-0001-作者意见-1')?.处置状态).toBe('待处理')
  })

  it('触及真源的发现项整批拒绝', () => {
    const root = mkDir('webnovel-batch-true-')
    confirmWithHard(root)
    putPending(root, `${HARD}。`)
    resetChecks()
    registerDefaultChecks()
    runReview(root, key)
    const r = ingestFindings(root, key, '作者意见', [
      { 审核编号: 'R-作者意见-1', 模块名: '作者意见', 发现项编号: '审-01-0001-作者意见-1', 严重程度: '高', 是否建议阻断: false, 证据位置: 'x', 所依据材料及版本: '稿1@1', 问题说明: '与设定冲突', 影响范围: '世界书/人物档案/主角.md', 不确定性说明: '', 修改建议: '呈报上游', 建议返回节点: '改稿', 建议复审模块: '作者意见', 材料完整性: '完整', 处置状态: '待处理', 处置: '待处理' },
    ])
    expect(r.ok).toBe(true)
    const res = applyRevisionBatch(root, {
      卷: 1, 章: 1, 章名: key.章名,
      新稿正文: `${HARD}。`,
      处置: [{ 发现项编号: '审-01-0001-作者意见-1', 处置: '已解决' }],
    })
    expect(res).toEqual({ ok: false, reason: '须呈报上游' })
  })
})
