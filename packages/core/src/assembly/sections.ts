/**
 * 材料包十段固定结构(格式规格 §9.2)。
 */

export const 材料包十段 = [
  '本章任务与确认细纲',
  '硬约束禁区完成条件',
  '当前事实与连续性',
  '人物、关系、地点、组织、规则、物件',
  '时间位置与信息边界',
  '故事线承诺线索',
  '近期正文衔接',
  '文风〔条目切片〕',
  '暂定与警告',
  '来源与版本清单',
] as const

export type 材料包段名 = (typeof 材料包十段)[number]

export type 材料包状态 = '组装中' | '段齐备' | '段有缺' | '有冲突' | '已过期' | '已消费'

export interface SectionRecord {
  readonly 段: 材料包段名
  readonly 来源: readonly string[]
  readonly 版本: string
  readonly 选用原因: string
  readonly 完整性: '完整' | '残缺' | '空' | '旧格式'
  /** 段正文字数(码点);十段全记。 */
  readonly 字数: number
}

export interface SupplementSource {
  readonly 域: '本书' | '书房'
  readonly 路径: string
  readonly 起行?: number
  readonly 终行?: number
  /** Preview supplies this; saving a new snapshot requires the same source bytes. */
  readonly 读取哈希?: string
}

export type SupplementEdit =
  | { readonly 操作: '移除'; readonly 编号: string }
  | { readonly 操作: '设置'; readonly 编号: string; readonly 标题: string; readonly 理由: string; readonly 性质: '原文' | '建议'; readonly 来源: SupplementSource }

export interface SupplementRecord extends Omit<SectionRecord, '段'> {
  readonly 类型: '补充'
  readonly 段: string
  readonly 编号: string
  /** Relative to this chapter's material package, always 补充/<编号>.md. */
  readonly 文件: string
  readonly 内容哈希: string
  readonly 性质: '原文' | '建议'
  readonly 适用章上限: number
  readonly 来源快照: SupplementSource & { readonly 起行: number; readonly 终行: number; readonly 读取哈希: string }
}

export type MaterialSectionRecord = SectionRecord | SupplementRecord

export function sectionFileName(index: number, name: 材料包段名): string {
  const nn = String(index + 1).padStart(2, '0')
  return `${nn}-${name}.md`
}
