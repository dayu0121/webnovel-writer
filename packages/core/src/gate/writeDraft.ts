/**
 * 写稿门槛(R1 落码,2026-08-29 拍板 7):「未确认细纲 / 材料包非可写」不再拒绝写入——
 * 它们属「视野丢失/跑偏编造」,靠喂料与审读治,不靠拒绝;该不该开写由主 Agent 判断,
 * 代码只如实播报(reportDraftReadiness)。草稿路径形状校验保留:草稿必须落在可解析的
 * 卷/章键路径下,否则推导看不见(格式规格 §8 的输入面)。
 */

import { listChapters, canonicalizeChapterKeys, normalizeChapterName, scanChapter, type ChapterKey } from '../derive/scan'
import { toPosixRel } from './paths'

export function isDraftRelPath(relPath: string): boolean {
  const p = toPosixRel(relPath)
  return p === '草稿区/草稿' || p.startsWith('草稿区/草稿/')
}

/** 从 `草稿区/草稿/卷NN-章名/...` 取章键;章号未知时为 0。 */
export function parseDraftChapterKey(relPath: string): ChapterKey | null {
  const p = toPosixRel(relPath)
  const rest = p.replace(/^草稿区\/草稿\/?/, '')
  if (!rest) return null
  const first = rest.split('/')[0] ?? ''
  const m = /^卷(\d+)-(.+?)(?:\.md)?$/.exec(first)
  if (!m) return null
  const 章名 = m[2]!
  if (章名 === '') return null
  return { 卷: Number(m[1]), 章: 0, 章名 }
}

/** 章键归并与 listChapters 同一实现(避免两处规则漂移):真源侧章号权威。 */
function resolveDraftKey(bookRoot: string, parsed: ChapterKey): ChapterKey {
  const merged = canonicalizeChapterKeys([...listChapters(bookRoot), parsed])
  const match = merged.find((k) => k.卷 === parsed.卷
    && normalizeChapterName(k.章名) === normalizeChapterName(parsed.章名)
    && k.章 > 0)
  return match ?? parsed
}

/**
 * 写稿门槛只剩路径形状一条:解析不出章键的草稿路径拒绝(推导不可见),
 * 其余一律放行——细纲确认状态与材料包状态经 reportDraftReadiness 如实呈报。
 */
export function gateWriteDraft(bookRoot: string, relPath: string):
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: string } {
  if (!isDraftRelPath(relPath)) return { allow: true }
  const parsed = parseDraftChapterKey(relPath)
  if (!parsed) return { allow: false, reason: '草稿路径无法解析章节键,拒绝写入(路径形状校验)' }
  return { allow: true }
}

export interface DraftReadiness {
  readonly 细纲已确认: boolean
  readonly 材料包状态: string | null
  readonly 说明: string
}

/** 如实播报:该草稿路径所在章的细纲确认状态与材料包状态(不参与门禁,R1 判据)。 */
export function reportDraftReadiness(bookRoot: string, relPath: string): DraftReadiness | null {
  if (!isDraftRelPath(relPath)) return null
  const parsed = parseDraftChapterKey(relPath)
  if (!parsed) return null
  const key = resolveDraftKey(bookRoot, parsed)
  const facts = scanChapter(bookRoot, key)
  const 细纲已确认 = facts.确认细纲
  const 材料包状态 = facts.材料包状态
  const parts: string[] = [细纲已确认 ? '细纲已确认' : '细纲未确认(播报,不阻断)']
  if (材料包状态 === null) parts.push('材料包未组装')
  else if (材料包状态 !== '可写') parts.push(`材料包${材料包状态}`)
  return { 细纲已确认, 材料包状态, 说明: parts.join(';') }
}
