import * as fs from 'node:fs'
import * as path from 'node:path'
import { bookWriter, writeBatchAtomic, type FileOp } from '../repo/atomic'
import { shortStoryHash } from './hash'
import { shortStoryReviewFingerprint, SHORT_STORY_REVIEW_REVISION } from './identity'
import { listShortStoryDrafts, prepareShortStoryDraft, pendingShortStoryDraft, readShortStoryManifest } from './drafts'
import { readConfirmedShortStoryPlan } from './plan'
import { shortStoryPaths, STORY_MACHINE_SCHEMA_VERSION, type ShortStoryManifest, type ShortStoryRulePackRef } from './paths'

export const SHORT_STORY_REVIEW_MODULES = ['结构与因果', '人物与情绪', '连续性与交付'] as const
export type ShortStoryReviewModule = (typeof SHORT_STORY_REVIEW_MODULES)[number]
export type StoryFindingDisposition = '待处理' | '已解决' | '已接受修改' | '作者保留' | '已驳回' | '无法判断'

export interface ShortStoryReviewFinding {
  readonly 发现项编号: string
  readonly 证据位置: string
  readonly 问题说明: string
  readonly 修改建议: string
  readonly 影响范围: string
  readonly 处置状态: StoryFindingDisposition
  readonly 改动说明: string
}

export interface ShortStoryReviewInputFinding {
  readonly 发现项编号: string
  readonly 证据位置: string
  readonly 问题说明: string
  readonly 修改建议?: string
  readonly 影响范围?: string
}

export interface ShortStoryReviewModuleState {
  readonly 完成: true
  readonly 待回写?: boolean
}

export interface ShortStoryReviewRecord {
  readonly schemaVersion: 1
  readonly kind: 'short-story-review'
  readonly storyId: string
  readonly 目标草稿: string
  readonly 草稿哈希: string
  readonly 计划哈希: string
  readonly 目标指纹: string
  readonly 规则包: ShortStoryRulePackRef
  readonly 模块: Readonly<Record<string, ShortStoryReviewModuleState>>
  readonly 问题: readonly ShortStoryReviewFinding[]
  readonly 完成: boolean
  readonly 历史?: readonly unknown[]
}

export interface ShortStoryReviewIdentity {
  readonly storyId: string
  readonly draftRelPath: string
  readonly draftHash: string
  readonly planHash: string
  readonly rulePack: ShortStoryRulePackRef
  readonly reviewHash: string
  readonly fingerprint: string
}

export interface IngestShortStoryReviewInput {
  readonly storyId: string
  readonly module: ShortStoryReviewModule
  readonly findings: readonly ShortStoryReviewInputFinding[]
  readonly expectedFingerprint: string
}

export interface ApplyShortStoryRevisionInput {
  readonly storyId: string
  readonly expectedReviewHash: string
  readonly newBody?: string
  readonly dispositions: readonly {
    readonly 发现项编号: string
    readonly status: Exclude<StoryFindingDisposition, '待处理'>
    readonly note?: string
  }[]
}

function readText(root: string, rel: string): string | null {
  try { return fs.readFileSync(path.join(root, rel), 'utf8') } catch { return null }
}

function serializeReview(record: ShortStoryReviewRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`
}

function parseReview(text: string): ShortStoryReviewRecord {
  let raw: unknown
  try { raw = JSON.parse(text) } catch (error) { throw new Error(`审读记录解析失败:${String(error)}`) }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('审读记录顶层必须是对象')
  const record = raw as Partial<ShortStoryReviewRecord>
  if (record.schemaVersion !== STORY_MACHINE_SCHEMA_VERSION || record.kind !== 'short-story-review') throw new Error('审读记录 schemaVersion/kind 非法')
  if (typeof record.storyId !== 'string' || typeof record.目标指纹 !== 'string' || typeof record.草稿哈希 !== 'string') throw new Error('审读记录目标身份不完整')
  if (record.模块 === null || typeof record.模块 !== 'object' || Array.isArray(record.模块)) throw new Error('审读记录模块非法')
  if (!Array.isArray(record.问题)) throw new Error('审读记录问题列表非法')
  return {
    schemaVersion: 1,
    kind: 'short-story-review',
    storyId: record.storyId,
    目标草稿: String(record.目标草稿 ?? ''),
    草稿哈希: record.草稿哈希,
    计划哈希: String(record.计划哈希 ?? ''),
    目标指纹: record.目标指纹,
    规则包: { id: String(record.规则包?.id ?? ''), version: Number(record.规则包?.version ?? 0), hash: String(record.规则包?.hash ?? '') },
    模块: record.模块 as Readonly<Record<string, ShortStoryReviewModuleState>>,
    问题: record.问题 as readonly ShortStoryReviewFinding[],
    完成: record.完成 === true,
    ...(Array.isArray(record.历史) ? { 历史: record.历史 } : {}),
  }
}

export function loadShortStoryReview(root: string): ShortStoryReviewRecord | null {
  const text = readText(root, shortStoryPaths.review())
  return text === null ? null : parseReview(text)
}

function freshRecord(identity: ShortStoryReviewIdentity, manifest: ShortStoryManifest): ShortStoryReviewRecord {
  return {
    schemaVersion: 1,
    kind: 'short-story-review',
    storyId: identity.storyId,
    目标草稿: identity.draftRelPath,
    草稿哈希: identity.draftHash,
    计划哈希: identity.planHash,
    目标指纹: identity.fingerprint,
    规则包: manifest.rulePack,
    模块: {},
    问题: [],
    完成: false,
  }
}

function findingKey(finding: ShortStoryReviewInputFinding | ShortStoryReviewFinding): string {
  return [String(finding.证据位置).trim(), String(finding.问题说明).trim()].join('\u0000')
}

function normalizeInputFinding(finding: ShortStoryReviewInputFinding): ShortStoryReviewFinding {
  const id = String(finding.发现项编号 ?? '').trim()
  const evidence = String(finding.证据位置 ?? '').trim()
  const problem = String(finding.问题说明 ?? '').trim()
  if (id === '' || evidence === '' || problem === '') throw new Error('审读发现项缺少编号、证据位置或问题说明')
  return {
    发现项编号: id,
    证据位置: evidence,
    问题说明: problem,
    修改建议: String(finding.修改建议 ?? '').trim(),
    影响范围: String(finding.影响范围 ?? '').trim(),
    处置状态: '待处理',
    改动说明: '',
  }
}

function reviewIsComplete(record: ShortStoryReviewRecord | null, identity: ShortStoryReviewIdentity): boolean {
  if (record === null || record.目标指纹 !== identity.fingerprint || record.草稿哈希 !== identity.draftHash || record.计划哈希 !== identity.planHash) return false
  if (record.规则包.id !== identity.rulePack.id || record.规则包.version !== identity.rulePack.version || record.规则包.hash !== identity.rulePack.hash) return false
  if (!SHORT_STORY_REVIEW_MODULES.every(module => record.模块[module]?.完成 === true && record.模块[module]?.待回写 !== true)) return false
  return record.问题.every(finding => finding.处置状态 !== '待处理')
}

function computeReviewIdentity(root: string, storyId: string): { readonly ok: true; readonly identity: ShortStoryReviewIdentity } | { readonly ok: false; readonly reason: string } {
  try {
    const manifest = readShortStoryManifest(root, storyId)
    const plan = readConfirmedShortStoryPlan(root, storyId)
    const drafts = listShortStoryDrafts(root, storyId)
    const pending = drafts.filter(draft => draft.role === '待审稿')
    if (pending.length !== 1) return { ok: false, reason: pending.length === 0 ? '尚无待审稿' : '待审稿不唯一' }
    const draft = pending[0]!
    const reviewText = readText(root, shortStoryPaths.review())
    return {
      ok: true,
      identity: {
        storyId,
        draftRelPath: draft.relPath,
        draftHash: draft.draftHash,
        planHash: plan.planHash,
        rulePack: manifest.rulePack,
        reviewHash: reviewText === null ? '' : shortStoryHash(reviewText),
        fingerprint: shortStoryReviewFingerprint({ draftHash: draft.draftHash, planHash: plan.planHash, rulePack: manifest.rulePack }),
      },
    }
  } catch (error) {
    return { ok: false, reason: String(error) }
  }
}

export function shortStoryReviewIdentity(root: string, storyId: string):
  | ({ readonly ok: true } & ShortStoryReviewIdentity)
  | { readonly ok: false; readonly reason: string } {
  const result = computeReviewIdentity(root, storyId)
  return result.ok ? { ok: true, ...result.identity } : result
}

export function ingestShortStoryReview(root: string, input: IngestShortStoryReviewInput) {
  return bookWriter((bookRoot: string) => {
    try {
      if (!SHORT_STORY_REVIEW_MODULES.includes(input.module)) throw new Error(`未登记审读模块:${input.module}`)
      const identityResult = computeReviewIdentity(bookRoot, input.storyId)
      if (!identityResult.ok) throw new Error(identityResult.reason)
      const identity = identityResult.identity
      if (identity.fingerprint !== input.expectedFingerprint) throw new Error('审读输入指纹已过期,拒绝回写')
      const manifest = readShortStoryManifest(bookRoot, input.storyId)
      const existing = loadShortStoryReview(bookRoot)
      const sameTarget = existing !== null && existing.目标指纹 === identity.fingerprint
      const base = sameTarget ? existing : freshRecord(identity, manifest)
      const history = sameTarget || existing === null ? (base.历史 ?? []) : [...(existing.历史 ?? []), { 目标指纹: existing.目标指纹, 模块: existing.模块, 问题: existing.问题, 完成: existing.完成 }]
      const oldByKey = new Map(base.问题.map(finding => [findingKey(finding), finding]))
      const incoming = input.findings.map(normalizeInputFinding)
      const seen = new Set<string>()
      const moduleProblems = incoming.map(finding => {
        const key = findingKey(finding)
        if (seen.has(key)) throw new Error(`模块内发现项重复:${key}`)
        seen.add(key)
        const old = oldByKey.get(key)
        return old === undefined ? finding : { ...finding, 处置状态: old.处置状态, 改动说明: old.改动说明 }
      })
      const otherProblems = base.问题.filter(finding => !incoming.some(next => findingKey(next) === findingKey(finding)))
      const problems = [...otherProblems, ...moduleProblems]
      const modules = { ...base.模块, [input.module]: { 完成: true as const, 待回写: false as const } }
      const next: ShortStoryReviewRecord = {
        ...base,
        目标草稿: identity.draftRelPath,
        草稿哈希: identity.draftHash,
        计划哈希: identity.planHash,
        目标指纹: identity.fingerprint,
        规则包: manifest.rulePack,
        模块: modules,
        问题: problems,
        完成: false,
        历史: history,
      }
      const complete = reviewIsComplete(next, identity)
      const content = serializeReview({ ...next, 完成: complete })
      writeBatchAtomic(bookRoot, [{ relPath: shortStoryPaths.review(), content }])
      return { ok: true as const, reviewHash: shortStoryHash(content), complete, module: input.module }
    } catch (error) {
      return { ok: false as const, reason: String(error) }
    }
  })(root)
}

export function applyShortStoryRevision(root: string, input: ApplyShortStoryRevisionInput) {
  return bookWriter((bookRoot: string) => {
    try {
      const identityResult = computeReviewIdentity(bookRoot, input.storyId)
      if (!identityResult.ok) throw new Error(identityResult.reason)
      const identity = identityResult.identity
      if (identity.reviewHash === '' || identity.reviewHash !== input.expectedReviewHash) throw new Error('审核记录哈希已变化,拒绝改稿')
      const record = loadShortStoryReview(bookRoot)
      if (record === null || record.目标指纹 !== identity.fingerprint) throw new Error('审读证据已过期,拒绝改稿')
      const byId = new Map(record.问题.map(finding => [finding.发现项编号, finding]))
      const seen = new Set<string>()
      const updated = record.问题.map(finding => {
        const disposition = input.dispositions.find(item => item.发现项编号 === finding.发现项编号)
        if (disposition === undefined) return finding
        if (seen.has(disposition.发现项编号)) throw new Error(`处置编号重复:${disposition.发现项编号}`)
        seen.add(disposition.发现项编号)
        return { ...finding, 处置状态: disposition.status, 改动说明: String(disposition.note ?? '').trim() }
      })
      for (const disposition of input.dispositions) {
        if (!byId.has(disposition.发现项编号)) throw new Error(`未知发现项编号:${disposition.发现项编号}`)
      }
      const ops: FileOp[] = []
      let nextRecord: ShortStoryReviewRecord = { ...record, 问题: updated, 完成: reviewIsComplete({ ...record, 问题: updated }, identity) }
      let draftHash = identity.draftHash
      if (input.newBody !== undefined) {
        const current = pendingShortStoryDraft(bookRoot, input.storyId)
        const versioned = prepareShortStoryDraft(bookRoot, {
          storyId: input.storyId,
          body: input.newBody,
          role: '待审稿',
          module: '改稿',
          parentVersion: current?.version ?? undefined,
        })
        draftHash = versioned.draft.draftHash
        nextRecord = {
          ...nextRecord,
          目标草稿: versioned.draft.relPath,
          草稿哈希: versioned.draft.draftHash,
          目标指纹: versioned.reviewFingerprint,
          模块: {},
          完成: false,
          历史: [...(record.历史 ?? []), { 目标指纹: record.目标指纹, 草稿哈希: record.草稿哈希, 模块: record.模块, 问题: record.问题, 完成: record.完成 }],
        }
        ops.push(...versioned.ops)
      }
      const reviewContent = serializeReview(nextRecord)
      ops.push({ relPath: shortStoryPaths.review(), content: reviewContent })
      writeBatchAtomic(bookRoot, ops)
      return { ok: true as const, draftHash, reviewHash: shortStoryHash(reviewContent), reReview: input.newBody !== undefined }
    } catch (error) {
      return { ok: false as const, reason: String(error) }
    }
  })(root)
}

export function isShortStoryReviewComplete(record: ShortStoryReviewRecord | null, identity: ShortStoryReviewIdentity): boolean {
  return reviewIsComplete(record, identity)
}
