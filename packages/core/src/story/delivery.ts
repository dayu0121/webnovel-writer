import * as fs from 'node:fs'
import * as path from 'node:path'
import { bookWriter, writeBatchAtomic } from '../repo/atomic'
import { countShortStoryChars, normalizeShortStoryProse, shortStoryHash } from './hash'
import { pendingShortStoryDraft, readShortStoryManifest } from './drafts'
import { isShortStoryReviewComplete, loadShortStoryReview, shortStoryReviewIdentity } from './review'
import { shortStoryPaths, validateTarget, type ShortStoryManifest, type ShortStoryRulePackRef } from './paths'
import { assertFanqieShortStoryRulePack, FANQIE_SHORT_STORY_PLATFORM_PROFILE, FANQIE_SHORT_STORY_RULE_PACK } from './rule-pack'

export interface ShortStoryDeliveryRecord {
  readonly schemaVersion: 1
  readonly kind: 'short-story-delivery'
  readonly storyId: string
  readonly 目标指纹: string
  readonly 草稿哈希: string
  readonly 计划哈希: string
  readonly 审读哈希: string
  readonly 平台: 'fanqie'
  readonly 规则包: ShortStoryRulePackRef
  readonly 规则包哈希: string
  readonly 规则包范围: string
  readonly 交付声明: string
  readonly 字数: number
  readonly 目标: ShortStoryManifest['target']
  readonly blockers: readonly string[]
  readonly warnings: readonly string[]
  readonly result: '通过' | '待处理'
}

export interface ShortStoryDeliveryResult {
  readonly ok: boolean
  readonly reason?: string
  readonly deliveryHash?: string
  readonly blockers?: readonly string[]
  readonly warnings?: readonly string[]
  readonly 字数?: number
  readonly 平台?: 'fanqie'
  readonly 规则包?: ShortStoryRulePackRef
  readonly 规则包范围?: string
  readonly 交付声明?: string
}

function readText(root: string, rel: string): string | null {
  try { return fs.readFileSync(path.join(root, rel), 'utf8') } catch { return null }
}

export function parseShortStoryDelivery(text: string): ShortStoryDeliveryRecord {
  let raw: unknown
  try { raw = JSON.parse(text) } catch (error) { throw new Error(`交付检查解析失败:${String(error)}`) }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('交付检查顶层必须是对象')
  const value = raw as Partial<ShortStoryDeliveryRecord>
  if (value.schemaVersion !== 1 || value.kind !== 'short-story-delivery') throw new Error('交付检查 schemaVersion/kind 非法')
  if (typeof value.storyId !== 'string' || typeof value.目标指纹 !== 'string' || typeof value.草稿哈希 !== 'string' || typeof value.审读哈希 !== 'string') throw new Error('交付检查目标身份不完整')
  if (value.平台 !== 'fanqie') throw new Error('交付检查只接受番茄短故事平台')
  if (!Array.isArray(value.blockers) || !Array.isArray(value.warnings)) throw new Error('交付检查问题列表非法')
  const rulePack = { id: String(value.规则包?.id ?? ''), version: Number(value.规则包?.version ?? 0), hash: String(value.规则包?.hash ?? '') }
  assertFanqieShortStoryRulePack(rulePack, FANQIE_SHORT_STORY_PLATFORM_PROFILE)
  if (String(value.规则包哈希 ?? '') !== rulePack.hash) throw new Error('交付检查规则包 hash 不一致')
  if (String(value.规则包范围 ?? '') !== FANQIE_SHORT_STORY_RULE_PACK.scope || String(value.交付声明 ?? '') !== FANQIE_SHORT_STORY_RULE_PACK.delivery.notice) throw new Error('交付检查规则包范围或声明不一致')
  validateTarget(value.目标 as ShortStoryManifest['target'])
  return {
    schemaVersion: 1,
    kind: 'short-story-delivery',
    storyId: value.storyId,
    目标指纹: value.目标指纹,
    草稿哈希: value.草稿哈希,
    计划哈希: String(value.计划哈希 ?? ''),
    审读哈希: value.审读哈希,
    平台: 'fanqie',
    规则包: rulePack,
    规则包哈希: String(value.规则包哈希 ?? ''),
    规则包范围: String(value.规则包范围 ?? ''),
    交付声明: String(value.交付声明 ?? ''),
    字数: Number(value.字数 ?? 0),
    目标: value.目标 as ShortStoryManifest['target'],
    blockers: value.blockers.map(String),
    warnings: value.warnings.map(String),
    result: value.result === '通过' ? '通过' : '待处理',
  }
}

export function loadShortStoryDelivery(root: string): { readonly text: string; readonly record: ShortStoryDeliveryRecord } | null {
  const text = readText(root, shortStoryPaths.delivery())
  return text === null ? null : { text, record: parseShortStoryDelivery(text) }
}

function duplicates(body: string): string[] {
  const counts = new Map<string, number>()
  for (const paragraph of normalizeShortStoryProse(body).split(/\n\s*\n/)) {
    const key = paragraph.trim()
    if (key.length < 30) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => `重复段落出现 ${value.slice(0, 30)}…`)
}

export function prepareShortStoryDelivery(root: string, storyId: string): ShortStoryDeliveryResult {
  return bookWriter((bookRoot: string) => {
    try {
      const manifest = readShortStoryManifest(bookRoot, storyId)
      const identityResult = shortStoryReviewIdentity(bookRoot, storyId)
      if (!identityResult.ok) return { ok: false, reason: identityResult.reason }
      const identity = identityResult
      const review = loadShortStoryReview(bookRoot)
      if (!isShortStoryReviewComplete(review, identity)) return { ok: false, reason: '审读未完成或证据已过期' }
      const draft = pendingShortStoryDraft(bookRoot, storyId)
      if (draft === null || draft.relPath !== identity.draftRelPath) return { ok: false, reason: '待审稿文件不存在或不唯一' }
      const body = normalizeShortStoryProse(draft.body)
      const blockers: string[] = []
      const warnings: string[] = []
      if (body === '') blockers.push('正文为空')
      if (/\{\{[^}]+\}\}|（待补）|\[待补\]|TODO|TBD/iu.test(body)) blockers.push('正文仍有未完成占位符')
      const count = countShortStoryChars(body)
      if (manifest.target.minChars !== null && count < manifest.target.minChars) warnings.push(`字数 ${count} 低于目标下限 ${manifest.target.minChars}`)
      if (manifest.target.maxChars !== null && count > manifest.target.maxChars) warnings.push(`字数 ${count} 高于目标上限 ${manifest.target.maxChars}`)
      warnings.push(...duplicates(body))
      const record: ShortStoryDeliveryRecord = {
        schemaVersion: 1,
        kind: 'short-story-delivery',
        storyId,
        目标指纹: identity.fingerprint,
        草稿哈希: identity.draftHash,
        计划哈希: identity.planHash,
        审读哈希: identity.reviewHash,
        平台: 'fanqie',
        规则包: manifest.rulePack,
        规则包哈希: manifest.rulePack.hash,
        规则包范围: FANQIE_SHORT_STORY_RULE_PACK.scope,
        交付声明: FANQIE_SHORT_STORY_RULE_PACK.delivery.notice,
        字数: count,
        目标: manifest.target,
        blockers,
        warnings,
        result: blockers.length === 0 ? '通过' : '待处理',
      }
      const text = `${JSON.stringify(record, null, 2)}\n`
      writeBatchAtomic(bookRoot, [{ relPath: shortStoryPaths.delivery(), content: text }])
      return { ok: blockers.length === 0, deliveryHash: shortStoryHash(text), blockers, warnings, 字数: count, 平台: 'fanqie' as const, 规则包: manifest.rulePack, 规则包范围: FANQIE_SHORT_STORY_RULE_PACK.scope, 交付声明: FANQIE_SHORT_STORY_RULE_PACK.delivery.notice, ...(blockers.length === 0 ? {} : { reason: '交付检查存在阻断项' }) }
    } catch (error) {
      return { ok: false, reason: String(error) }
    }
  })(root)
}
