import { describe, expect, it } from 'vitest'
import {
  annotate,
  applyVersionFields,
  bumpVersion,
  extractVersionFields,
  initialVersion,
  queryFrontmatter,
  versionFieldsFromDocument,
  withProvenance,
} from '../src/provenance'
import { parseDocument, serializeDocument } from '../src/repo/frontmatter'

describe('来源标注六要素(插件规格 §7)', () => {
  it('annotate 构造六元组', () => {
    const a = annotate({
      条目: '主角',
      片段: '性格',
      来源: '世界书/人物档案/主角.md',
      版本: 3,
      状态: '已确认',
      完整性: '完整',
    })
    expect(a).toEqual({
      条目: '主角',
      片段: '性格',
      来源: '世界书/人物档案/主角.md',
      版本: 3,
      状态: '已确认',
      完整性: '完整',
    })
  })

  it('B4:没有数据 vs 查询失败 类型级区分,且都带标注', () => {
    const missing = withProvenance(
      { ok: false, reason: 'missing' as const, detail: '文件不存在' },
      { 条目: '契约', 片段: '', 来源: '作品契约/契约.md' },
    )
    const failed = withProvenance(
      { ok: false, reason: 'parse-error' as const, detail: 'YAML 损坏' },
      { 条目: '契约', 片段: '', 来源: '作品契约/契约.md' },
    )
    expect(missing.ok).toBe(false)
    expect(failed.ok).toBe(false)
    if (!missing.ok && !failed.ok) {
      expect(missing.reason).toBe('missing')
      expect(failed.reason).toBe('parse-error')
      expect(missing.来源标注.完整性).toBe('无')
      expect(failed.来源标注.完整性).toBe('残缺')
      expect(missing.来源标注.条目).toBe('契约')
      expect(failed.来源标注.来源).toBe('作品契约/契约.md')
    }
  })

  it('queryFrontmatter:成功带回标注;null 文本=没有数据', () => {
    const text = serializeDocument({ 状态: '已确认', 版本: 2 }, '正文')
    const ok = queryFrontmatter(text, { 条目: '细纲', 片段: '定位段', 来源: '大纲/卷规划/卷01/章细纲/0001-初见.md' })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.data.fields['状态']).toBe('已确认')
      expect(ok.来源标注.完整性).toBe('完整')
      expect(ok.来源标注.条目).toBe('细纲')
    }
    const none = queryFrontmatter(null, { 条目: '细纲', 片段: '', 来源: '大纲/x.md' })
    expect(none.ok).toBe(false)
    if (!none.ok) expect(none.reason).toBe('missing')
  })
})

describe('版本协议(§7.1 版本/父版本/生成模块/来源快照)', () => {
  it('从 frontmatter 读写四字段', () => {
    const text = serializeDocument({
      状态: '已确认',
      版本: 4,
      父版本: 3,
      生成模块: '章细纲',
      来源快照: { 卷纲: 2 },
    }, '正文')
    const parsed = parseDocument(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const v = extractVersionFields(parsed.data.fields)
    expect(v).toEqual({ 版本: 4, 父版本: 3, 生成模块: '章细纲', 来源快照: { 卷纲: 2 } })
    const merged = applyVersionFields({ 状态: '候选' }, initialVersion('写稿', { 细纲: 4 }))
    expect(merged['版本']).toBe(1)
    expect(merged['父版本']).toBeNull()
    expect(merged['生成模块']).toBe('写稿')
    const fromDoc = versionFieldsFromDocument(text)
    expect(fromDoc.ok).toBe(true)
    if (fromDoc.ok) expect(fromDoc.data.版本).toBe(4)
  })

  it('bump:新版本=父+1,记录父版本', () => {
    const next = bumpVersion(3, '润色', { 草稿: 3 })
    expect(next.版本).toBe(4)
    expect(next.父版本).toBe(3)
    expect(next.生成模块).toBe('润色')
    expect(next.来源快照).toEqual({ 草稿: 3 })
  })
})
