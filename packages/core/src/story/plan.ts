import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { bookWriter, writeBatchAtomic } from '../repo/atomic'
import { bumpVersion, extractVersionFields, initialVersion } from '../provenance'
import { checkGitHealth } from '../commit/health'
import { commitWithIsolatedIndex } from '../commit/git'
import { formatCommitMessage } from '../commit/message'
import { normalizeShortStoryProse, shortStoryHash } from './hash'
import { shortStoryPaths, STORY_MACHINE_SCHEMA_VERSION } from './paths'
import { parseShortStoryManifest } from './schema'

const PLAN_FIELD_ORDER = ['故事id', '状态', '版本', '父版本', '生成模块', '计划哈希'] as const

export interface WriteShortStoryPlanInput {
  readonly storyId: string
  readonly card: string
  readonly blueprint: string
}

export interface ConfirmedShortStoryPlanInput {
  readonly storyId: string
  readonly cardHash: string
  readonly blueprintHash: string
}

export interface ConfirmedShortStoryPlan {
  readonly storyId: string
  readonly cardHash: string
  readonly blueprintHash: string
  readonly planHash: string
  readonly card: string
  readonly blueprint: string
}

function readText(root: string, rel: string): string | null {
  try { return fs.readFileSync(path.join(root, rel), 'utf8') } catch { return null }
}

function readManifest(root: string, storyId: string): ReturnType<typeof parseShortStoryManifest> {
  const text = readText(root, shortStoryPaths.manifest())
  if (text === null) return { ok: false, reason: '故事.json 不存在' }
  const parsed = parseShortStoryManifest(text)
  if (!parsed.ok) return parsed
  if (parsed.data.storyId !== storyId) return { ok: false, reason: `故事 id 不匹配:期望 ${storyId},实际 ${parsed.data.storyId}` }
  return parsed
}

function planHash(cardHash: string, blueprintHash: string): string {
  return shortStoryHash(`${cardHash}\n${blueprintHash}`)
}

export function writeShortStoryPlan(root: string, input: WriteShortStoryPlanInput) {
  return bookWriter((bookRoot: string) => {
    const manifest = readManifest(bookRoot, input.storyId)
    if (!manifest.ok) return { ok: false as const, reason: manifest.reason }
    const card = normalizeShortStoryProse(input.card)
    const blueprint = normalizeShortStoryProse(input.blueprint)
    if (card === '' || blueprint === '') return { ok: false as const, reason: '作品卡和故事蓝图不能为空' }
    if (!card.includes('# 作品卡') || !blueprint.includes('# 故事蓝图')) return { ok: false as const, reason: '作品卡或故事蓝图缺少对应一级标题' }
    const cardHash = shortStoryHash(card)
    const blueprintHash = shortStoryHash(blueprint)
    const fields = (kind: '作品卡' | '故事蓝图', body: string) => ({
      故事id: input.storyId,
      状态: '候选',
      ...initialVersion('故事策划'),
      正文哈希: kind === '作品卡' ? cardHash : blueprintHash,
    })
    writeBatchAtomic(bookRoot, [
      { relPath: shortStoryPaths.planDraftCard(), content: serializeDocument(fields('作品卡', card), card, PLAN_FIELD_ORDER) },
      { relPath: shortStoryPaths.planDraftBlueprint(), content: serializeDocument(fields('故事蓝图', blueprint), blueprint, PLAN_FIELD_ORDER) },
    ])
    return { ok: true as const, cardHash, blueprintHash, planHash: planHash(cardHash, blueprintHash), schemaVersion: STORY_MACHINE_SCHEMA_VERSION }
  })(root)
}

function candidateBody(bookRoot: string, rel: string, expectedHash: string, storyId: string): { readonly body: string; readonly hash: string } {
  const text = readText(bookRoot, rel)
  if (text === null) throw new Error(`候选计划不存在:${rel}`)
  const parsed = parseDocument(text)
  if (!parsed.ok) throw new Error(`候选计划解析失败:${rel}——${parsed.detail}`)
  if (parsed.data.fields['故事id'] !== storyId || parsed.data.fields['状态'] !== '候选') throw new Error(`候选计划身份或状态非法:${rel}`)
  const body = normalizeShortStoryProse(parsed.data.body)
  const hash = shortStoryHash(body)
  if (hash !== expectedHash) throw new Error(`候选计划 hash 已变化:${rel}`)
  return { body, hash }
}

export function confirmShortStoryPlan(root: string, input: ConfirmedShortStoryPlanInput) {
  return bookWriter((bookRoot: string) => {
    const manifest = readManifest(bookRoot, input.storyId)
    if (!manifest.ok) return { ok: false as const, reason: manifest.reason }
    try {
      const card = candidateBody(bookRoot, shortStoryPaths.planDraftCard(), input.cardHash, input.storyId)
      const blueprint = candidateBody(bookRoot, shortStoryPaths.planDraftBlueprint(), input.blueprintHash, input.storyId)
      const hash = planHash(card.hash, blueprint.hash)
      const version = (truthRel: string) => {
        const text = readText(bookRoot, truthRel)
        const parsed = text === null ? null : parseDocument(text)
        const current = parsed?.ok ? extractVersionFields(parsed.data.fields).版本 : null
        return current === null ? initialVersion('计划确认') : bumpVersion(current, '计划确认', { 计划哈希: hash })
      }
      const make = (body: string, truthRel: string, source: string) => serializeDocument({
        故事id: input.storyId,
        状态: '已确认',
        ...version(truthRel),
        计划哈希: hash,
        来源草稿: source,
      }, body, PLAN_FIELD_ORDER)
      writeBatchAtomic(bookRoot, [
        { relPath: shortStoryPaths.card(), content: make(card.body, shortStoryPaths.card(), shortStoryPaths.planDraftCard()) },
        { relPath: shortStoryPaths.blueprint(), content: make(blueprint.body, shortStoryPaths.blueprint(), shortStoryPaths.planDraftBlueprint()) },
      ])
      const health = checkGitHealth(bookRoot)
      if (!health.ok) return { ok: false as const, reason: health.reason, written: true }
      const message = formatCommitMessage({ prefix: 'story', summary: '确认故事计划' })
      const committed = commitWithIsolatedIndex(bookRoot, [shortStoryPaths.card(), shortStoryPaths.blueprint()], message)
      if (committed.noChanges) return { ok: true as const, storyId: input.storyId, cardHash: card.hash, blueprintHash: blueprint.hash, planHash: hash, noChanges: true }
      if (committed.status !== 0) return { ok: false as const, reason: `计划已写入但提交失败:${committed.stderr.trim() || 'git commit 失败'}`, written: true }
      return { ok: true as const, storyId: input.storyId, cardHash: card.hash, blueprintHash: blueprint.hash, planHash: hash }
    } catch (error) {
      return { ok: false as const, reason: String(error) }
    }
  })(root)
}

export function readConfirmedShortStoryPlan(root: string, storyId: string): ConfirmedShortStoryPlan {
  const manifest = readManifest(root, storyId)
  if (!manifest.ok) throw new Error(manifest.reason)
  const read = (rel: string, expectedTitle: string) => {
    const text = readText(root, rel)
    if (text === null) throw new Error(`计划真源不存在:${rel}`)
    const parsed = parseDocument(text)
    if (!parsed.ok) throw new Error(`计划真源解析失败:${rel}——${parsed.detail}`)
    const body = normalizeShortStoryProse(parsed.data.body)
    if (!body.includes(`# ${expectedTitle}`)) throw new Error(`计划标题非法，计划哈希无法校验:${rel}`)
    if (parsed.data.fields['故事id'] !== storyId || parsed.data.fields['状态'] !== '已确认') throw new Error(`计划尚未确认:${rel}`)
    return { body, hash: shortStoryHash(body), recorded: parsed.data.fields['计划哈希'] }
  }
  const card = read(shortStoryPaths.card(), '作品卡')
  const blueprint = read(shortStoryPaths.blueprint(), '故事蓝图')
  const expected = planHash(card.hash, blueprint.hash)
  if (card.recorded !== expected || blueprint.recorded !== expected) throw new Error(`计划哈希不一致或已被外部修改:期望 ${expected}`)
  return { storyId, cardHash: card.hash, blueprintHash: blueprint.hash, planHash: expected, card: card.body, blueprint: blueprint.body }
}
