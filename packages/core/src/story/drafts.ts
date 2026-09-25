import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { bookWriter, writeBatchAtomic, type FileOp } from '../repo/atomic'
import { applyVersionFields, bumpVersion, extractVersionFields, initialVersion } from '../provenance'
import { composeBody, splitCandidateFacts } from '../repo/drafts'
import { normalizeShortStoryProse, shortStoryHash } from './hash'
import { shortStoryReviewFingerprint } from './identity'
import { readConfirmedShortStoryPlan } from './plan'
import { shortStoryPaths, type ShortStoryManifest } from './paths'
import { parseShortStoryManifest } from './schema'

export const STORY_DRAFT_FIELDS = ['故事id', '版本', '父版本', '生成模块', '来源快照', '角色', '选定', '正文哈希'] as const

export interface StoryDraftFile {
  readonly file: string
  readonly relPath: string
  readonly storyId: string
  readonly role: '草稿' | '待审稿'
  readonly selected: boolean
  readonly version: number | null
  readonly parentVersion: number | null
  readonly module: string | null
  readonly body: string
  readonly text: string
  readonly draftHash: string
}

export interface WriteShortStoryDraftInput {
  readonly storyId: string
  readonly body: string
  readonly role: '草稿' | '待审稿'
  readonly module: string
  readonly parentVersion?: number
  readonly candidateFacts?: readonly string[]
}

export interface PreparedStoryDraft {
  readonly ops: readonly FileOp[]
  readonly draft: StoryDraftFile
  readonly reviewFingerprint: string
}

function readText(root: string, rel: string): string | null {
  try { return fs.readFileSync(path.join(root, rel), 'utf8') } catch { return null }
}

export function readShortStoryManifest(root: string, storyId: string): ShortStoryManifest {
  const text = readText(root, shortStoryPaths.manifest())
  if (text === null) throw new Error('故事.json 不存在')
  const parsed = parseShortStoryManifest(text)
  if (!parsed.ok) throw new Error(parsed.reason)
  if (parsed.data.storyId !== storyId) throw new Error(`故事 id 不匹配:期望 ${storyId},实际 ${parsed.data.storyId}`)
  return parsed.data
}

function draftNo(file: string): number {
  const match = /^稿(\d+)\.md$/.exec(file)
  return match === null ? 0 : Number(match[1])
}

export function listShortStoryDrafts(root: string, storyId: string): readonly StoryDraftFile[] {
  const dir = path.join(root, shortStoryPaths.draftsDir())
  let names: string[]
  try { names = fs.readdirSync(dir).filter(name => /^稿\d+\.md$/.test(name)) } catch { return [] }
  const out: StoryDraftFile[] = []
  for (const file of names.sort((a, b) => draftNo(a) - draftNo(b))) {
    const text = readText(path.join(root, shortStoryPaths.draftsDir()), file)
    if (text === null) continue
    const parsed = parseDocument(text)
    if (!parsed.ok) continue
    if (parsed.data.fields['故事id'] !== storyId) continue
    const role = parsed.data.fields['角色']
    if (role !== '草稿' && role !== '待审稿') continue
    const body = normalizeShortStoryProse(parsed.data.body)
    const version = extractVersionFields(parsed.data.fields)
    out.push({
      file,
      relPath: path.posix.join(shortStoryPaths.draftsDir(), file),
      storyId,
      role,
      selected: parsed.data.fields['选定'] === true,
      version: version.版本,
      parentVersion: version.父版本,
      module: version.生成模块,
      body,
      text,
      draftHash: shortStoryHash(body),
    })
  }
  return out
}

export function pendingShortStoryDraft(root: string, storyId: string): StoryDraftFile | null {
  const pending = listShortStoryDrafts(root, storyId).filter(draft => draft.role === '待审稿')
  return pending.length === 1 ? pending[0]! : null
}

function demoteOps(drafts: readonly StoryDraftFile[], keepRelPath: string): readonly FileOp[] {
  return drafts.flatMap(draft => {
    if (draft.relPath === keepRelPath || (draft.role !== '待审稿' && !draft.selected)) return []
    const parsed = parseDocument(draft.text)
    if (!parsed.ok) return []
    return [{
      relPath: draft.relPath,
      content: serializeDocument({ ...parsed.data.fields, 角色: '草稿', 选定: false }, parsed.data.body, STORY_DRAFT_FIELDS),
    }]
  })
}

export function prepareShortStoryDraft(root: string, input: WriteShortStoryDraftInput): PreparedStoryDraft {
  const manifest = readShortStoryManifest(root, input.storyId)
  const plan = readConfirmedShortStoryPlan(root, input.storyId)
  const split = splitCandidateFacts(input.body)
  const prose = normalizeShortStoryProse(split.prose)
  if (prose === '') throw new Error('正文不能为空')
  if (input.module.trim() === '') throw new Error('生成模块不能为空')
  const facts = [...split.facts, ...(input.candidateFacts ?? []).map(String)].map(fact => fact.trim()).filter(fact => fact !== '')
  const drafts = listShortStoryDrafts(root, input.storyId)
  const next = drafts.length === 0 ? 1 : Math.max(...drafts.map(draft => draftNo(draft.file))) + 1
  const relPath = shortStoryPaths.draft(next)
  const latest = [...drafts].sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0]?.version ?? null
  const parent = input.parentVersion ?? latest
  if (parent !== null && !drafts.some(draft => draft.version === parent)) throw new Error(`父版本不存在:${parent}`)
  const version = parent === null ? initialVersion(input.module, { 计划哈希: plan.planHash }) : bumpVersion(parent, input.module, { 计划哈希: plan.planHash })
  const draftHash = shortStoryHash(prose)
  const body = composeBody(prose, facts)
  const fields = applyVersionFields({
    故事id: input.storyId,
    角色: input.role,
    选定: input.role === '待审稿',
    正文哈希: draftHash,
  }, version)
  const ops = [
    ...(input.role === '待审稿' ? demoteOps(drafts, relPath) : []),
    { relPath, content: serializeDocument(fields, body, STORY_DRAFT_FIELDS) },
  ]
  const draft: StoryDraftFile = {
    file: path.posix.basename(relPath),
    relPath,
    storyId: input.storyId,
    role: input.role,
    selected: input.role === '待审稿',
    version: version.版本,
    parentVersion: version.父版本,
    module: version.生成模块,
    body: prose,
    text: serializeDocument(fields, body, STORY_DRAFT_FIELDS),
    draftHash,
  }
  return {
    ops,
    draft,
    reviewFingerprint: shortStoryReviewFingerprint({ draftHash, planHash: plan.planHash, rulePack: manifest.rulePack }),
  }
}

export function writeShortStoryDraft(root: string, input: WriteShortStoryDraftInput) {
  return bookWriter((bookRoot: string) => {
    try {
      const prepared = prepareShortStoryDraft(bookRoot, input)
      writeBatchAtomic(bookRoot, prepared.ops)
      return {
        ok: true as const,
        relPath: prepared.draft.relPath,
        version: prepared.draft.version,
        draftHash: prepared.draft.draftHash,
        reviewFingerprint: prepared.reviewFingerprint,
      }
    } catch (error) {
      return { ok: false as const, reason: String(error) }
    }
  })(root)
}
