import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { formatCommitMessage } from '../commit/message'
import { removeSync } from '../repo/remove'
import { writeBatchAtomic } from '../repo/atomic'
import { parseShortStoryManifest, serializeShortStoryManifest } from './schema'
import {
  assertFanqieShortStoryRulePack,
  FANQIE_SHORT_STORY_PLATFORM_PROFILE,
  FANQIE_SHORT_STORY_RULE_PACK_REF,
  normalizeFanqieTarget,
} from './rule-pack'
import {
  shortStoryPaths,
  validateShortStoryId,
  validateShortStoryTitle,
  type ShortStoryManifest,
  type ShortStoryRulePackRef,
  type ShortStoryTarget,
} from './paths'

export interface CreateShortStoryInput {
  readonly workspaceRoot: string
  readonly title: string
  readonly storyId?: string
  readonly target: ShortStoryTarget
  readonly rulePack?: ShortStoryRulePackRef
  readonly platformProfile?: string | null
}

export type CreateShortStoryResult =
  | { readonly ok: true; readonly storyRoot: string; readonly storyId: string; readonly title: string; readonly commit: string; readonly platform: 'fanqie'; readonly platformProfile: typeof FANQIE_SHORT_STORY_PLATFORM_PROFILE; readonly rulePack: ShortStoryRulePackRef }
  | { readonly ok: false; readonly reason: string }

export interface ShortStoryOverview {
  readonly name: string
  readonly storyId: string
  readonly title: string
  readonly root: string
  readonly platform: 'fanqie'
  readonly platformProfile: typeof FANQIE_SHORT_STORY_PLATFORM_PROFILE
  readonly rulePack: ShortStoryRulePackRef
}

function runGit(root: string, args: readonly string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  if (result.error) throw new Error(`git ${args[0]} 失败:${result.error.message}`)
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失败:${String(result.stderr || result.stdout).trim()}`)
}

function emptyDocument(storyId: string, title: string, kind: '作品卡' | '故事蓝图'): string {
  return [
    '---',
    `故事id: ${storyId}`,
    '状态: 留白',
    '版本: 1',
    '父版本:',
    '生成模块: 建故事',
    '---',
    `# ${kind}`,
    '',
    `> ${title}的${kind}尚未确认。`,
    '',
  ].join('\n')
}

export function listShortStories(workspaceRoot: string): readonly ShortStoryOverview[] {
  const root = path.resolve(workspaceRoot)
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return [] }
  const out: ShortStoryOverview[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const storyRoot = path.join(root, entry.name)
    try {
      const parsed = parseShortStoryManifest(fs.readFileSync(path.join(storyRoot, shortStoryPaths.manifest()), 'utf8'))
      if (!parsed.ok) continue
      out.push({ name: entry.name, storyId: parsed.data.storyId, title: parsed.data.title, root: storyRoot, platform: 'fanqie', platformProfile: parsed.data.platformProfile, rulePack: parsed.data.rulePack })
    } catch { /* 非故事目录或文件不可读 */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

export function resolveShortStoryRoot(workspaceRoot: string, storyId: string): string | undefined {
  return listShortStories(workspaceRoot).find(story => story.storyId === storyId)?.root
}

export function createShortStory(input: CreateShortStoryInput): CreateShortStoryResult {
  let target: ShortStoryTarget
  try {
    validateShortStoryTitle(input.title)
    assertFanqieShortStoryRulePack(input.rulePack ?? FANQIE_SHORT_STORY_RULE_PACK_REF, input.platformProfile)
    target = normalizeFanqieTarget(input.target)
  } catch (error) { return { ok: false, reason: String(error) } }
  const storyId = input.storyId ?? `s-${randomUUID().replace(/-/g, '')}`
  try { validateShortStoryId(storyId) } catch (error) { return { ok: false, reason: String(error) } }
  if (!fs.existsSync(input.workspaceRoot) || !fs.statSync(input.workspaceRoot).isDirectory()) return { ok: false, reason: '工作范围不存在' }
  if (resolveShortStoryRoot(input.workspaceRoot, storyId) !== undefined) return { ok: false, reason: `故事 id 已存在:${storyId}` }
  const storyRoot = path.join(path.resolve(input.workspaceRoot), input.title)
  if (fs.existsSync(storyRoot)) return { ok: false, reason: `目标目录已存在:${storyRoot}` }

  const manifest: ShortStoryManifest = {
    schemaVersion: 1,
    kind: 'short-story',
    formatVersion: 1,
    storyId,
    title: input.title,
    target,
    rulePack: FANQIE_SHORT_STORY_RULE_PACK_REF,
    platformProfile: FANQIE_SHORT_STORY_PLATFORM_PROFILE,
  }
  let created = false
  try {
    fs.mkdirSync(storyRoot)
    created = true
    for (const dir of [shortStoryPaths.blueprint().split('/')[0]!, shortStoryPaths.draftsDir(), shortStoryPaths.finalDir(), shortStoryPaths.planDraftDir(), '检查']) {
      fs.mkdirSync(path.join(storyRoot, dir), { recursive: true })
    }
    fs.writeFileSync(path.join(storyRoot, '.gitignore'), '.webnovel/\n', 'utf8')
    writeBatchAtomic(storyRoot, [
      { relPath: shortStoryPaths.manifest(), content: serializeShortStoryManifest(manifest) },
      { relPath: shortStoryPaths.card(), content: emptyDocument(storyId, input.title, '作品卡') },
      { relPath: shortStoryPaths.blueprint(), content: emptyDocument(storyId, input.title, '故事蓝图') },
    ])
    const subject = formatCommitMessage({ prefix: 'story', summary: '建故事' })
    runGit(storyRoot, ['init'])
    runGit(storyRoot, ['config', 'user.email', 'short-story-writer@local'])
    runGit(storyRoot, ['config', 'user.name', 'short-story-writer'])
    runGit(storyRoot, ['config', 'commit.gpgsign', 'false'])
    runGit(storyRoot, ['add', '-A'])
    runGit(storyRoot, ['commit', '-m', subject])
    return { ok: true, storyRoot, storyId, title: input.title, commit: subject, platform: 'fanqie', platformProfile: FANQIE_SHORT_STORY_PLATFORM_PROFILE, rulePack: FANQIE_SHORT_STORY_RULE_PACK_REF }
  } catch (error) {
    if (created) {
      try { removeSync(storyRoot) } catch { /* best effort */ }
    }
    return { ok: false, reason: `创建短故事失败并已回滚:${String(error)}` }
  }
}
