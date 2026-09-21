import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  assembleMaterials,
  computeMaterials,
  confirmOutline,
  deriveChapterFacts,
  readManifest,
  scanChapter,
  seedMinDesign,
  serializeDocument,
  writeCandidate,
  writeRecentWindow,
  材料包十段,
} from '../src/index'
import { sectionFileName } from '../src/assembly/sections'
import { paths } from '../src/repo/paths'
import { MACHINE_SCHEMA_VERSION, parseMachineJson } from '../src/repo/schema'
import { removeSync } from '../src/repo/remove'

const roots: string[] = []
function mkBook(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-assembly-'))
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

describe('写作备料(格式规格 §9.2)', () => {
  it('no confirmed outline → assemble fails / 段有缺', () => {
    const root = mkBook()
    const r = assembleMaterials(root, key)
    expect(r.ok).toBe(false)
    expect(r.状态).toBe('段有缺')
    expect(r.gaps.some((g) => g.includes('确认细纲'))).toBe(true)
    expect(fs.existsSync(path.join(root, paths.材料包目录(1, '开篇任务'), '材料清单.json'))).toBe(false)
  })

  it('after confirmOutline + assemble → 清单 段齐备, derive 建议写稿, compute/write 同源', () => {
    const root = mkBook()
    confirmReady(root)
    const r = assembleMaterials(root, key)
    expect(r.ok).toBe(true)
    expect(r.状态).toBe('段齐备')

    const 清单Abs = path.join(root, paths.材料包目录(1, '开篇任务'), '材料清单.json')
    const parsed = parseMachineJson(fs.readFileSync(清单Abs, 'utf-8'), MACHINE_SCHEMA_VERSION)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.data['状态']).toBe('段齐备')

    // compute/write 同源(R21 切割防漂移):写入器内部重算与纯算结果一致
    expect(computeMaterials(root, key).状态).toBe('段齐备')
    expect(readManifest(root, key)?.状态).toBe('段齐备')
    const facts = scanChapter(root, key)
    expect(deriveChapterFacts(facts).建议).toEqual({ row: 4, 环节: '写稿' })
  })

  it('missing referenced 仓内 file → 段有缺, not 段齐备', () => {
    const root = mkBook()
    confirmReady(root)
    removeSync(path.join(root, '世界书/人物档案/主角.md'))
    const r = assembleMaterials(root, key)
    expect(r.ok).toBe(false)
    expect(r.状态).toBe('段有缺')
    expect(r.gaps.some((g) => g.includes('世界书/人物档案/主角.md'))).toBe(true)

    const 清单Abs = path.join(root, paths.材料包目录(1, '开篇任务'), '材料清单.json')
    const parsed = parseMachineJson(fs.readFileSync(清单Abs, 'utf-8'), MACHINE_SCHEMA_VERSION)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.data['状态']).toBe('段有缺')
    expect(readManifest(root, key)?.状态).toBe('段有缺')
    expect(deriveChapterFacts(scanChapter(root, key)).建议).toEqual({ row: 3, 环节: '写作备料' })
  })

  it('10 section files exist', () => {
    const root = mkBook()
    confirmReady(root)
    assembleMaterials(root, key)
    const dir = path.join(root, paths.材料包目录(1, '开篇任务'))
    for (const [i, name] of 材料包十段.entries()) {
      expect(fs.existsSync(path.join(dir, sectionFileName(i, name)))).toBe(true)
    }
    expect(fs.existsSync(path.join(dir, '材料清单.json'))).toBe(true)
  })
})

describe('跨卷材料(任务21, 件二):卷N首章带卷N−1卷摘要与上一章末尾', () => {
  /** 建卷一3章定稿(章摘要齐)＋卷二第4章确认细纲的跨卷书。 */
  function mkCrossVolumeBook(withSummary: boolean): string {
    const root = mkBook()
    const 章名 = ['第一章 夜巡', '第二章 灯影', '第三章 渡口']
    for (const [i, name] of 章名.entries()) {
      const 章 = i + 1
      const fin = path.join(root, `定稿/卷01/${String(章).padStart(4, '0')}-${name}.md`)
      fs.mkdirSync(path.dirname(fin), { recursive: true })
      fs.writeFileSync(fin, serializeDocument({ 状态: '已定稿' }, `第${章}章正文末尾：渡口的灯灭了。`), 'utf-8')
      const sum = path.join(root, `大纲/卷规划/卷01/章摘要/${String(章).padStart(4, '0')}-${name}.md`)
      fs.mkdirSync(path.dirname(sum), { recursive: true })
      fs.writeFileSync(sum, `# 章摘要\n\n${name}摘要：灯灭之因。`, 'utf-8')
    }
    if (withSummary) {
      fs.writeFileSync(path.join(root, '大纲/卷规划/卷01/卷摘要.md'), '# 卷摘要\n\n卷一摘要：三盏灯与一只空渡口。', 'utf-8')
    }
    // 卷二第4章:窗口就绪＋确认细纲
    fs.mkdirSync(path.join(root, '大纲/卷规划/卷02'), { recursive: true })
    writeRecentWindow(root, 2, [{ 名称: '第四章 新城', 状态: '已确认' }])
    writeCandidate(root, {
      卷: 2,
      章: 4,
      章名: '第四章 新城',
      来源引用: ['作品契约/契约.md@1'],
      body: [
        '# 章细纲', '', '## 定位段', '',
        '### 来源窗口项及拆并关系', '第四章 新城', '',
        '### 章节功能', '开卷二', '- 〔软〕稳', '',
        '### 视角与焦点', '主角', '',
        '### 时空锚定', '新城', '',
        '### 起止边界', '全程', '',
        '### 故事线与承诺分配', '主线', '',
        '### 信息边界', '限本章', '',
        '### 情绪与节奏目标', '起', '',
        '### 前置条件核对结果', '已核对', '',
        '## 细纲段', '', '### 单元 1', '',
        '- 目标: x', '- 人物: x', '- 时空: x', '- 行动/冲突: x', '- 信息披露: x', '- 状态变化: x', '',
      ].join('\n'),
    })
    const r = confirmOutline(root, { 卷: 2, 章: 4, 章名: '第四章 新城' })
    if (!r.ok) throw new Error('confirm 卷二第4章失败')
    return root
  }

  it('卷二第一章衔接段含卷一卷摘要(整文件)与第3章末尾,来源标卷号', () => {
    const root = mkCrossVolumeBook(true)
    const c = computeMaterials(root, { 卷: 2, 章: 4, 章名: '第四章 新城' })
    expect(c.ok).toBe(true)
    const sec = c.文件?.find((f) => f.relPath.includes('近期正文衔接'))
    expect(sec).toBeDefined()
    expect(sec!.content).toContain('卷01 卷摘要')
    expect(sec!.content).toContain('三盏灯与一只空渡口')
    expect(sec!.content).toContain('渡口的灯灭了')
    expect(sec!.content).toContain('第三章 渡口摘要')
    const rec = c.段?.find((s) => s.段 === '近期正文衔接')
    expect(rec?.来源).toContain('大纲/卷规划/卷01/卷摘要.md')
    expect(rec?.来源).toContain('定稿/卷01/0003-第三章 渡口.md')
  })

  it('前一卷无卷摘要如实标缺,不静默省略', () => {
    const root = mkCrossVolumeBook(false)
    const c = computeMaterials(root, { 卷: 2, 章: 4, 章名: '第四章 新城' })
    const sec = c.文件?.find((f) => f.relPath.includes('近期正文衔接'))
    expect(sec!.content).toContain('（卷01 无卷摘要）')
    expect(sec!.content).toContain('渡口的灯灭了')
  })
})
