/**
 * 章细纲解析(格式规格 §3.3):定位段、叙事单元、约束分级、来源引用。
 */

import { parseDocument } from '../repo/frontmatter'
import { parseSourceRef, type SourceRef } from '../repo/sourceRef'
import { 定位段小节, 单元字段, type 定位段名, type 单元字段名 } from './template'

export type ConstraintMark = '硬' | '软' | '自由'

export interface ConstraintHit {
  readonly mark: ConstraintMark
  readonly line: string
}

export interface OutlineUnit {
  readonly 标题: string
  readonly fields: Readonly<Partial<Record<单元字段名, string>>>
}

export interface ParsedOutline {
  readonly 状态: string | null
  readonly 来源引用: readonly string[]
  readonly 定位: Readonly<Partial<Record<定位段名, string>>>
  readonly units: readonly OutlineUnit[]
  readonly constraints: readonly ConstraintHit[]
}

const 单元字段集 = new Set<string>(单元字段)

/** 从 frontmatter 抽出 来源引用 列表(字符串或字符串数组皆可)。 */
export function extractSourceRefLines(fields: Readonly<Record<string, unknown>>): readonly string[] {
  const raw = fields['来源引用']
  if (raw === undefined || raw === null) return []
  if (typeof raw === 'string') {
    return raw.split('\n').map((s) => s.trim()).filter((s) => s !== '')
  }
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter((s) => s !== '')
  }
  return []
}

export function parseConstraintMarks(text: string): readonly ConstraintHit[] {
  const hits: ConstraintHit[] = []
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    if (line.includes('〔硬〕')) hits.push({ mark: '硬', line })
    else if (line.includes('〔软〕')) hits.push({ mark: '软', line })
    else if (line.includes('〔自由〕')) hits.push({ mark: '自由', line })
  }
  return hits
}

/** 硬约束行的可核对核心文本:去掉分级标记与列表前缀。 */
export function hardConstraintCore(line: string): string {
  return line.replace(/〔硬〕/g, '').replace(/〔软〕/g, '').replace(/^\s*[-*]\s+/, '').trim()
}

/**
 * 硬约束判定契约(F1,2026-09-05):自然语言约束不得整体做字符串包含判断。
 * 只有两类最小显式规则进确定性判定(term 截到首个句读、超长降级):
 * - 出现:「必须出现/须出现 X」→ X 必须在正文出现;
 * - 禁止:「不得出现/不得提及/禁止出现 X」→ X 不得在正文出现;
 * 其余(如「主角本章不得杀人」等语义类)一律「需审读」——确定性代码无法判定,
 * 不伪装成通过或失败,交语义审读。出处=规则名,调用方引用约束原句。
 */
export type HardConstraintRule =
  | { readonly kind: '出现'; readonly term: string; readonly 出处: string }
  | { readonly kind: '禁止'; readonly term: string; readonly 出处: string }
  | { readonly kind: '需审读'; readonly 出处: string }

// Only text-presence rules are deterministic. Semantic predicates such as
// "不得描写主角杀人" must stay in the semantic review lane.
const 出现规则词 = /(?:必须|须|应当|需要)(?:出现|提及)/
const 禁止规则词 = /(?:不得|禁止)(?:出现|提及)/
const TERM_MAX = 24

function extractTerm(core: string, match: RegExpExecArray): string | null {
  const rest = core.slice(match.index + match[0].length).trim()
  if (/(?:必须|须|应当|需要|不得|禁止)(?:出现|提及|描写)/.test(rest)) return null
  const term = rest.split(/[，。；、！？]/)[0]?.trim() ?? ''
  if (term === '' || term.length > TERM_MAX) return null
  const normalized = term.replace(/[「」]/g, '').trim()
  if (normalized === '') return null
  // A second rule in the same line means the first rule was only partially
  // parsed. Keep the whole line semantic so it cannot silently pass half of a
  // compound constraint.
  return normalized
}

export function classifyHardConstraint(line: string): HardConstraintRule {
  const core = hardConstraintCore(line)
  const ruleMarkers = core.match(/(?:必须|须|应当|需要|不得|禁止)(?:出现|提及|描写)/g) ?? []
  if (ruleMarkers.length > 1) return { kind: '需审读', 出处: core }
  // 规则词不限行首(真实约束常有「本章」「作者」等前缀);但必须带「出现/提及/写到」类
  // 文本在场动词——「不得杀人」这类纯语义禁令没有该动词,落需审读,不做字面判定。
  const m出 = 出现规则词.exec(core)
  if (m出 !== null) {
    const term = extractTerm(core, m出)
    if (term !== null) return { kind: '出现', term, 出处: `出现规则(${m出[0]}):${core}` }
  }
  const m禁 = 禁止规则词.exec(core)
  if (m禁 !== null) {
    const term = extractTerm(core, m禁)
    if (term !== null) return { kind: '禁止', term, 出处: `禁止规则(${m禁[0]}):${core}` }
  }
  return { kind: '需审读', 出处: core }
}

function headingLevel(line: string): { level: number; title: string } | null {
  const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
  if (!m) return null
  return { level: m[1]!.length, title: m[2]!.trim() }
}

function parseUnits(section: string): OutlineUnit[] {
  const units: OutlineUnit[] = []
  const lines = section.replace(/\r\n/g, '\n').split('\n')
  let current: { 标题: string; fields: Partial<Record<单元字段名, string>> } | null = null
  const flush = (): void => {
    if (current) units.push({ 标题: current.标题, fields: current.fields })
    current = null
  }
  for (const raw of lines) {
    const h = headingLevel(raw)
    if (h && h.level <= 3) {
      flush()
      current = { 标题: h.title, fields: {} }
      continue
    }
    if (current === null) continue
    const item = /^\s*[-*]\s+([^:：]+)[:：]\s*(.*)$/.exec(raw)
    if (!item) continue
    const name = item[1]!.trim()
    if (!单元字段集.has(name)) continue
    current.fields[name as 单元字段名] = item[2]!.trim()
  }
  flush()
  return units
}

function sliceAfter(body: string, heading: string): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const idx = lines.findIndex((l) => {
    const h = headingLevel(l)
    return h !== null && h.title === heading
  })
  if (idx < 0) return ''
  const startLevel = headingLevel(lines[idx]!)!.level
  const out: string[] = []
  for (let i = idx + 1; i < lines.length; i++) {
    const h = headingLevel(lines[i]!)
    if (h && h.level <= startLevel) break
    out.push(lines[i]!)
  }
  return out.join('\n').trim()
}

/** 解析章细纲全文:frontmatter + 定位段 + 细纲段。 */
export function parseOutline(text: string): ParsedOutline {
  const doc = parseDocument(text)
  const fields = doc.ok ? doc.data.fields : {}
  const body = doc.ok ? doc.data.body : text
  const 状态 = typeof fields['状态'] === 'string' ? fields['状态'] : null
  const 来源引用 = extractSourceRefLines(fields)

  const 定位: Partial<Record<定位段名, string>> = {}
  for (const name of 定位段小节) {
    const slice = sliceAfter(body, name)
    if (slice !== '') 定位[name] = slice
  }

  const 细纲 = sliceAfter(body, '细纲段')
  const units = 细纲 === '' ? [] : parseUnits(细纲)

  return {
    状态,
    来源引用,
    定位,
    units,
    constraints: parseConstraintMarks(body),
  }
}

export function parseSourceRefs(lines: readonly string[]): ReadonlyArray<SourceRef | null> {
  return lines.map((line) => parseSourceRef(line.startsWith('来源') ? line : `来源:${line}`))
}
