import { describe, expect, it } from 'vitest'
import { parseSourceRef, isKnowledgeRef } from '../src/repo/sourceRef'
import { assertState, familyOf } from '../src/derive/states'
import { resolveLayers } from '../src/config/resolve'

describe('来源引用语法(格式规格 §7.2)', () => {
  it('仓内路径@版本', () => {
    const r = parseSourceRef('来源:大纲/卷规划/卷01/卷纲.md@5')
    expect(r).toEqual({ kind: '仓内', path: '大纲/卷规划/卷01/卷纲.md', version: '5' })
  })
  it('全角冒号兼容(B9 方言容忍)', () => {
    expect(parseSourceRef('来源：作品契约/契约.md@2')?.kind).toBe('仓内')
  })
  it('作者自定义/对谈共创', () => {
    expect(parseSourceRef('来源:作者自定义')).toEqual({ kind: '作者自定义' })
    expect(parseSourceRef('来源:对谈共创')).toEqual({ kind: '对谈共创' })
  })
  it('知识库引用:库名/条目/版本', () => {
    const r = parseSourceRef('来源:知识库/写作方法库/节拍/蓄压-回旋-爆发.md@7')
    expect(r).toMatchObject({ kind: '知识库', library: '写作方法库', version: '7' })
    if (r) expect(isKnowledgeRef(r)).toBe(true)
  })
  it('拒绝:路径穿越、盘符、无版本', () => {
    expect(parseSourceRef('来源:../窃.md@1')).toBeNull()
    expect(parseSourceRef('来源:D:/x.md@1')).toBeNull()
    expect(parseSourceRef('来源:大纲/卷纲.md')).toBeNull()
    expect(parseSourceRef('随便一行')).toBeNull()
  })
})

describe('状态三族(格式规格 §7.3/D56⑪)', () => {
  it('族属判定', () => {
    expect(familyOf('已确认')).toBe('计划族')
    expect(familyOf('已埋')).toBe('计划族') // 线索域四态收编入计划族
    expect(familyOf('候选')).toBe('工件族')
    expect(familyOf('已消费')).toBe('轮次族')
    expect(familyOf('已入记')).toBeNull() // 自造词被拒
  })
  it('族属校验抛错', () => {
    expect(() => assertState('已消费', '工件族')).toThrow(/族属/) // D56⑪:族属标错即违规
    expect(() => assertState('玄学状态', '计划族')).toThrow(/三族词表/)
    expect(assertState('候选', '工件族')).toBeUndefined()
  })
})

describe('配置解析最小(D50 整项覆盖)', () => {
  it('后者整项覆盖前者,不做字段级合并', () => {
    const r = resolveLayers([
      { name: '默认', values: { 润色: { 道: ['去AI痕迹'], 排序: 1 } } },
      { name: 'profile', values: { 润色: { 道: ['平台适配'] } } },
    ])
    const item = r.find((x) => x.key === '润色')
    expect(item?.value).toEqual({ 道: ['平台适配'] }) // 整项覆盖,排序字段不残留
    expect(item?.fromLayer).toBe('profile')
  })
})
