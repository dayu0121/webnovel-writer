import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  FANQIE_SHORT_STORY_PLATFORM_PROFILE,
  FANQIE_SHORT_STORY_RULE_PACK,
  FANQIE_SHORT_STORY_RULE_PACK_REF,
  createShortStory,
  confirmShortStoryPlan,
  ingestShortStoryReview,
  prepareShortStoryDelivery,
  readShortStoryManifest,
  shortStoryReviewIdentity,
  writeShortStoryDraft,
  writeShortStoryPlan,
} from '../src/index'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) { try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows cleanup */ } } })
function workspace(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fanqie-rule-')); roots.push(root); return root }
function must<T extends { ok: true }>(value: T | { ok: false; reason: string }): T { if (!value.ok) throw new Error(value.reason); return value }
const card = '# 作品卡\n\n## 核心钩子\n主角必须主动做出选择。\n'
const blueprint = '# 故事蓝图\n\n## 开篇钩子\n一个无法回避的现实问题。\n\n## 结局\n人物关系与价值秩序完成收束。\n'

function ready(root: string, profile: 'ultra-short' | 'mid-short' = 'ultra-short') {
  const target = profile === 'ultra-short'
    ? { profile, minChars: 8000, idealChars: null, maxChars: 24900, counting: 'codepoint' as const }
    : { profile, minChars: 25000, idealChars: null, maxChars: 80000, counting: 'codepoint' as const }
  const created = must(createShortStory({ workspaceRoot: root, title: `规则包${profile}`, storyId: `s-${profile}`, target }))
  const plan = must(writeShortStoryPlan(created.storyRoot, { storyId: created.storyId, card, blueprint }))
  must(confirmShortStoryPlan(created.storyRoot, { storyId: created.storyId, cardHash: plan.cardHash, blueprintHash: plan.blueprintHash }))
  return created.storyRoot
}

function review(root: string, storyId: string) {
  must(writeShortStoryDraft(root, { storyId, body: '她看见问题后主动做出选择，并承担后果。', role: '待审稿', module: '写稿' }))
  const identity = must(shortStoryReviewIdentity(root, storyId))
  for (const module of ['结构与因果', '人物与情绪', '连续性与交付'] as const) must(ingestShortStoryReview(root, { storyId, module, findings: [], expectedFingerprint: identity.fingerprint }))
}

describe('番茄短故事版本化规则包', () => {
  it('固定平台、版本、hash、来源和通用/活动边界', () => {
    expect(FANQIE_SHORT_STORY_RULE_PACK).toMatchObject({ id: 'fanqie-short-story', version: 1, platform: 'fanqie', platformProfile: FANQIE_SHORT_STORY_PLATFORM_PROFILE })
    expect(FANQIE_SHORT_STORY_RULE_PACK.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(FANQIE_SHORT_STORY_RULE_PACK_REF).toEqual({ id: FANQIE_SHORT_STORY_RULE_PACK.id, version: FANQIE_SHORT_STORY_RULE_PACK.version, hash: FANQIE_SHORT_STORY_RULE_PACK.hash })
    expect(FANQIE_SHORT_STORY_RULE_PACK.sources.length).toBeGreaterThanOrEqual(3)
    expect(FANQIE_SHORT_STORY_RULE_PACK.scope).toContain('不替代具体活动')
    expect(FANQIE_SHORT_STORY_RULE_PACK.targets['ultra-short']).toMatchObject({ minChars: 8000, maxChars: 24900 })
    expect(FANQIE_SHORT_STORY_RULE_PACK.targets['mid-short']).toMatchObject({ minChars: 25000, maxChars: 80000 })
  })

  it('新建故事默认且只能绑定番茄规则包，拒绝通用包和其他平台', () => {
    const root = workspace()
    const created = must(createShortStory({
      workspaceRoot: root,
      title: '番茄专用故事',
      storyId: 's-fanqie-only',
      target: { profile: 'ultra-short', minChars: 8000, idealChars: null, maxChars: 24900, counting: 'codepoint' },
    }))
    const manifest = readShortStoryManifest(created.storyRoot, 's-fanqie-only')
    expect(manifest.platformProfile).toBe(FANQIE_SHORT_STORY_PLATFORM_PROFILE)
    expect(manifest.rulePack).toEqual(FANQIE_SHORT_STORY_RULE_PACK_REF)
    expect(JSON.parse(fs.readFileSync(path.join(created.storyRoot, '故事.json'), 'utf8'))).toMatchObject({ platformProfile: FANQIE_SHORT_STORY_PLATFORM_PROFILE, rulePack: FANQIE_SHORT_STORY_RULE_PACK_REF })
    const generic = createShortStory({ workspaceRoot: root, title: '错误通用包', storyId: 's-generic', target: { profile: 'ultra-short', minChars: 8000, idealChars: null, maxChars: 24900, counting: 'codepoint' }, rulePack: { id: 'generic-quality', version: 1, hash: '0'.repeat(64) } })
    expect(generic.ok).toBe(false)
    expect(fs.existsSync(path.join(root, '错误通用包'))).toBe(false)
    const otherPlatform = createShortStory({ workspaceRoot: root, title: '错误平台', storyId: 's-other', target: { profile: 'ultra-short', minChars: 8000, idealChars: null, maxChars: 24900, counting: 'codepoint' }, platformProfile: 'other-platform' })
    expect(otherPlatform.ok).toBe(false)
  })

  it('已有故事 manifest 被改成其他平台或通用规则包后拒绝读取', () => {
    const root = workspace()
    const storyRoot = ready(root)
    const manifestPath = path.join(storyRoot, '故事.json')
    const original = fs.readFileSync(manifestPath, 'utf8')
    const otherPlatform = JSON.parse(original) as Record<string, unknown>
    otherPlatform.platformProfile = 'other-platform'
    fs.writeFileSync(manifestPath, JSON.stringify(otherPlatform, null, 2) + '\n', 'utf8')
    expect(() => readShortStoryManifest(storyRoot, 's-ultra-short')).toThrow('番茄短故事平台')
    const generic = JSON.parse(original) as Record<string, unknown>
    generic.rulePack = { id: 'generic-quality', version: 1, hash: '0'.repeat(64) }
    fs.writeFileSync(manifestPath, JSON.stringify(generic, null, 2) + '\n', 'utf8')
    expect(() => readShortStoryManifest(storyRoot, 's-ultra-short')).toThrow('番茄短故事规则包')
  })

  it('超短/中短目标按番茄公开口径归一化，交付记录带规则包身份', () => {
    const root = workspace()
    const storyRoot = ready(root)
    const midRoot = ready(workspace(), 'mid-short')
    expect(readShortStoryManifest(midRoot, 's-mid-short').target).toMatchObject({ profile: 'mid-short', minChars: 25000, maxChars: 80000 })
    review(storyRoot, 's-ultra-short')
    const delivery = must(prepareShortStoryDelivery(storyRoot, 's-ultra-short'))
    expect(delivery.ok).toBe(true)
    const record = JSON.parse(fs.readFileSync(path.join(storyRoot, '检查/交付检查.json'), 'utf8')) as Record<string, unknown>
    expect(record).toMatchObject({ kind: 'short-story-delivery', 平台: 'fanqie', 规则包: FANQIE_SHORT_STORY_RULE_PACK_REF, 规则包哈希: FANQIE_SHORT_STORY_RULE_PACK.hash, 规则包范围: FANQIE_SHORT_STORY_RULE_PACK.scope, 交付声明: FANQIE_SHORT_STORY_RULE_PACK.delivery.notice })
    const outOfRange = createShortStory({ workspaceRoot: workspace(), title: '越界超短', storyId: 's-out-of-range', target: { profile: 'ultra-short', minChars: 7999, idealChars: null, maxChars: 24900, counting: 'codepoint' } })
    expect(outOfRange.ok).toBe(false)
  })
})
