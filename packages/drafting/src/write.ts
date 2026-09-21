/**
 * 单稿写作(插件规格 §5 草稿协议):干净上下文 / 硬约束提醒 / 版本 / 候选事实 / 完整性。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  applyVersionFields,
  assertSegment,
  bumpVersion,
  composeBody,
  demoteOtherPendingDrafts,
  extractVersionFields,
  initialVersion,
  parseDocument,
  paths,
  scanChapter,
  serializeDocument,
  splitCandidateFacts,
  writeFileAtomic,
  type ChapterKey,
} from '@webnovel/core'
import { bookWriter } from '@webnovel/core'

// 候选事实段拆拼自 core 迁入(repo/drafts.ts),重导出保持旧 import 可用
export { CANDIDATE_HEADING, composeBody, splitCandidateFacts } from '@webnovel/core'

export interface WriteDraftInput {
  readonly 卷: number
  readonly 章: number
  readonly 章名: string
  readonly body: string
  readonly 选定?: boolean
  readonly 候选事实?: readonly string[]
}

export interface WriteDraftResult {
  readonly ok: boolean
  readonly relPath: string
  readonly gaps: readonly string[]
  /** R1 播报:细纲确认状态与材料包状态,不参与门禁。 */
  readonly 播报?: string
}

export interface DraftInfo {
  readonly file: string
  readonly relPath: string
  readonly 角色: string | null
  readonly 选定: boolean
  readonly 版本: number | null
}

const DRAFT_KEYS = ['身份', '版本', '父版本', '生成模块', '来源快照', '角色', '选定'] as const

function readText(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf-8')
  } catch {
    return null
  }
}

function draftDir(key: Pick<ChapterKey, '卷' | '章名'>): string {
  return paths.草稿目录(key.卷, key.章名)
}

function listDraftFiles(bookRoot: string, key: Pick<ChapterKey, '卷' | '章名'>): string[] {
  const abs = path.join(bookRoot, draftDir(key))
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return []
  return fs.readdirSync(abs).filter((f) => f.endsWith('.md')).sort((a, b) => a.localeCompare(b, 'zh'))
}

function parseDraftNo(file: string): number {
  const m = /^稿(\d+)\.md$/.exec(file)
  return m ? Number(m[1]) : 0
}

function latestVersion(bookRoot: string, key: Pick<ChapterKey, '卷' | '章名'>): number | null {
  let max: number | null = null
  for (const file of listDraftFiles(bookRoot, key)) {
    const text = readText(bookRoot, path.posix.join(draftDir(key), file))
    if (text === null) continue
    const doc = parseDocument(text)
    if (!doc.ok) continue
    const v = extractVersionFields(doc.data.fields).版本
    if (v !== null && (max === null || v > max)) max = v
  }
  return max
}

function nextFileName(bookRoot: string, key: Pick<ChapterKey, '卷' | '章名'>): string {
  const nos = listDraftFiles(bookRoot, key).map(parseDraftNo)
  const next = nos.length === 0 ? 1 : Math.max(...nos) + 1
  return `稿${next}.md`
}

/** R1 播报(R1 落码 2026-09-05,原 gateCanWrite 门槛摘除):如实报告细纲与材料包状态,不拒绝写。 */
function readinessBroadcast(bookRoot: string, key: ChapterKey): string {
  const f = scanChapter(bookRoot, key)
  const parts = [f.确认细纲 ? '细纲已确认' : '细纲未确认(播报,不阻断)']
  parts.push(f.材料包状态 === null ? '材料包未组装' : `材料包${f.材料包状态}`)
  return parts.join(';')
}

export function listDrafts(bookRoot: string, key: Pick<ChapterKey, '卷' | '章名'>): readonly DraftInfo[] {
  return listDraftFiles(bookRoot, key).map((file) => {
    const relPath = path.posix.join(draftDir(key), file)
    const text = readText(bookRoot, relPath) ?? ''
    const doc = parseDocument(text)
    const fields = doc.ok ? doc.data.fields : {}
    return {
      file,
      relPath,
      角色: typeof fields['角色'] === 'string' ? fields['角色'] : null,
      选定: fields['选定'] === true,
      版本: extractVersionFields(fields).版本,
    }
  })
}

function selectDraftLocked(
  bookRoot: string,
  input: Pick<ChapterKey, '卷' | '章名'> & { readonly file: string },
): { readonly ok: boolean; readonly reason?: string } {
  assertSegment(input.章名, '章名')
  const dir = draftDir(input)
  const target = input.file.endsWith('.md') ? input.file : `${input.file}.md`
  const files = listDraftFiles(bookRoot, input)
  if (!files.includes(target)) return { ok: false, reason: `草稿不存在:${target}` }
  for (const file of files) {
    const rel = path.posix.join(dir, file)
    const text = readText(bookRoot, rel)
    if (text === null) continue
    const doc = parseDocument(text)
    if (!doc.ok) continue
    const fields = { ...doc.data.fields, 选定: file === target }
    writeFileAtomic(bookRoot, rel, serializeDocument(fields, doc.data.body, DRAFT_KEYS))
  }
  return { ok: true }
}

export const selectDraft = bookWriter(selectDraftLocked)

/** 写一版草稿。调用方提供正文(非 LLM)。 */
function writeDraftLocked(bookRoot: string, input: WriteDraftInput): WriteDraftResult {
  assertSegment(input.章名, '章名')
  const key = { 卷: input.卷, 章: input.章, 章名: input.章名 }
  const 播报 = readinessBroadcast(bookRoot, key)

  const split = splitCandidateFacts(input.body)
  const facts = [...split.facts, ...(input.候选事实 ?? [])].map((s) => s.trim()).filter((s) => s !== '')
  const prose = split.prose.trim()
  const gaps: string[] = []
  if (prose === '') gaps.push('正文为空')
  if (gaps.length > 0) return { ok: false, relPath: '', gaps }

  const parent = latestVersion(bookRoot, key)
  const ver = parent === null ? initialVersion('写稿') : bumpVersion(parent, '写稿')
  const file = nextFileName(bookRoot, key)
  const relPath = path.posix.join(draftDir(key), file)
  const fields = applyVersionFields(
    {
      身份: { 卷: input.卷, 章: input.章, 章名: input.章名 },
      角色: '草稿',
      选定: input.选定 === true,
    },
    ver,
  )
  writeFileAtomic(bookRoot, relPath, serializeDocument(fields, composeBody(prose, facts), DRAFT_KEYS))

  if (input.选定 === true) {
    const sel = selectDraft(bookRoot, { 卷: input.卷, 章名: input.章名, file })
    if (!sel.ok) return { ok: false, relPath, gaps: [sel.reason ?? '选定失败'] }
  }
  return { ok: true, relPath, gaps: [], 播报 }
}

export const writeDraft = bookWriter(writeDraftLocked)

export interface ImportAuthorDraftInput {
  readonly 卷: number
  readonly 章: number
  readonly 章名: string
  readonly 正文: string
  readonly 候选事实?: readonly string[]
  /** 写稿节点用 草稿;润色/改稿节点贴作者改过的版本用 待审稿。 */
  readonly 角色: '草稿' | '待审稿'
  /** 整章自写＝作者手写;在某稿基础上改＝作者手改。 */
  readonly 生成模块: '作者手写' | '作者手改'
  /** 作者手改时指向被改的稿;缺省取该章最新版本。 */
  readonly 父版本?: number
}

export type ImportAuthorDraftResult =
  | { readonly ok: true; readonly relPath: string; readonly 播报?: string }
  | { readonly ok: false; readonly reason: string }

/**
 * 作者稿导入(写稿 seam 的「作者手写/作者手改」实现,PRD §3.5.3):作者稿与 AI 稿地位相同,
 * 只在 生成模块 留痕。角色 待审稿 时先降级既有待审稿再写(与润色同一纪律)。
 * R1:细纲/材料包状态只播报不拒绝。
 */
function importAuthorDraftLocked(bookRoot: string, input: ImportAuthorDraftInput): ImportAuthorDraftResult {
  try {
    assertSegment(input.章名, '章名')
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
  const key = { 卷: input.卷, 章: input.章, 章名: input.章名 }
  const 播报 = readinessBroadcast(bookRoot, key)

  const split = splitCandidateFacts(input.正文)
  const facts = [...split.facts, ...(input.候选事实 ?? [])].map((s) => s.trim()).filter((s) => s !== '')
  const prose = split.prose.trim()
  if (prose === '') return { ok: false, reason: '正文为空' }

  const explicitParent = input.父版本 ?? latestVersion(bookRoot, key)
  const ver = explicitParent === null ? initialVersion('作者稿导入') : bumpVersion(explicitParent, '作者稿导入')
  const file = nextFileName(bookRoot, key)
  const relPath = path.posix.join(draftDir(key), file)
  if (input.角色 === '待审稿') demoteOtherPendingDrafts(bookRoot, key, relPath)
  const fields = applyVersionFields(
    {
      身份: { 卷: input.卷, 章: input.章, 章名: input.章名 },
      角色: input.角色,
      选定: input.角色 === '待审稿',
    },
    { ...ver, 生成模块: input.生成模块 },
  )
  writeFileAtomic(bookRoot, relPath, serializeDocument(fields, composeBody(prose, facts), DRAFT_KEYS))
  return { ok: true, relPath, 播报 }
}

export const importAuthorDraft = bookWriter(importAuthorDraftLocked)
