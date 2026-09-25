import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { withBookLock } from '../repo/lock'
import { recoverTransactions } from '../repo/transaction'
import { writeBatchAtomic } from '../repo/atomic'
import { checkGitHealth } from '../commit/health'
import { commitWithIsolatedIndex } from '../commit/git'
import { formatCommitMessage } from '../commit/message'
import { countShortStoryChars, normalizeShortStoryProse, shortStoryHash } from './hash'
import { loadShortStoryDelivery } from './delivery'
import { pendingShortStoryDraft, readShortStoryManifest } from './drafts'
import { shortStoryReviewIdentity } from './review'
import { shortStoryPaths } from './paths'

export interface ShortStorySettlementApproval {
  readonly approved: boolean
  readonly decision: string
  readonly draftHash: string
  readonly reviewHash: string
  readonly deliveryHash: string
}

export interface SettleShortStoryInput {
  readonly storyId: string
  readonly approval: ShortStorySettlementApproval
  readonly summary: string
}

export type SettleShortStoryResult =
  | { readonly ok: true; readonly finalRelPath: string; readonly receiptRelPath: string; readonly draftHash: string; readonly alreadyCommitted: boolean; readonly message: string }
  | { readonly ok: false; readonly reason: string; readonly written?: boolean }

interface SettlementReceipt {
  readonly schemaVersion: 1
  readonly kind: 'short-story-settlement'
  readonly storyId: string
  readonly revision: number
  readonly finalRelPath: string
  readonly finalHash: string
  readonly draftHash: string
  readonly reviewHash: string
  readonly deliveryHash: string
  readonly decision: string
}

function readText(root: string, rel: string): string | null {
  try { return fs.readFileSync(path.join(root, rel), 'utf8') } catch { return null }
}

function parseReceipt(text: string): SettlementReceipt {
  let raw: unknown
  try { raw = JSON.parse(text) } catch (error) { throw new Error(`定稿回执解析失败:${String(error)}`) }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('定稿回执顶层必须是对象')
  const value = raw as Partial<SettlementReceipt>
  if (value.schemaVersion !== 1 || value.kind !== 'short-story-settlement') throw new Error('定稿回执 schemaVersion/kind 非法')
  if (typeof value.storyId !== 'string' || typeof value.finalRelPath !== 'string' || typeof value.draftHash !== 'string' || typeof value.reviewHash !== 'string' || typeof value.deliveryHash !== 'string') throw new Error('定稿回执身份不完整')
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1) throw new Error('定稿回执版本非法')
  return {
    schemaVersion: 1,
    kind: 'short-story-settlement',
    storyId: value.storyId,
    revision: Number(value.revision),
    finalRelPath: value.finalRelPath,
    finalHash: String(value.finalHash ?? ''),
    draftHash: value.draftHash,
    reviewHash: value.reviewHash,
    deliveryHash: value.deliveryHash,
    decision: String(value.decision ?? ''),
  }
}

function finalRevision(root: string): number {
  const dir = path.join(root, shortStoryPaths.finalDir())
  let max = 0
  try {
    for (const name of fs.readdirSync(dir)) {
      const match = /^r(\d+)\.md$/.exec(name)
      if (match !== null) max = Math.max(max, Number(match[1]))
    }
  } catch { /* final directory absent */ }
  return max
}

export function settleShortStory(root: string, input: SettleShortStoryInput): SettleShortStoryResult {
  return withBookLock(root, () => {
    recoverTransactions(root)
    try {
      if (!input.approval.approved) return { ok: false, reason: '作者未批准定稿' }
      if (input.approval.decision.trim() === '') return { ok: false, reason: '定稿批准缺少裁决记录' }
      const manifest = readShortStoryManifest(root, input.storyId)
      const identityResult = shortStoryReviewIdentity(root, input.storyId)
      if (!identityResult.ok) return { ok: false, reason: identityResult.reason }
      const identity = identityResult
      if (identity.draftHash !== input.approval.draftHash) return { ok: false, reason: '待审稿正文 hash 与批准不一致' }
      if (identity.reviewHash !== input.approval.reviewHash) return { ok: false, reason: '审读记录 hash 与批准不一致' }
      const delivery = loadShortStoryDelivery(root)
      if (delivery === null || shortStoryHash(delivery.text) !== input.approval.deliveryHash) return { ok: false, reason: '交付检查 hash 与批准不一致' }
      if (delivery.record.平台 !== 'fanqie' || delivery.record.规则包.id !== manifest.rulePack.id || delivery.record.规则包.version !== manifest.rulePack.version || delivery.record.规则包.hash !== manifest.rulePack.hash || delivery.record.规则包哈希 !== manifest.rulePack.hash) return { ok: false, reason: '交付检查规则包与当前番茄短故事规则不一致' }
      if (delivery.record.目标指纹 !== identity.fingerprint || delivery.record.草稿哈希 !== identity.draftHash || delivery.record.审读哈希 !== identity.reviewHash) return { ok: false, reason: '交付检查证据已过期' }
      if (delivery.record.result !== '通过' || delivery.record.blockers.length > 0) return { ok: false, reason: '交付检查仍有阻断项' }
      const draft = pendingShortStoryDraft(root, input.storyId)
      if (draft === null) return { ok: false, reason: '无唯一待审稿' }
      const body = normalizeShortStoryProse(draft.body)
      const receiptRel = shortStoryPaths.settlementReceipt()
      const existingReceiptText = readText(root, receiptRel)
      let revision: number
      let finalRel: string
      let receiptText: string
      if (existingReceiptText !== null) {
        const existing = parseReceipt(existingReceiptText)
        const sameApproval = existing.storyId === input.storyId
          && existing.draftHash === identity.draftHash
          && existing.reviewHash === identity.reviewHash
          && existing.deliveryHash === input.approval.deliveryHash
        if (!sameApproval) return { ok: false, reason: '已有不同批准绑定的定稿回执，拒绝覆盖' }
        revision = existing.revision
        finalRel = existing.finalRelPath
        receiptText = existingReceiptText
      } else {
        if (finalRevision(root) > 0) return { ok: false, reason: '定稿文件存在但定稿回执缺失，拒绝生成第二份' }
        revision = 1
        finalRel = shortStoryPaths.final(revision)
        receiptText = `${JSON.stringify({
          schemaVersion: 1,
          kind: 'short-story-settlement',
          storyId: input.storyId,
          revision,
          finalRelPath: finalRel,
          finalHash: shortStoryHash(body),
          draftHash: identity.draftHash,
          reviewHash: identity.reviewHash,
          deliveryHash: input.approval.deliveryHash,
          decision: input.approval.decision.trim(),
        }, null, 2)}\n`
      }
      const finalText = serializeDocument({
        故事id: input.storyId,
        标题: manifest.title,
        状态: '已定稿',
        版本: revision,
        正文哈希: identity.draftHash,
        来源草稿: draft.relPath,
        审读哈希: identity.reviewHash,
        交付检查哈希: input.approval.deliveryHash,
        字数统计: { 字符数: countShortStoryChars(body) },
      }, body, ['故事id', '标题', '状态', '版本', '正文哈希', '来源草稿', '审读哈希', '交付检查哈希', '字数统计'])
      const existingFinal = readText(root, finalRel)
      if (existingFinal !== null) {
        const parsed = parseDocument(existingFinal)
        if (!parsed.ok || normalizeShortStoryProse(parsed.data.body) !== body) return { ok: false, reason: `定稿目标已存在且内容不同:${finalRel}` }
      }
      writeBatchAtomic(root, [
        { relPath: finalRel, content: finalText },
        { relPath: receiptRel, content: receiptText },
      ])
      const health = checkGitHealth(root)
      if (!health.ok) return { ok: false, reason: health.reason, written: true }
      const message = formatCommitMessage({ prefix: 'story', summary: input.summary })
      const committed = commitWithIsolatedIndex(root, [finalRel, receiptRel, shortStoryPaths.review(), shortStoryPaths.delivery(), shortStoryPaths.card(), shortStoryPaths.blueprint(), shortStoryPaths.manifest()], message)
      if (committed.noChanges) return { ok: true, finalRelPath: finalRel, receiptRelPath: receiptRel, draftHash: identity.draftHash, alreadyCommitted: true, message }
      if (committed.status !== 0) return { ok: false, reason: `定稿文件已写入但提交失败:${committed.stderr.trim() || 'git commit 失败'}`, written: true }
      return { ok: true, finalRelPath: finalRel, receiptRelPath: receiptRel, draftHash: identity.draftHash, alreadyCommitted: false, message }
    } catch (error) {
      return { ok: false, reason: String(error) }
    }
  }, { targets: [shortStoryPaths.manifest(), shortStoryPaths.card(), shortStoryPaths.blueprint()] })
}
