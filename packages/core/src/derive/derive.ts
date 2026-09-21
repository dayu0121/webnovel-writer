/**
 * 章节事实清单(格式规格 §8——扫描事实项清单;R1:代码如实报告事实并给一条可选建议,
 * 不产出权威位置;建议无权威、不参与门禁,该干什么由主 Agent 判断)。
 * 纯函数:输入章节事实,输出逐行事实与建议;不落地任何状态。
 */

import type { ChapterFacts } from './scan'

export interface ChapterFactRow {
  /** §8 行号(1–11,与规格表一一对应)。 */
  readonly row: number
  /** 环节标签(仅作显示用,非权威位置)。 */
  readonly 环节: string
  /** 该行对应事实是否成立(如实报告;行间可同时成立——事实清单不是位置)。 */
  readonly 事实: boolean
}

export interface ChapterDerivation {
  readonly 事实项: readonly ChapterFactRow[]
  /**
   * 可选建议:最靠后的成立环节(与旧「首中即返」链同序);建议无权威、不参与门禁。
   */
  readonly 建议: { readonly row: number; readonly 环节: string }
  /** 叠加标记(需复核的回流提示)。 */
  readonly 叠加标记: readonly string[]
}

/** §8 十一行事实清单(按表序;行号与规格一一对应)。 */
export function deriveChapterFacts(f: ChapterFacts): ChapterDerivation {
  const rows: ReadonlyArray<ChapterFactRow> = [
    { row: 1, 环节: '章细纲(待定位)', 事实: f.窗口就绪 },
    { row: 2, 环节: '章细纲(待确认)', 事实: f.候选细纲 },
    { row: 3, 环节: '写作备料', 事实: f.确认细纲 },
    { row: 4, 环节: '写稿', 事实: f.材料包状态 === '段齐备' },
    { row: 5, 环节: '润色', 事实: f.有草稿 },
    { row: 6, 环节: '审核', 事实: f.唯一待审稿 },
    // F5:审核记录对当前稿过期时,改稿环节(处置旧记录问题)不成立——须重审,停在审核
    { row: 7, 环节: '改稿', 事实: f.有审核记录 && !f.审核证据过期 },
    { row: 8, 环节: '定稿准备与沉淀', 事实: f.审核完成 && !f.待定稿包完整 },
    { row: 9, 环节: '作者定稿裁决', 事实: f.待定稿包完整 && f.裁决 !== '已退回' },
    { row: 10, 环节: '定稿入档', 事实: f.待定稿包完整 && f.裁决 === '已批准' },
    { row: 11, 环节: '完成', 事实: f.已定稿 },
  ]
  const hit = [...rows].reverse().find((r) => r.事实)
  const 叠加标记 = hit === undefined
    ? [...f.需复核标记, '窗口无可进入项→当前卷规划滚动补充']
    : f.需复核标记
  return {
    事实项: rows,
    建议: hit === undefined ? { row: 1, 环节: '章细纲(待定位)' } : { row: hit.row, 环节: hit.环节 },
    叠加标记,
  }
}
