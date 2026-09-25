import { assertSegment, validateSegment } from '../repo/paths'

export const STORY_FORMAT_VERSION = 1
export const STORY_MACHINE_SCHEMA_VERSION = 1
export const FANQIE_SHORT_STORY_RULE_PACK_ID = 'fanqie-short-story'
export const FANQIE_SHORT_STORY_RULE_PACK_VERSION = 1
export const FANQIE_SHORT_STORY_PLATFORM_PROFILE = 'fanqie-short-story'

export interface ShortStoryTarget {
  readonly profile: 'ultra-short' | 'mid-short' | 'custom'
  readonly minChars: number | null
  readonly idealChars: number | null
  readonly maxChars: number | null
  readonly counting: 'codepoint'
}

export interface ShortStoryRulePackRef {
  readonly id: string
  readonly version: number
  readonly hash: string
}

export interface ShortStoryManifest {
  readonly schemaVersion: 1
  readonly kind: 'short-story'
  readonly formatVersion: 1
  readonly storyId: string
  readonly title: string
  readonly target: ShortStoryTarget
  readonly rulePack: ShortStoryRulePackRef
  readonly platformProfile: typeof FANQIE_SHORT_STORY_PLATFORM_PROFILE
}

function assertStoryId(storyId: string): void {
  if (!/^s-[a-zA-Z0-9_-]{3,120}$/.test(storyId)) throw new Error(`故事 id 非法:${storyId}`)
}

function assertDraftNo(no: number): void {
  if (!Number.isSafeInteger(no) || no < 1) throw new Error(`短故事稿号必须是正整数:${no}`)
}

export const shortStoryPaths = {
  manifest: (): string => '故事.json',
  card: (): string => '作品卡.md',
  blueprint: (): string => '蓝图/故事蓝图.md',
  characters: (): string => '蓝图/人物表.md',
  setting: (): string => '蓝图/设定.md',
  planDraftDir: (): string => '草稿区/短故事计划',
  planDraftCard: (): string => '草稿区/短故事计划/作品卡.md',
  planDraftBlueprint: (): string => '草稿区/短故事计划/故事蓝图.md',
  draftsDir: (): string => '正文/草稿',
  draft: (no: number): string => `正文/草稿/稿${String(no).padStart(3, '0')}.md`,
  finalDir: (): string => '正文/定稿',
  final: (revision: number): string => `正文/定稿/r${String(revision).padStart(3, '0')}.md`,
  review: (): string => '检查/审读记录.json',
  delivery: (): string => '检查/交付检查.json',
  settlementReceipt: (): string => '检查/定稿回执.json',
  exportRecord: (): string => '检查/导出记录.json',
} as const

export function validateShortStoryTitle(title: string): void {
  assertSegment(title, '故事标题')
}

export function validateShortStoryId(storyId: string): void {
  assertStoryId(storyId)
}

export function validateDraftNumber(no: number): void {
  assertDraftNo(no)
}

export function validateTarget(target: ShortStoryTarget): void {
  if (target.profile !== 'ultra-short' && target.profile !== 'mid-short' && target.profile !== 'custom') throw new Error(`目标类型非法:${String(target.profile)}`)
  for (const [name, value] of [['minChars', target.minChars], ['idealChars', target.idealChars], ['maxChars', target.maxChars]] as const) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`${name} 必须是非负整数或 null`)
  }
  if (target.counting !== 'codepoint') throw new Error(`不支持的字数口径:${String(target.counting)}`)
  if (target.minChars !== null && target.maxChars !== null && target.minChars > target.maxChars) {
    throw new Error('目标字数下限不能大于上限')
  }
  if (target.idealChars !== null && target.minChars !== null && target.idealChars < target.minChars) throw new Error('目标理想字数不能低于下限')
  if (target.idealChars !== null && target.maxChars !== null && target.idealChars > target.maxChars) throw new Error('目标理想字数不能高于上限')
}

export function validateRulePack(rulePack: ShortStoryRulePackRef): void {
  const problems = validateSegment(rulePack.id)
  if (problems.length > 0) throw new Error(`规则包 id 非法:${problems.join(';')}`)
  if (!Number.isSafeInteger(rulePack.version) || rulePack.version < 1) throw new Error('规则包版本必须是正整数')
  if (!/^[0-9a-f]{64}$/.test(rulePack.hash)) throw new Error('规则包 hash 必须是 64 位 sha256')
}
