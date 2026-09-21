import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  assembleMaterials,
  confirmOutline,
  listChapterDrafts,
  parseDocument,
  seedMinDesign,
  writeCandidate,
} from '@webnovel/core'
import { importAuthorDraft } from '../src/index'

const roots: string[] = []
function mkDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const
const HARD = '开场必须点名主角现身'

function readyBook(root: string): void {
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
  const a = assembleMaterials(root, key)
  if (!a.ok) throw new Error(`assemble failed:${a.gaps.join(';')}`)
}

describe('作者稿导入(A9)', () => {
  it('整章自写:落 稿N+1.md,生成模块 作者手写,角色 草稿,不覆盖既有稿', () => {
    const root = mkDir('webnovel-import-1-')
    readyBook(root)
    const r1 = importAuthorDraft(root, {
      卷: 1, 章: 1, 章名: key.章名,
      正文: `作者亲写的第一章。${HARD}。\n\n## 草稿候选事实\n\n- 事实：主角揣着半枚铜符\n`,
      角色: '草稿',
      生成模块: '作者手写',
    })
    expect(r1.ok).toBe(true)
    expect(r1.relPath).toBe(`草稿区/草稿/卷01-${key.章名}/稿1.md`)
    const doc = parseDocument(fs.readFileSync(path.join(root, r1.relPath), 'utf-8'))
    expect(doc.ok).toBe(true)
    if (doc.ok) {
      expect(doc.data.fields['生成模块']).toBe('作者手写')
      expect(doc.data.fields['角色']).toBe('草稿')
      expect(doc.data.fields['选定']).toBe(false)
      expect(doc.data.body).toContain('事实：主角揣着半枚铜符')
    }
    const r2 = importAuthorDraft(root, {
      卷: 1, 章: 1, 章名: key.章名,
      正文: '第二版作者稿。',
      角色: '草稿',
      生成模块: '作者手写',
    })
    expect(r2.ok).toBe(true)
    expect(r2.relPath).toBe(`草稿区/草稿/卷01-${key.章名}/稿2.md`)
    expect(fs.readFileSync(path.join(root, r1.relPath), 'utf-8')).toContain('作者亲写的第一章')
  })

  it('作者手改:角色 待审稿 时旧待审稿降级、父版本指向被改的稿、选定唯一', () => {
    const root = mkDir('webnovel-import-2-')
    readyBook(root)
    fs.mkdirSync(path.join(root, `草稿区/草稿/卷01-${key.章名}`), { recursive: true })
    fs.writeFileSync(
      path.join(root, `草稿区/草稿/卷01-${key.章名}/稿1.md`),
      `---\n角色: 待审稿\n选定: true\n版本: 1\n父版本: null\n生成模块: 写稿\n---\nAI 初稿。${HARD}。\n`,
      'utf-8',
    )
    const r = importAuthorDraft(root, {
      卷: 1, 章: 1, 章名: key.章名,
      正文: `作者改过的版本。${HARD}。`,
      角色: '待审稿',
      生成模块: '作者手改',
      父版本: 1,
    })
    expect(r.ok).toBe(true)
    const drafts = listChapterDrafts(root, key)
    expect(drafts.filter((d) => d.角色 === '待审稿').map((d) => d.file)).toEqual(['稿2.md'])
    expect(drafts.filter((d) => d.选定).map((d) => d.file)).toEqual(['稿2.md'])
    const 新稿 = drafts.find((d) => d.file === '稿2.md')!
    const doc = parseDocument(新稿.text)
    expect(doc.ok).toBe(true)
    if (doc.ok) {
      expect(doc.data.fields['生成模块']).toBe('作者手改')
      expect(doc.data.fields['父版本']).toBe(1)
      expect(doc.data.fields['版本']).toBe(2)
    }
    const 旧稿 = drafts.find((d) => d.file === '稿1.md')!
    expect(旧稿.角色).toBe('草稿')
    expect(旧稿.选定).toBe(false)
  })

  it('空正文被拒;未确认细纲不拒绝(R1 播报)', () => {
    const root = mkDir('webnovel-import-3-')
    readyBook(root)
    expect(importAuthorDraft(root, { 卷: 1, 章: 1, 章名: key.章名, 正文: '  ', 角色: '草稿', 生成模块: '作者手写' }).ok).toBe(false)
    const r = importAuthorDraft(root, { 卷: 2, 章: 2, 章名: '未确认章', 正文: '正文', 角色: '草稿', 生成模块: '作者手写' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.播报).toContain('细纲未确认')
  })
})
