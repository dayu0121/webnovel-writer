/**
 * 润色入口:读选定/最新草稿,写新版本;无保真风险才标 待审稿。
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
  nextDraftFileName,
  parseDocument,
  paths,
  serializeDocument,
  splitCandidateFacts,
  writeFileAtomic,
  草稿字段序,
  type ChapterKey,
} from '@webnovel/core'
import { checkFidelity, type FidelityRisk } from './fidelity'
import { applyPolishRules, type PolishChange } from './rules'
import { bookWriter } from '@webnovel/core'

export interface PolishInput {
  readonly 卷: number
  readonly 章: number
  readonly 章名: string
}

export interface PolishResult {
  readonly ok: boolean
  readonly relPath: string
  readonly 角色: string
  readonly risks: readonly FidelityRisk[]
  readonly changes: readonly PolishChange[]
  readonly reason?: string
}

const DRAFT_KEYS = ['身份', '版本', '父版本', '生成模块', '来源快照', '角色', '选定', '保真风险'] as const

function readText(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf-8')
  } catch {
    return null
  }
}

function listDraftFiles(bookRoot: string, key: Pick<ChapterKey, '卷' | '章名'>): string[] {
  const abs = path.join(bookRoot, paths.草稿目录(key.卷, key.章名))
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return []
  return fs.readdirSync(abs).filter((f) => f.endsWith('.md')).sort((a, b) => a.localeCompare(b, 'zh'))
}

function parseDraftNo(file: string): number {
  const m = /^稿(\d+)\.md$/.exec(file)
  return m ? Number(m[1]) : 0
}

interface DraftView {
  readonly file: string
  readonly rel: string
  readonly text: string
  readonly fields: Record<string, unknown>
  readonly body: string
  readonly no: number
}

function loadDrafts(bookRoot: string, key: Pick<ChapterKey, '卷' | '章名'>): DraftView[] {
  const dir = paths.草稿目录(key.卷, key.章名)
  const views: DraftView[] = []
  for (const file of listDraftFiles(bookRoot, key)) {
    const rel = path.posix.join(dir, file)
    const text = readText(bookRoot, rel)
    if (text === null) continue
    const doc = parseDocument(text)
    if (!doc.ok) continue
    views.push({ file, rel, text, fields: doc.data.fields, body: doc.data.body, no: parseDraftNo(file) })
  }
  return views
}

/**
 * 润色源:已有待审稿就在它之上继续润色(否则上一版成果会被丢弃),
 * 其次是选定草稿,最后退回最新一稿。
 */
function pickSource(drafts: readonly DraftView[]): DraftView | null {
  if (drafts.length === 0) return null
  const pending = drafts.filter((d) => d.fields['角色'] === '待审稿')
  if (pending.length > 0) return pending.reduce((a, b) => (b.no >= a.no ? b : a))
  const selected = drafts.filter((d) => d.fields['选定'] === true)
  if (selected.length > 0) return selected[selected.length - 1]!
  return drafts.reduce((a, b) => (b.no >= a.no ? b : a))
}

/** 新待审稿产生前先降级旧待审稿,保证任一时刻待审稿唯一、选定唯一。 */
function demoteOtherDrafts(bookRoot: string, keepRelPath: string, key: Pick<ChapterKey, '卷' | '章名'>): void {
  demoteOtherPendingDrafts(bookRoot, key, keepRelPath)
}

function polishDraftLocked(bookRoot: string, key: PolishInput): PolishResult {
  assertSegment(key.章名, '章名')
  const drafts = loadDrafts(bookRoot, key)
  const src = pickSource(drafts)
  if (src === null) {
    return listDraftFiles(bookRoot, key).length === 0
      ? { ok: false, relPath: '', 角色: '', risks: [], changes: [], reason: '无草稿' }
      : { ok: false, relPath: '', 角色: '', risks: [], changes: [], reason: '草稿解析失败' }
  }

  // 候选事实段保真:润色执行只见正文,候选段由代码原样带到新稿,不经模型转写
  const split = splitCandidateFacts(src.body)
  const applied = applyPolishRules(split.prose)
  const outline = readText(bookRoot, paths.确认细纲(key.卷, key.章, key.章名)) ?? ''
  const risks = checkFidelity({ draft: split.prose, polished: applied.text, outlineText: outline })
  const 角色 = risks.length === 0 ? '待审稿' : '草稿'

  const parent = extractVersionFields(src.fields).版本
  const ver = parent === null ? initialVersion('润色') : bumpVersion(parent, '润色')
  const relPath = path.posix.join(paths.草稿目录(key.卷, key.章名), nextDraftFileName(bookRoot, key))
  // 先降级再写新稿:中途失败留下 0 份待审稿(可再润色),而不是 2 份(死锁)
  if (角色 === '待审稿') demoteOtherDrafts(bookRoot, relPath, key)
  const fields = applyVersionFields(
    {
      ...src.fields,
      身份: { 卷: key.卷, 章: key.章, 章名: key.章名 },
      角色,
      选定: 角色 === '待审稿',
      ...(risks.length > 0 ? { 保真风险: risks.map((r) => `${r.kind}:${r.detail}`) } : {}),
    },
    ver,
  )
  writeFileAtomic(bookRoot, relPath, serializeDocument(fields, composeBody(applied.text, split.facts), 草稿字段序))
  return { ok: true, relPath, 角色, risks, changes: applied.changes }
}

export const polishDraft = bookWriter(polishDraftLocked)
