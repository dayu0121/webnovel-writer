import {
  FANQIE_SHORT_STORY_PLATFORM_PROFILE,
  STORY_FORMAT_VERSION,
  STORY_MACHINE_SCHEMA_VERSION,
  validateRulePack,
  validateShortStoryId,
  validateShortStoryTitle,
  validateTarget,
  type ShortStoryManifest,
} from './paths'
import { assertFanqieShortStoryRulePack } from './rule-pack'

export type ShortStoryManifestResult =
  | { readonly ok: true; readonly data: ShortStoryManifest }
  | { readonly ok: false; readonly reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNullableNonNegativeInt(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && Number(value) >= 0)
}

export function parseShortStoryManifest(text: string): ShortStoryManifestResult {
  let raw: unknown
  try { raw = JSON.parse(text) } catch (error) { return { ok: false, reason: `故事.json 解析失败:${String(error)}` } }
  if (!isRecord(raw)) return { ok: false, reason: '故事.json 顶层必须是对象' }
  if (raw.schemaVersion !== STORY_MACHINE_SCHEMA_VERSION) return { ok: false, reason: `故事.json schemaVersion 必须是 ${STORY_MACHINE_SCHEMA_VERSION}` }
  if (raw.kind !== 'short-story') return { ok: false, reason: `故事.json kind 必须是 short-story` }
  if (raw.formatVersion !== STORY_FORMAT_VERSION) return { ok: false, reason: `故事.json formatVersion 必须是 ${STORY_FORMAT_VERSION}` }
  if (typeof raw.storyId !== 'string') return { ok: false, reason: '故事.json 缺少合法 storyId' }
  if (typeof raw.title !== 'string') return { ok: false, reason: '故事.json 缺少合法 title' }
  if (!isRecord(raw.target)) return { ok: false, reason: '故事.json 缺少合法 target' }
  if (raw.target.profile !== 'ultra-short' && raw.target.profile !== 'mid-short' && raw.target.profile !== 'custom') {
    return { ok: false, reason: '故事.json target.profile 非法' }
  }
  if (!isNullableNonNegativeInt(raw.target.minChars) || !isNullableNonNegativeInt(raw.target.idealChars) || !isNullableNonNegativeInt(raw.target.maxChars)) {
    return { ok: false, reason: '故事.json target 字数边界非法' }
  }
  if (raw.target.counting !== 'codepoint') return { ok: false, reason: '故事.json target.counting 必须是 codepoint' }
  if (!isRecord(raw.rulePack) || typeof raw.rulePack.id !== 'string' || typeof raw.rulePack.version !== 'number' || typeof raw.rulePack.hash !== 'string') {
    return { ok: false, reason: '故事.json rulePack 非法' }
  }
  if (raw.platformProfile !== FANQIE_SHORT_STORY_PLATFORM_PROFILE) return { ok: false, reason: '当前项目只接受番茄短故事平台 profile' }

  const data: ShortStoryManifest = {
    schemaVersion: STORY_MACHINE_SCHEMA_VERSION,
    kind: 'short-story',
    formatVersion: STORY_FORMAT_VERSION,
    storyId: raw.storyId,
    title: raw.title,
    target: {
      profile: raw.target.profile,
      minChars: raw.target.minChars,
      idealChars: raw.target.idealChars,
      maxChars: raw.target.maxChars,
      counting: 'codepoint',
    },
    rulePack: { id: raw.rulePack.id, version: raw.rulePack.version, hash: raw.rulePack.hash },
    platformProfile: FANQIE_SHORT_STORY_PLATFORM_PROFILE,
  }
  try {
    validateShortStoryId(data.storyId)
    validateShortStoryTitle(data.title)
    validateTarget(data.target)
    validateRulePack(data.rulePack)
    assertFanqieShortStoryRulePack(data.rulePack, data.platformProfile)
  } catch (error) {
    return { ok: false, reason: String(error) }
  }
  return { ok: true, data }
}

export function serializeShortStoryManifest(manifest: ShortStoryManifest): string {
  validateShortStoryId(manifest.storyId)
  validateShortStoryTitle(manifest.title)
  validateTarget(manifest.target)
  validateRulePack(manifest.rulePack)
  assertFanqieShortStoryRulePack(manifest.rulePack, manifest.platformProfile)
  return `${JSON.stringify({
    schemaVersion: STORY_MACHINE_SCHEMA_VERSION,
    kind: 'short-story',
    formatVersion: STORY_FORMAT_VERSION,
    storyId: manifest.storyId,
    title: manifest.title,
    target: manifest.target,
    rulePack: manifest.rulePack,
    platformProfile: manifest.platformProfile,
  }, null, 2)}\n`
}
