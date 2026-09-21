/**
 * 去AI痕迹润色首版规则(确定性,无 LLM)。
 */

export const BANNED_OPENERS = ['综上所述', '值得注意的是', '不可否认'] as const

export interface PolishChange {
  readonly kind: 'collapse' | 'opener' | 'ellipsis'
  readonly detail: string
}

export interface ApplyRulesResult {
  readonly text: string
  readonly changes: readonly PolishChange[]
}

function collapseRuns(input: string, changes: PolishChange[]): string {
  return input.replace(/([！!？?…])\1{2,}/g, (m, ch: string) => {
    changes.push({ kind: 'collapse', detail: `${ch}×${m.length}` })
    if (ch === '…') return '……'
    return ch + ch
  })
}

function normalizeEllipsis(input: string, changes: PolishChange[]): string {
  return input.replace(/(?:\.{3}|…{1,}|…\.{1,}|．{3})/g, (m) => {
    if (m === '……') return m
    changes.push({ kind: 'ellipsis', detail: m })
    return '……'
  })
}

function stripBannedOpeners(input: string, changes: PolishChange[]): string {
  const paras = input.replace(/\r\n/g, '\n').split('\n')
  return paras.map((line) => {
    const trimmed = line.replace(/^\s+/, '')
    for (const opener of BANNED_OPENERS) {
      if (trimmed === opener || trimmed.startsWith(`${opener}，`) || trimmed.startsWith(`${opener},`) || trimmed.startsWith(`${opener}。`)) {
        const rest = trimmed.slice(opener.length).replace(/^[，,。\s]+/, '')
        changes.push({ kind: 'opener', detail: opener })
        const lead = line.slice(0, line.length - trimmed.length)
        return `${lead}${rest}`
      }
    }
    return line
  }).join('\n')
}

/** 应用窄规则集,不发明新散文。 */
export function applyPolishRules(text: string): ApplyRulesResult {
  const changes: PolishChange[] = []
  let out = text.replace(/\r\n/g, '\n')
  out = collapseRuns(out, changes)
  out = normalizeEllipsis(out, changes)
  out = stripBannedOpeners(out, changes)
  return { text: out, changes }
}
