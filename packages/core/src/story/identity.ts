import { shortStoryJsonHash } from './hash'
import type { ShortStoryRulePackRef } from './paths'

export const SHORT_STORY_REVIEW_REVISION = 1

export function shortStoryReviewFingerprint(input: {
  readonly draftHash: string
  readonly planHash: string
  readonly rulePack: ShortStoryRulePackRef
}): string {
  return shortStoryJsonHash({
    kind: 'short-story-review',
    revision: SHORT_STORY_REVIEW_REVISION,
    draftHash: input.draftHash,
    planHash: input.planHash,
    rulePack: input.rulePack,
  })
}
