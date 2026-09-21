/**
 * 来源与版本(PRD §4.3 / 插件规格 §7):查询返回六要素来源标注;B4 区分没有数据与查询失败。
 */

import { parseDocument, type Frontmatter, type ReadResult } from '../repo/frontmatter'

export interface 来源标注 {
  readonly 条目: string
  readonly 片段: string
  readonly 来源: string
  readonly 版本: string | number
  readonly 状态: string
  readonly 完整性: string
}

export function annotate(a: 来源标注): 来源标注 {
  return {
    条目: a.条目,
    片段: a.片段,
    来源: a.来源,
    版本: a.版本,
    状态: a.状态,
    完整性: a.完整性,
  }
}

export type QueryOutcome<T> =
  | { readonly ok: true; readonly data: T; readonly 来源标注: 来源标注 }
  | { readonly ok: false; readonly reason: 'missing' | 'parse-error'; readonly detail: string; readonly 来源标注: 来源标注 }

export function withProvenance<T>(
  r: ReadResult<T>,
  base: Pick<来源标注, '条目' | '片段' | '来源'> & Partial<Pick<来源标注, '版本' | '状态' | '完整性'>>,
): QueryOutcome<T> {
  const 完整性 = base.完整性 ?? (r.ok ? '完整' : r.reason === 'missing' ? '无' : '残缺')
  const 来源标注 = annotate({
    条目: base.条目,
    片段: base.片段,
    来源: base.来源,
    版本: base.版本 ?? '',
    状态: base.状态 ?? '',
    完整性,
  })
  if (r.ok) return { ok: true, data: r.data, 来源标注 }
  return { ok: false, reason: r.reason, detail: r.detail, 来源标注 }
}

export interface VersionProtocol {
  readonly 版本: number
  readonly 父版本: number | null
  readonly 生成模块: string
  readonly 来源快照: unknown
}

export function extractVersionFields(fields: Readonly<Record<string, unknown>>): {
  readonly 版本: number | null
  readonly 父版本: number | null
  readonly 生成模块: string | null
  readonly 来源快照: unknown
} {
  return {
    版本: typeof fields['版本'] === 'number' ? fields['版本'] : null,
    父版本: typeof fields['父版本'] === 'number' ? fields['父版本'] : null,
    生成模块: typeof fields['生成模块'] === 'string' ? fields['生成模块'] : null,
    来源快照: fields['来源快照'] ?? null,
  }
}

export function applyVersionFields(
  fields: Readonly<Record<string, unknown>>,
  v: VersionProtocol,
): Record<string, unknown> {
  return {
    ...fields,
    版本: v.版本,
    父版本: v.父版本,
    生成模块: v.生成模块,
    来源快照: v.来源快照,
  }
}

export function versionFieldsFromDocument(text: string): ReadResult<ReturnType<typeof extractVersionFields>> {
  const r = parseDocument(text)
  if (!r.ok) return r
  return { ok: true, data: extractVersionFields(r.data.fields) }
}

export function initialVersion(生成模块: string, 来源快照: unknown = null): VersionProtocol {
  return { 版本: 1, 父版本: null, 生成模块, 来源快照 }
}

/** 新版本 = 父版本 + 1,并记录父版本。不提供已产出工件的重写入口。 */
export function bumpVersion(parentVersion: number, 生成模块: string, 来源快照: unknown = null): VersionProtocol {
  return { 版本: parentVersion + 1, 父版本: parentVersion, 生成模块, 来源快照 }
}

export function queryFrontmatter(
  text: string | null,
  base: Pick<来源标注, '条目' | '片段' | '来源'>,
): QueryOutcome<Frontmatter> {
  if (text === null) {
    return withProvenance({ ok: false, reason: 'missing', detail: '没有数据' }, base)
  }
  return withProvenance(parseDocument(text), base)
}
