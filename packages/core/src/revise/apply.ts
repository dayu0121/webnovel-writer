/**
 * 改稿最小(PRD §3.5.6):只消费规范化发现项与已授权处置,不重读报告。
 */

import * as path from 'node:path'
import {
  composeBody,
  demoteOtherPendingDrafts,
  prepareDraftDemotions,
  findPendingReviewDraft,
  nextDraftFileName,
  splitCandidateFacts,
  草稿字段序,
} from '../repo/drafts'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { writeBatchAtomic, writeFileAtomic, type FileOp } from '../repo/atomic'
import { paths } from '../repo/paths'
import { applyVersionFields, bumpVersion, extractVersionFields, initialVersion } from '../provenance'
import { loadReviewRecord, readReviewRecordForUpdate, serializeReviewRecord, reviewRecordHashOf, 处置状态列表, type ReviewRecord, type 处置状态 } from '../evidence/record'
import type { ChapterKey } from '../derive/scan'
import { lineDiff, type DiffLine } from './diff'
import { followupReport, type FollowupReport } from './followup'
import { bookWriter } from '../repo/atomic'

export interface RevisionPatch {
  readonly old: string
  readonly new: string
}

export interface ApplyRevisionInput {
  readonly 发现项编号: string
  readonly 处置: 处置状态
  readonly 补丁?: RevisionPatch
  readonly 范围?: string
  readonly 改动说明?: string
  readonly 审核记录哈希?: string
  /** 默认 改稿;作者口述的一段替换传 作者手改(M1 design §3,计入同一改稿协议)。 */
  readonly 生成模块?: string
}

export type ApplyRevisionResult =
  | {
      readonly ok: true
      readonly relPath?: string
      readonly 审核记录哈希: string
      /** 产出新稿时:相对父版本的行级差异。 */
      readonly diff?: readonly DiffLine[]
      /** 后续范围报告(M1:两次写入后都返回,不自动跑润色/审核)。 */
      readonly followup?: FollowupReport
    }
  | { readonly ok: false; readonly reason: string }

const TRUE_SOURCE = ['世界书', '大纲', '作品契约', '构想', '账本', '本书记忆'] as const

function checkRecord(record: ReviewRecord, actualHash: string, expectedHash?: string): string | undefined {
  if (expectedHash !== undefined && !/^[a-f0-9]{64}$/.test(expectedHash)) return '审核记录哈希格式无效'
  if (expectedHash !== undefined && expectedHash !== actualHash) return '审核记录已变化，请重新查询状态并读取记录后再处置'
  const seen = new Set<string>()
  for (const finding of record.问题) {
    if (!finding.发现项编号.trim()) return '审核记录含空发现项编号'
    if (seen.has(finding.发现项编号)) return `审核记录含重复发现项编号:${finding.发现项编号}`
    seen.add(finding.发现项编号)
  }
  return undefined
}

function upstreamAllowed(disposition: 处置状态, changesDraft: boolean): boolean {
  return !changesDraft && ['待处理', '作者保留', '已驳回', '无法判断'].includes(disposition)
}

function touchesTrueSource(scope: string | undefined): boolean {
  if (scope === undefined || scope.trim() === '') return false
  return TRUE_SOURCE.some((s) => scope.includes(s))
}

function uniqueReplace(haystack: string, oldText: string, newText: string):
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string } {
  if (oldText === '') return { ok: false, reason: '补丁旧文为空' }
  const parts = haystack.split(oldText)
  if (parts.length === 1) return { ok: false, reason: '补丁旧文未命中待审稿' }
  if (parts.length > 2) return { ok: false, reason: '补丁旧文命中不唯一' }
  return { ok: true, text: parts.join(newText) }
}

/** 落实一条发现项处置。真源变更一律呈报,不在此写入。 */
function applyRevisionLocked(
  bookRoot: string,
  key: Pick<ChapterKey, '卷' | '章' | '章名'>,
  input: ApplyRevisionInput,
): ApplyRevisionResult {
  if (!(处置状态列表 as readonly string[]).includes(input.处置)) return { ok: false, reason: `处置状态非法:${input.处置}` }
  if (touchesTrueSource(input.范围) && !upstreamAllowed(input.处置, input.补丁 !== undefined)) return { ok: false, reason: '须呈报上游' }
  if (input.处置 === '待处理' && input.补丁 !== undefined) {
    return { ok: false, reason: '处置为「待处理」不得带补丁——先给显式处置,或改为「已接受修改」' }
  }

  const snapshot = readReviewRecordForUpdate(bookRoot, key)
  if (!snapshot.ok) return snapshot
  const { record } = snapshot
  const conflict = checkRecord(record, snapshot.hash, input.审核记录哈希)
  if (conflict !== undefined) return { ok: false, reason: conflict }
  const idx = record.问题.findIndex((p) => p.发现项编号 === input.发现项编号)
  if (idx < 0) return { ok: false, reason: `发现项不存在:${input.发现项编号}` }

  const finding = record.问题[idx]!
  if ((touchesTrueSource(input.范围) || touchesTrueSource(finding.影响范围)) && !upstreamAllowed(input.处置, input.补丁 !== undefined)) {
    return { ok: false, reason: '须呈报上游' }
  }

  let relPath: string | undefined
  let diff: readonly DiffLine[] | undefined
  const ops: FileOp[] = []
  const shouldPatch = (input.处置 === '已解决' || input.处置 === '已接受修改') && input.补丁 !== undefined
  if (shouldPatch) {
    const pending = findPendingReviewDraft(bookRoot, key)
    if (pending === null) return { ok: false, reason: '无待审稿' }
    const doc = parseDocument(pending.text)
    if (!doc.ok) return { ok: false, reason: `待审稿解析失败:${doc.detail}` }
    // 补丁只在正文上匹配;候选事实段原样带过,不当正文改
    const split = splitCandidateFacts(doc.data.body)
    const replaced = uniqueReplace(split.prose, input.补丁!.old, input.补丁!.new)
    if (!replaced.ok) return replaced
    // 改稿产出新一版:原稿原样留档,补丁可回溯到具体版本(与写稿/润色同一版本语义)
    const parent = extractVersionFields(doc.data.fields).版本
    const baseVer = parent === null ? initialVersion('改稿') : bumpVersion(parent, '改稿')
    const ver = { ...baseVer, ...(input.生成模块 === undefined ? {} : { 生成模块: input.生成模块 }) }
    relPath = path.posix.join(paths.草稿目录(key.卷, key.章名), nextDraftFileName(bookRoot, key))
    ops.push(...prepareDraftDemotions(bookRoot, key, relPath))
    const fields = applyVersionFields({ ...doc.data.fields, 角色: '待审稿', 选定: true }, ver)
    ops.push({ relPath, content: serializeDocument(fields, composeBody(replaced.text, split.facts), 草稿字段序) })
    diff = lineDiff(split.prose, replaced.text)
  }

  const 问题 = record.问题.map((p, i) => (
    i === idx ? { ...p, 处置: input.处置, 处置状态: input.处置, ...(input.改动说明 === undefined ? {} : { 处置说明: input.改动说明 }) } : p
  ))
  const content = serializeReviewRecord({ ...record, 问题 })
  ops.push({ relPath: paths.审核记录(key.卷, key.章名), content })
  writeBatchAtomic(bookRoot, ops)
  const 审核记录哈希 = reviewRecordHashOf(content)

  // 后续范围报告(M1:两次写入都返回,只改处置亦然)——对当前待审稿正文计算,不自动跑润色/审核
  const pending = findPendingReviewDraft(bookRoot, key)
  const pendingDoc = pending === null ? null : parseDocument(pending.text)
  const 新正文 = pendingDoc !== null && pendingDoc.ok ? pendingDoc.data.body : ''
  const followup = followupReport(bookRoot, key, 新正文, loadReviewRecord(bookRoot, key))
  return relPath === undefined ? { ok: true, followup, 审核记录哈希 } : { ok: true, relPath, diff, followup, 审核记录哈希 }
}

export const applyRevision = bookWriter(applyRevisionLocked)

export interface RevisionBatchDisposition {
  readonly 发现项编号: string
  readonly 处置: 处置状态
  /** 子代理映射清单或作者口述的那一行改动说明。 */
  readonly 改动说明?: string
}

export interface ApplyRevisionBatchInput {
  readonly 审核记录哈希?: string
  readonly 卷: number
  readonly 章: number
  readonly 章名: string
  /** 整稿 prose(改稿子代理产出);不传＝只回写处置,不产生新稿。 */
  readonly 新稿正文?: string
  /** 不传＝沿用源稿候选事实段。 */
  readonly 候选事实?: readonly string[]
  /** 默认 改稿子代理;作者手改时传 作者手改(D7)。 */
  readonly 生成模块?: string
  readonly 处置: readonly RevisionBatchDisposition[]
}

export type ApplyRevisionBatchResult =
  | { readonly ok: true; readonly relPath?: string; readonly 更新条数: number; readonly 审核记录哈希: string }
  | { readonly ok: false; readonly reason: string }

/**
 * 处置批落实(R9/design §5.1):一次写新稿并回写全部处置,任一步校验失败整批不写。
 * 新稿只动 prose;候选事实沿用源稿,除非显式传 候选事实 覆盖。
 */
function applyRevisionBatchLocked(
  bookRoot: string,
  input: ApplyRevisionBatchInput,
): ApplyRevisionBatchResult {
  const key = { 卷: input.卷, 章: input.章, 章名: input.章名 }
  const snapshot = readReviewRecordForUpdate(bookRoot, key)
  if (!snapshot.ok) return snapshot
  const { record } = snapshot
  const conflict = checkRecord(record, snapshot.hash, input.审核记录哈希)
  if (conflict !== undefined) return { ok: false, reason: conflict }
  if (input.处置.length === 0) return { ok: false, reason: '处置清单为空' }
  const byId = new Map(record.问题.map((p) => [p.发现项编号, p]))
  const seen = new Set<string>()
  for (const d of input.处置) {
    if (seen.has(d.发现项编号)) return { ok: false, reason: `处置编号重复:${d.发现项编号}` }
    seen.add(d.发现项编号)
    if (!(处置状态列表 as readonly string[]).includes(d.处置)) {
      return { ok: false, reason: `处置状态非法:${d.处置}` }
    }
    const finding = byId.get(d.发现项编号)
    if (finding === undefined) return { ok: false, reason: `发现项不存在:${d.发现项编号}` }
    if (touchesTrueSource(finding.影响范围) && !upstreamAllowed(d.处置, input.新稿正文 !== undefined || input.候选事实 !== undefined)) return { ok: false, reason: '须呈报上游' }
  }

  const ops: FileOp[] = []
  let relPath: string | undefined
  if (input.新稿正文 !== undefined) {
    const pending = findPendingReviewDraft(bookRoot, key)
    if (pending === null) return { ok: false, reason: '无待审稿' }
    const doc = parseDocument(pending.text)
    if (!doc.ok) return { ok: false, reason: `待审稿解析失败:${doc.detail}` }
    const split = splitCandidateFacts(doc.data.body)
    const facts = input.候选事实 ?? split.facts
    const parent = extractVersionFields(doc.data.fields).版本
    const baseVer = parent === null ? initialVersion('改稿') : bumpVersion(parent, '改稿')
    const ver = {
      ...baseVer,
      ...(input.生成模块 === undefined ? {} : { 生成模块: input.生成模块 }),
      来源快照: { 处置编号: input.处置.map((d) => d.发现项编号) },
    }
    relPath = path.posix.join(paths.草稿目录(key.卷, key.章名), nextDraftFileName(bookRoot, key))
    ops.push(...prepareDraftDemotions(bookRoot, key, relPath))
    const fields = applyVersionFields({
      ...doc.data.fields,
      角色: '待审稿',
      选定: true,
    }, ver)
    ops.push({ relPath, content: serializeDocument(fields, composeBody(input.新稿正文, facts), 草稿字段序) })
  }

  const 问题 = record.问题.map((p) => {
    const d = input.处置.find((x) => x.发现项编号 === p.发现项编号)
    if (d === undefined) return p
    return { ...p, 处置: d.处置, 处置状态: d.处置, ...(d.改动说明 === undefined ? {} : { 处置说明: d.改动说明 }) }
  })
  const content = serializeReviewRecord({ ...record, 问题 })
  ops.push({
    relPath: paths.审核记录(key.卷, key.章名),
    content,
  })
  writeBatchAtomic(bookRoot, ops)
  return { ok: true, relPath, 更新条数: input.处置.length, 审核记录哈希: reviewRecordHashOf(content) }
}

export const applyRevisionBatch = bookWriter(applyRevisionBatchLocked)

export interface IngestAuthorRevisionResult {
  readonly ok: true
  readonly relPath: string
  readonly diff: readonly DiffLine[]
  readonly followup: FollowupReport
}
export type IngestAuthorRevisionFailure = { readonly ok: false; readonly reason: string }

/**
 * 作者手改的全文摄入(M1 design §3):作者贴来的整章正文**原样落盘**(仅 \r\n→\n 与收尾
 * 空行归一,内文换行与标点一字不动),版本+1、降级旧待审稿,`生成模块=作者手改`。
 * 发现项处置一概不动;返回后续范围报告与相对父版本的行级差异。
 * 主 Agent 不得把「一段意见」或「一段替换」送进此 API——那分别走 recordAuthorFinding
 * 与带补丁的 applyRevision。
 */
function ingestAuthorRevisionLocked(
  bookRoot: string,
  key: Pick<ChapterKey, '卷' | '章' | '章名'>,
  body: string,
): IngestAuthorRevisionResult | IngestAuthorRevisionFailure {
  if (body.trim() === '') return { ok: false, reason: '作者全文为空' }
  const pending = findPendingReviewDraft(bookRoot, key)
  if (pending === null) return { ok: false, reason: '无待审稿' }
  const doc = parseDocument(pending.text)
  if (!doc.ok) return { ok: false, reason: `待审稿解析失败:${doc.detail}` }

  const parentBody = doc.data.body
  const parent = extractVersionFields(doc.data.fields).版本
  const baseVer = parent === null ? initialVersion('作者手改') : bumpVersion(parent, '作者手改')
  const ver = { ...baseVer, 生成模块: '作者手改' }
  const relPath = path.posix.join(paths.草稿目录(key.卷, key.章名), nextDraftFileName(bookRoot, key))
  demoteOtherPendingDrafts(bookRoot, key, relPath)
  const fields = applyVersionFields(
    { ...doc.data.fields, 角色: '待审稿', 选定: true },
    ver,
  )
  writeFileAtomic(bookRoot, relPath, serializeDocument(fields, body, 草稿字段序))

  const record = loadReviewRecord(bookRoot, key)
  const followup = followupReport(bookRoot, key, body, record)
  const diff = lineDiff(parentBody, body)
  return { ok: true, relPath, diff, followup }
}

export const ingestAuthorRevision = bookWriter(ingestAuthorRevisionLocked)
