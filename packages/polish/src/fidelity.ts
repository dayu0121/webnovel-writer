/**
 * 保真核对:硬约束仍须出现;CJK 删减不得过大。
 */

import { classifyHardConstraint, hardConstraintCore, parseOutline, type HardConstraintRule } from '@webnovel/core'

export const CJK_LOSS_LIMIT = 0.2

export interface FidelityRisk {
  readonly kind: '硬约束缺失' | '硬约束违反' | '需审读' | 'CJK删减过大'
  readonly detail: string
}

export function countCjk(text: string): number {
  const m = text.match(/[\u3400-\u9fff]/g)
  return m === null ? 0 : m.length
}

export function extractHardCores(outlineText: string): readonly string[] {
  return parseOutline(outlineText).constraints
    .filter((c) => c.mark === '硬')
    .map((c) => hardConstraintCore(c.line))
    .filter((s) => s !== '')
}

export function checkFidelity(input: {
  readonly draft: string
  readonly polished: string
  readonly outlineText: string
}): readonly FidelityRisk[] {
  const risks: FidelityRisk[] = []
  for (const hit of parseOutline(input.outlineText).constraints.filter((c) => c.mark === '硬')) {
    const rule: HardConstraintRule = classifyHardConstraint(hit.line)
    if (rule.kind === '需审读') {
      // Fidelity cannot establish a semantic violation. Leave the prose
      // eligible for the normal review lane, where the semantic reviewer can
      // inspect it, instead of manufacturing a polish failure.
      continue
    } else if (rule.kind === '出现' && !input.polished.includes(rule.term)) {
      risks.push({ kind: '硬约束缺失', detail: rule.term })
    } else if (rule.kind === '禁止' && input.polished.includes(rule.term)) {
      risks.push({ kind: '硬约束违反', detail: rule.term })
    }
  }
  const before = countCjk(input.draft)
  const after = countCjk(input.polished)
  if (before > 0 && (before - after) / before > CJK_LOSS_LIMIT) {
    risks.push({ kind: 'CJK删减过大', detail: `${before}→${after}` })
  }
  return risks
}
