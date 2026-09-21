/**
 * 后续范围报告（M1 改稿全链 design §4）：由「新正文＋确认细纲＋当前审核记录」纯函数计算，
 * 不调用 runReview / polish。硬约束回查失败写入报告、不阻断保存；正式结论交之后的审核。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ChapterKey } from '../derive/scan'
import { classifyHardConstraint, parseOutline } from '../outline/parse'
import { paths } from '../repo/paths'
import type { ReviewRecord } from '../evidence/record'

export interface FollowupReport {
  /** 硬约束回查失败:出现类未命中/禁止类命中的约束行(需审读类不在此列)。 */
  readonly 硬约束回查失败: readonly string[]
  /** F1:语义类硬约束——确定性代码无法判定,需语义审读。 */
  readonly 需语义审读: readonly string[]
  /** 当前记录里仍为「待处理」的发现项(不动处置，只呈报)。 */
  readonly 仍待处置: readonly {
    readonly 发现项编号: string
    readonly 模块名: string
    readonly 建议返回节点: string | null
  }[]
  /** 由仍待处置项的 建议复审模块/建议返回节点 归并出的建议重跑集（模块名）。 */
  readonly 建议重跑: readonly string[]
}

function readText(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf-8')
  } catch {
    return null
  }
}

export function followupReport(
  bookRoot: string,
  key: Pick<ChapterKey, '卷' | '章' | '章名'>,
  新正文: string,
  record: ReviewRecord | null,
): FollowupReport {
  // 硬约束回查(F1 契约):按分类器逐条判定——出现类未命中/禁止类命中列入失败;
  // 需审读类确定性代码无法判定,单列交语义审读
  const 硬约束回查失败: string[] = []
  const 需语义审读: string[] = []
  const 细纲文 = readText(bookRoot, paths.确认细纲(key.卷, key.章, key.章名))
  if (细纲文 !== null) {
    const parsed = parseOutline(细纲文)
    for (const c of parsed.constraints) {
      if (c.mark !== '硬') continue
      const rule = classifyHardConstraint(c.line)
      if (rule.kind === '出现' && !新正文.includes(rule.term)) 硬约束回查失败.push(c.line)
      if (rule.kind === '禁止' && 新正文.includes(rule.term)) 硬约束回查失败.push(c.line)
      if (rule.kind === '需审读') 需语义审读.push(rule.出处)
    }
  }

  const 仍待处置 = (record?.问题 ?? [])
    .filter((p) => p.处置状态 === '待处理')
    .map((p) => ({
      发现项编号: p.发现项编号,
      模块名: p.模块名,
      建议返回节点: p.建议返回节点 ?? null,
    }))

  const 建议重跑 = new Set<string>()
  for (const p of (record?.问题 ?? [])) {
    if (p.处置状态 !== '待处理') continue
    const from = (p as { readonly 建议复审模块?: string }).建议复审模块
    if (from && from.trim() !== '') 建议重跑.add(from.trim())
    if (p.建议返回节点 && p.建议返回节点 !== '改稿') 建议重跑.add(p.建议返回节点)
  }

  return { 硬约束回查失败, 需语义审读, 仍待处置, 建议重跑: [...建议重跑] }
}
