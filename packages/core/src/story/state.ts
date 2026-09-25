import * as fs from 'node:fs'
import * as path from 'node:path'
import { listShortStoryDrafts, readShortStoryManifest } from './drafts'
import { isShortStoryReviewComplete, loadShortStoryReview, SHORT_STORY_REVIEW_MODULES, shortStoryReviewIdentity } from './review'
import { loadShortStoryDelivery } from './delivery'
import { readConfirmedShortStoryPlan } from './plan'
import { shortStoryPaths } from './paths'

export type ShortStoryPosition = '故事卡准备' | '蓝图待确认' | '可写' | '起草中' | '待审' | '修订中' | '定稿候选' | '可交付' | '已定稿'

export interface ShortStoryStateFacts {
  readonly 平台: 'fanqie'
  readonly 规则包: { readonly id: string; readonly version: number; readonly hash: string }
  readonly 计划已确认: boolean
  readonly 有待审稿: boolean
  readonly 待审稿唯一: boolean
  readonly 审读完成: boolean
  readonly 有待处理发现项: boolean
  readonly 交付检查当前: boolean
  readonly 已定稿: boolean
}

export interface ShortStoryState {
  readonly 建议: ShortStoryPosition
  readonly 事实: ShortStoryStateFacts
  readonly 下一步: string
}

export type ShortStoryStateResult =
  | ({ readonly ok: true } & ShortStoryState)
  | { readonly ok: false; readonly reason: string }

function exists(root: string, rel: string): boolean {
  try { return fs.existsSync(path.join(root, rel)) } catch { return false }
}

function facts(overrides: Partial<ShortStoryStateFacts> = {}): ShortStoryStateFacts {
  return {
    平台: 'fanqie',
    规则包: { id: '', version: 0, hash: '' },
    计划已确认: false,
    有待审稿: false,
    待审稿唯一: false,
    审读完成: false,
    有待处理发现项: false,
    交付检查当前: false,
    已定稿: false,
    ...overrides,
  }
}

function nextStep(position: ShortStoryPosition): string {
  switch (position) {
    case '故事卡准备': return '整理作品卡与一页故事蓝图。'
    case '蓝图待确认': return '核对作品卡和蓝图 hash 后确认计划。'
    case '可写': return '按已确认蓝图生成整篇待审稿。'
    case '起草中': return '完成整篇草稿后提交唯一待审稿。'
    case '待审': return '按三个登记模块完成全篇审读。'
    case '修订中': return '处理全部发现项；改正文后必须重新审读。'
    case '定稿候选': return '运行交付检查并呈报定稿裁决。'
    case '可交付': return '等待作者按正文、审读和交付检查 hash 批准定稿。'
    case '已定稿': return '按需导出 MD/TXT；修改须走修订或补偿。'
  }
}

function result(position: ShortStoryPosition, stateFacts: ShortStoryStateFacts, customNext?: string): ShortStoryStateResult {
  return { ok: true, 建议: position, 事实: stateFacts, 下一步: customNext ?? nextStep(position) }
}

export function deriveShortStoryState(root: string, storyId: string): ShortStoryStateResult {
  try {
    const manifest = readShortStoryManifest(root, storyId)
    const platformFacts = { 平台: 'fanqie' as const, 规则包: manifest.rulePack }
    let planConfirmed = true
    try { readConfirmedShortStoryPlan(root, storyId) } catch (error) {
      const reason = String(error)
      if (reason.includes('尚未确认') || reason.includes('计划真源不存在')) planConfirmed = false
      else return { ok: false, reason }
    }
    if (!planConfirmed) {
      const candidate = exists(root, shortStoryPaths.planDraftCard()) || exists(root, shortStoryPaths.planDraftBlueprint())
      return result(candidate ? '蓝图待确认' : '故事卡准备', facts(platformFacts))
    }
    const drafts = listShortStoryDrafts(root, storyId)
    const pending = drafts.filter(draft => draft.role === '待审稿')
    const finalizedDir = path.join(root, shortStoryPaths.finalDir())
    const finalized = (() => { try { return fs.readdirSync(finalizedDir).some(name => /^r\d+\.md$/.test(name)) } catch { return false } })()
    if (finalized) return result('已定稿', facts({ ...platformFacts, 计划已确认: true, 有待审稿: pending.length > 0, 待审稿唯一: pending.length === 1, 已定稿: true }))
    if (pending.length === 0) return result(drafts.length > 0 ? '起草中' : '可写', facts({ ...platformFacts, 计划已确认: true }))
    if (pending.length !== 1) return result('待审', facts({ ...platformFacts, 计划已确认: true, 有待审稿: true }), '待审稿不唯一，先降级到只剩一份。')

    const identityResult = shortStoryReviewIdentity(root, storyId)
    if (!identityResult.ok) return { ok: false, reason: identityResult.reason }
    const identity = identityResult
    const review = loadShortStoryReview(root)
    const reviewComplete = isShortStoryReviewComplete(review, identity)
    const pendingFindings = review?.问题.some(finding => finding.处置状态 === '待处理') ?? false
    let deliveryCurrent = false
    let position: ShortStoryPosition
    if (reviewComplete) {
      const delivery = loadShortStoryDelivery(root)
      if (delivery !== null) {
        deliveryCurrent = delivery.record.平台 === 'fanqie'
          && delivery.record.规则包.id === manifest.rulePack.id
          && delivery.record.规则包.version === manifest.rulePack.version
          && delivery.record.规则包.hash === manifest.rulePack.hash
          && delivery.record.规则包哈希 === manifest.rulePack.hash
          && delivery.record.目标指纹 === identity.fingerprint
          && delivery.record.草稿哈希 === identity.draftHash
          && delivery.record.审读哈希 === identity.reviewHash
          && delivery.record.result === '通过'
          && delivery.record.blockers.length === 0
      }
      position = deliveryCurrent ? '可交付' : '定稿候选'
    } else {
      const allReviewModulesPresent = review !== null && SHORT_STORY_REVIEW_MODULES.every(module => review.模块[module] !== undefined)
      position = pendingFindings && allReviewModulesPresent ? '修订中' : '待审'
    }
    return result(position, facts({
      ...platformFacts,
      计划已确认: true,
      有待审稿: true,
      待审稿唯一: true,
      审读完成: reviewComplete,
      有待处理发现项: pendingFindings,
      交付检查当前: deliveryCurrent,
    }))
  } catch (error) {
    return { ok: false, reason: String(error) }
  }
}
