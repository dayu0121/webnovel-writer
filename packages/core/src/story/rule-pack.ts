import { shortStoryJsonHash } from './hash'
import {
  FANQIE_SHORT_STORY_PLATFORM_PROFILE,
  FANQIE_SHORT_STORY_RULE_PACK_ID,
  FANQIE_SHORT_STORY_RULE_PACK_VERSION,
  validateRulePack,
  validateTarget,
  type ShortStoryRulePackRef,
  type ShortStoryTarget,
} from './paths'
export { FANQIE_SHORT_STORY_PLATFORM_PROFILE, FANQIE_SHORT_STORY_RULE_PACK_ID, FANQIE_SHORT_STORY_RULE_PACK_VERSION } from './paths'

export type FanqieRuleSourceKind = 'official-public' | 'editorial-guidance'
export type FanqieTargetProfile = 'ultra-short' | 'mid-short' | 'custom'

export interface FanqieRuleSource {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly publishedAt: string | null
  readonly kind: FanqieRuleSourceKind
  readonly scope: string
}

export interface FanqieTargetRule {
  readonly label: string
  readonly minChars: number | null
  readonly idealChars: number | null
  readonly maxChars: number | null
  readonly counting: 'codepoint'
  readonly sourceIds: readonly string[]
  readonly scope: string
}

export interface FanqieShortStoryRulePack {
  readonly schemaVersion: 1
  readonly id: typeof FANQIE_SHORT_STORY_RULE_PACK_ID
  readonly version: typeof FANQIE_SHORT_STORY_RULE_PACK_VERSION
  readonly platform: 'fanqie'
  readonly platformProfile: typeof FANQIE_SHORT_STORY_PLATFORM_PROFILE
  readonly title: string
  readonly authority: 'official-public+editorial-guidance'
  readonly verifiedAt: string
  readonly effectiveFrom: string
  readonly scope: string
  readonly sources: readonly FanqieRuleSource[]
  readonly targets: Readonly<Record<FanqieTargetProfile, FanqieTargetRule>>
  readonly review: {
    readonly requiredModules: readonly ['结构与因果', '人物与情绪', '连续性与交付']
    readonly guidance: readonly string[]
  }
  readonly delivery: {
    readonly manualSubmission: true
    readonly autoPublish: false
    readonly outputFormats: readonly ['md', 'txt']
    readonly prohibitedPractices: readonly string[]
    readonly notice: string
  }
  readonly hash: string
}

const rulePackContent: Omit<FanqieShortStoryRulePack, 'hash'> = {
  schemaVersion: 1,
  id: FANQIE_SHORT_STORY_RULE_PACK_ID,
  version: FANQIE_SHORT_STORY_RULE_PACK_VERSION,
  platform: 'fanqie',
  platformProfile: FANQIE_SHORT_STORY_PLATFORM_PROFILE,
  title: '番茄短故事通用创作与交付规则包',
  authority: 'official-public+editorial-guidance',
  verifiedAt: '2026-09-25',
  effectiveFrom: '2026-09-25',
  scope: '番茄短故事通用创作与本地交付；不替代具体活动的投稿字段、奖励口径、题材赛道或审核规则，具体活动必须另建规则包。',
  sources: [
    { id: 'fanqie-2026-overview', title: '2026番茄短故事激励活动全览', url: 'https://fanqienovel.com/writer/zone/article/7685973837409697854', publishedAt: '2026-09-18', kind: 'official-public', scope: '活动全览、投稿方式与通用创作提示；不把活动奖励规则当作永久平台规则。' },
    { id: 'fanqie-2026-qianziwanjin-2', title: '番茄短故事2026「千字万金」五百万激励计划第二期', url: 'https://fanqienovel.com/writer/zone/article/7621764547262545982', publishedAt: '2026-04-10', kind: 'official-public', scope: '超短篇/中短篇公开篇幅分类与该活动投稿说明。' },
    { id: 'fanqie-2026-columbus', title: '番茄短故事2026西方题材赛道「哥伦布计划」', url: 'https://fanqienovel.com/writer/zone/article/7637809338446266430', publishedAt: '2026-05-12', kind: 'official-public', scope: '活动题材与投稿口径；不泛化为所有番茄短故事。' },
    { id: 'fanqie-classroom-direction', title: '短故事作家课堂：热门方向与创作指南', url: 'https://fanqienovel.com/writer/zone/article/7670363158518693950', publishedAt: null, kind: 'editorial-guidance', scope: '开篇冲突、人物行动、情绪与闭环的创作指导，不作为机械合规门槛。' },
    { id: 'fanqie-classroom-elements', title: '拆解世情短故事热门元素组合', url: 'https://fanqienovel.com/writer/zone/article/7683816556886753342', publishedAt: null, kind: 'editorial-guidance', scope: '生活细节、关系、规则与具体场景的创作指导。' },
  ],
  targets: {
    'ultra-short': { label: '超短篇', minChars: 8000, idealChars: null, maxChars: 24900, counting: 'codepoint', sourceIds: ['fanqie-2026-qianziwanjin-2'], scope: '2026第二期公开分类口径；活动变化时必须新建规则包版本。' },
    'mid-short': { label: '中短篇', minChars: 25000, idealChars: null, maxChars: 80000, counting: 'codepoint', sourceIds: ['fanqie-2026-qianziwanjin-2'], scope: '2026第二期公开分类口径；活动变化时必须新建规则包版本。' },
    custom: { label: '自定义番茄短故事', minChars: null, idealChars: null, maxChars: null, counting: 'codepoint', sourceIds: [], scope: '仍属于番茄短故事，但不使用活动分类阈值；作者自行承担目标设置与投稿核对。' },
  },
  review: {
    requiredModules: ['结构与因果', '人物与情绪', '连续性与交付'],
    guidance: [
      '开篇尽快建立具体危机或强冲突。',
      '主角必须有清晰行动和选择，不能长期只受辱或被剧情推着走。',
      '冲突升级应带来新的代价、选择或信息，而不是重复事件。',
      '高潮要回收前文铺垫，结局完成关系、价值或人物秩序的收束。',
      '生活细节、关系、规则和具体场景应承载矛盾，避免空泛解释。',
    ],
  },
  delivery: {
    manualSubmission: true,
    autoPublish: false,
    outputFormats: ['md', 'txt'],
    prohibitedPractices: ['恶意水字数', '章节重复', '抄袭', '异常引流'],
    notice: '工作台只准备交付文件，不代替作者在番茄后台投稿、发送邮件或发布。',
  },
}

export const FANQIE_SHORT_STORY_RULE_PACK_HASH = shortStoryJsonHash(rulePackContent)
export const FANQIE_SHORT_STORY_RULE_PACK: FanqieShortStoryRulePack = { ...rulePackContent, hash: FANQIE_SHORT_STORY_RULE_PACK_HASH }
export const FANQIE_SHORT_STORY_RULE_PACK_REF: ShortStoryRulePackRef = {
  id: FANQIE_SHORT_STORY_RULE_PACK.id,
  version: FANQIE_SHORT_STORY_RULE_PACK.version,
  hash: FANQIE_SHORT_STORY_RULE_PACK.hash,
}

export function isFanqieShortStoryRulePackRef(value: unknown): value is ShortStoryRulePackRef {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.id === FANQIE_SHORT_STORY_RULE_PACK_REF.id
    && record.version === FANQIE_SHORT_STORY_RULE_PACK_REF.version
    && record.hash === FANQIE_SHORT_STORY_RULE_PACK_REF.hash
}

export function assertFanqieShortStoryRulePack(value: ShortStoryRulePackRef, platformProfile?: string | null): void {
  validateRulePack(value)
  if (!isFanqieShortStoryRulePackRef(value)) throw new Error(`当前项目只接受番茄短故事规则包:${FANQIE_SHORT_STORY_RULE_PACK_REF.id}@${FANQIE_SHORT_STORY_RULE_PACK_REF.version}#${FANQIE_SHORT_STORY_RULE_PACK_REF.hash.slice(0, 12)}`)
  if (platformProfile !== undefined && platformProfile !== null && platformProfile !== FANQIE_SHORT_STORY_PLATFORM_PROFILE) throw new Error(`当前项目只接受番茄平台 profile:${FANQIE_SHORT_STORY_PLATFORM_PROFILE}`)
}

export function normalizeFanqieTarget(input: ShortStoryTarget): ShortStoryTarget {
  validateTarget(input)
  if (input.profile === 'custom') return { ...input }
  const rule = FANQIE_SHORT_STORY_RULE_PACK.targets[input.profile]
  const minChars = input.minChars ?? rule.minChars
  const maxChars = input.maxChars ?? rule.maxChars
  if (minChars === null || maxChars === null) throw new Error(`番茄${rule.label}规则缺少字数边界`)
  if (minChars < rule.minChars! || minChars > rule.maxChars! || maxChars < rule.minChars! || maxChars > rule.maxChars!) {
    throw new Error(`番茄${rule.label}目标必须位于公开口径 ${rule.minChars}-${rule.maxChars} 字`)
  }
  if (input.idealChars !== null && (input.idealChars < minChars || input.idealChars > maxChars)) throw new Error('目标理想字数必须位于目标下限和上限之间')
  return { ...input, minChars, maxChars }
}
