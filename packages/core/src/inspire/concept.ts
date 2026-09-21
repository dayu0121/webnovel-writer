/**
 * 作品构想(PRD §3.1 / D19/D46):七要素组装与完整度检查。
 * 不产出契约/世界书/大纲;完整度检查不得代填留白。
 */

import { parseLabeledStates } from '../derive/design'
import { parseDocument, serializeDocument } from '../repo/frontmatter'

export const 构想七要素 = [
  '核心创意',
  '题材与目标读者',
  '主角核心欲望',
  '主要冲突',
  '核心看点',
  '差异化方向',
  '明确不要什么',
] as const

export const 构想必填要素 = ['核心创意', '题材与目标读者'] as const

export type 构想要素名 = (typeof 构想七要素)[number]
export type 构想确认状态 = '候选' | '已确认'

export interface Concept {
  readonly 状态: 构想确认状态
  readonly 核心创意: string
  readonly 题材与目标读者: string
  readonly 主角核心欲望?: string
  readonly 主要冲突?: string
  readonly 核心看点?: string
  readonly 差异化方向?: string
  readonly 明确不要什么?: string
  readonly 要素状态?: Partial<Record<构想要素名, string>>
}

export type Completeness =
  | { readonly ok: true }
  | { readonly ok: false; readonly gaps: readonly string[] }

const 必填集 = new Set<string>(构想必填要素)

export function isConceptBlank(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return true
  const t = value.trim()
  return t === '' || t === '留白' || t === '〔留白〕'
}

export function elementOf(concept: Concept, name: 构想要素名): string {
  return concept[name] ?? ''
}

export function elementStateOf(concept: Concept, name: 构想要素名): string {
  const marked = concept.要素状态?.[name]
  if (marked !== undefined && marked !== '') return marked
  return isConceptBlank(elementOf(concept, name)) ? '留白' : '已确认'
}

export function checkConceptCompleteness(concept: Concept | string | null | undefined): Completeness {
  if (concept === null || concept === undefined) {
    return { ok: false, gaps: ['构想不存在'] }
  }
  const parsed = typeof concept === 'string' ? parseConcept(concept) : concept
  if (parsed === null) return { ok: false, gaps: ['构想不存在'] }

  const gaps: string[] = []
  for (const name of 构想必填要素) {
    const blank = isConceptBlank(elementOf(parsed, name)) || elementStateOf(parsed, name) === '留白'
    if (blank) gaps.push(name)
  }
  if (parsed.状态 !== '已确认') gaps.push('构想未确认')
  return gaps.length === 0 ? { ok: true } : { ok: false, gaps }
}

export function parseConcept(text: string): Concept | null {
  if (text.trim() === '') return null
  const r = parseDocument(text)
  if (!r.ok) return null

  const labeled = parseLabeledStates(r.data.body)
  const states: Partial<Record<构想要素名, string>> = {}
  for (const e of labeled) {
    if ((构想七要素 as readonly string[]).includes(e.name)) {
      states[e.name as 构想要素名] = e.state
    }
  }
  const bodies = extractElementBodies(r.data.body)
  const 状态: 构想确认状态 = r.data.fields['状态'] === '已确认' ? '已确认' : '候选'

  return {
    状态,
    核心创意: bodies['核心创意'] ?? '',
    题材与目标读者: bodies['题材与目标读者'] ?? '',
    主角核心欲望: bodies['主角核心欲望'] ?? '',
    主要冲突: bodies['主要冲突'] ?? '',
    核心看点: bodies['核心看点'] ?? '',
    差异化方向: bodies['差异化方向'] ?? '',
    明确不要什么: bodies['明确不要什么'] ?? '',
    要素状态: states,
  }
}

export function serializeConcept(concept: Concept): string {
  const lines: string[] = ['# 作品构想', '']
  for (const name of 构想七要素) {
    const body = elementOf(concept, name)
    const state = elementStateOf(concept, name)
    lines.push(`## ${name} 〔${state}〕`, '')
    if (!isConceptBlank(body) && state !== '留白') {
      lines.push(body.trim(), '')
    }
  }
  return serializeDocument({ 状态: concept.状态 }, lines.join('\n').trimEnd() + '\n')
}

export function confirmConcept(concept: Concept): Concept {
  return { ...concept, 状态: '已确认' }
}

function extractElementBodies(body: string): Partial<Record<构想要素名, string>> {
  const out: Partial<Record<构想要素名, string[]>> = {}
  let current: 构想要素名 | null = null
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^\s*#{1,6}\s+(.+?)\s*[〔(]\s*(.+?)\s*[〕)]\s*$/.exec(line)
    const list = /^\s*-\s+(.+?)\s*[〔(]\s*(.+?)\s*[〕)]\s*$/.exec(line)
    const m = heading ?? list
    if (m && (构想七要素 as readonly string[]).includes(m[1]!.trim())) {
      current = m[1]!.trim() as 构想要素名
      out[current] = []
      continue
    }
    if (current) out[current]!.push(line)
  }
  const bodies: Partial<Record<构想要素名, string>> = {}
  for (const name of 构想七要素) {
    const lines = out[name]
    if (lines) bodies[name] = lines.join('\n').trim()
  }
  return bodies
}

export function requiredElementNames(): readonly string[] {
  return [...必填集]
}
