/**
 * 章细纲空候选模板(格式规格 §3.3):定位段固定小节 + 一个空叙事单元。
 */

export const 定位段小节 = [
  '来源窗口项及拆并关系',
  '章节功能',
  '视角与焦点',
  '时空锚定',
  '起止边界',
  '故事线与承诺分配',
  '信息边界',
  '情绪与节奏目标',
  '前置条件核对结果',
] as const

export const 单元字段 = [
  '目标',
  '人物',
  '时空',
  '行动/冲突',
  '信息披露',
  '状态变化',
] as const

export type 定位段名 = (typeof 定位段小节)[number]
export type 单元字段名 = (typeof 单元字段)[number]

/** 空候选正文:定位段九节 + 细纲段一个空单元,不发明情节。 */
export function emptyCandidateBody(): string {
  const lines: string[] = ['# 章细纲', '', '## 定位段', '']
  for (const name of 定位段小节) {
    lines.push(`### ${name}`, '', '')
  }
  lines.push('## 细纲段', '', '### 单元 1', '')
  for (const field of 单元字段) {
    lines.push(`- ${field}:`, '')
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}
