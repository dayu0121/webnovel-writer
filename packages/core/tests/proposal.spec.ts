/**
 * S4 验收：提案三件套（§9.5 字段）＋ retcon 流（更正落位／retcon: 提交／补偿留痕／裁决门）。
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import * as os from 'node:os'
import {
  archiveRetcon,
  archiveChapter,
  applyRevision,
  confirmOutline,
  loadProposal,
  preparePack,
  recordRetconEvent,
  registerProposal,
  resolveProposal,
  seedMinDesign,
  serializeDocument,
  writeCandidate,
  paths,
  MACHINE_SCHEMA_VERSION,
} from '../src/index'
import { ingestFindings, registerDefaultChecks, resetChecks, runReview } from '@webnovel/review'

const roots: string[] = []
function mkBook(): string {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'webnovel-s4-'))
  roots.push(dir)
  seedMinDesign(dir)
  // 建书在真实流程中 git init＋首提交;测试夹具补齐(B6 健康检查需要)
  const git = (args: readonly string[]): void => { spawnSync('git', args, { cwd: dir, windowsHide: true }) }
  git(['init'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'test'])
  git(['config', 'commit.gpgsign', 'false'])
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放 */ } } })
beforeEach(() => { /* 每例独立书仓 */ })

const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const

function completeReview(root: string): void {
  resetChecks()
  registerDefaultChecks()
  let record = runReview(root, key).record
  for (const [name, state] of Object.entries(record?.模块 ?? {})) {
    if (state.待回写 === true) record = ingestFindings(root, key, name, []).record
  }
  for (const finding of record?.问题 ?? []) {
    if (finding.处置状态 === '待处理') applyRevision(root, key, { 发现项编号: finding.发现项编号, 处置: '作者保留' })
  }
}

function settledBook(root: string): void {
  const refs = ['作品契约/契约.md@1', '世界书/人物档案/主角.md@1']
  const body = [
    '# 章细纲', '',
    '## 定位段', '',
    '### 来源窗口项及拆并关系', '开篇任务，单章承接', '',
    '### 章节功能', '',
    '- 〔硬〕开场必须点名主角现身', '',
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
  writeCandidate(root, { 卷: 1, 章: 1, 章名: key.章名, 来源引用: refs, body })
  const r = confirmOutline(root, key)
  if (!r.ok) throw new Error(`confirm failed:${r.gaps.join(';')}`)
  const draftDir = nodePath.join(root, '草稿区/草稿/卷01-开篇任务')
  fs.mkdirSync(draftDir, { recursive: true })
  fs.writeFileSync(nodePath.join(draftDir, '稿1.md'), serializeDocument({ 角色: '待审稿', 选定: true }, '沈青梧走进城门，开场必须点名主角现身的规矩她记得清楚。'), 'utf-8')
  // 正式链:审核→组包(占位候选,无需批准)→ch: 入档(取 retcon 的覆盖对象)
  completeReview(root)

  const p = preparePack(root, key)
  if (!p.ok) throw new Error(`preparePack failed:${p.reason ?? ''}`)
  const res = archiveChapter({ bookRoot: root, packageDir: nodePath.join(root, p.dir), summary: '第一章 开篇任务' })
  if (!res.ok) throw new Error(`archive failed:${res.reason ?? ''}`)
}

describe('S4:提案三件套（§9.5）', () => {
  it('登记→文件落盘,frontmatter 字段齐;编号递增', () => {
    const root = mkBook()
    const a = registerProposal(root, { 域: '内容修订', 类型: '修改计划', 内容: '把第二卷反派从 A 改为 B', 来源: '作者对话指示' })
    expect(a.ok).toBe(true)
    expect(a.编号).toBe('0001')
    const b = registerProposal(root, { 域: '吃书补偿', 类型: '吃书', 内容: '第1章旗幟描写与设定冲突', 来源: '第1章审核发现项 1 条' })
    expect(b.编号).toBe('0002')
    const loaded = loadProposal(root, '0001')
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.text).toContain('状态: 待裁决')
    expect(loaded.text).toContain('把第二卷反派从 A 改为 B')
    expect(loaded.relPath).toBe('草稿区/提案/0001-修改计划.md')
  })

  it('裁决回写:只改状态与裁决记录节;重复裁决拒绝', () => {
    const root = mkBook()
    const a = registerProposal(root, { 域: '内容修订', 类型: '修改计划', 内容: '改反派', 来源: '作者对话指示' })
    const r = resolveProposal(root, a.编号, '通过', '方向成立,同批整改未定稿下游')
    expect(r.ok).toBe(true)
    const loaded = loadProposal(root, a.编号)
    if (!loaded.ok) throw new Error('load failed')
    expect(loaded.text).toContain('状态: 已通过')
    expect(loaded.text).toContain('【通过】方向成立')
    expect(loaded.text).toContain('改反派')
    const dup = resolveProposal(root, a.编号, '驳回', '再驳回一次')
    expect(dup.ok).toBe(false)
  })

  it('补偿事件记录落盘', () => {
    const root = mkBook()
    const e = recordRetconEvent(root, { 提案编号: '0001', 受影响工件: ['定稿/卷01/0001-开篇任务.md'], 账本留痕: '吃书补偿：第1章旗幡设定更正', 摘要: '更正旗幟描写' })
    expect(e.ok).toBe(true)
    expect(fs.readFileSync(nodePath.join(root, e.relPath), 'utf-8')).toContain('关联提案: "0001"')
  })
})

describe('S4:retcon 提交通道（不变量 3 的吃书例外）', () => {
  it('retcon 模式允许覆写既有定稿章,ch: 与 retcon: 各自成提交', () => {
    const root = mkBook()
    settledBook(root)
    // 定稿文件在,普通 ch: 通道会拒绝覆写;retcon 允许
    const 更正后 = serializeDocument({ 身份: { 卷: 1, 章: 1, 章名: key.章名 }, 角色: '已定稿' }, '沈青梧走进城门——旗幟的规矩她记得清楚。')
    const r = archiveRetcon({
      bookRoot: root,
      files: [{ 目标: paths.定稿章(1, 1, key.章名), 内容: 更正后 }],
      summary: '吃书补偿:旗幟描写更正',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(fs.readFileSync(nodePath.join(root, paths.定稿章(1, 1, key.章名)), 'utf-8')).toContain('旗幟的规矩')
  })
})
