/**
 * 状态三族(格式规格 §7.3——全局唯一定义处的代码面)。
 * 各工件的解析只引用本词表,不得自造近义词(D43/D56⑪)。
 */

export const PLANNING_STATES = [
  '已确认', '暂定', '留白',
  // 特化态
  '进行中', '已兑现', '已结束', '已放弃', '已成事实', '已废弃',
  // 线索域特有(§5.2)
  '已埋', '已示', '已收', '已弃',
] as const

export const ARTIFACT_STATES = [
  '候选', '已确认', '需复核', '已退回', '已替代', '已批准待入档', '已定稿', '已失效',
] as const

export const EPHEMERAL_STATES = [
  '组装中', '段齐备', '段有缺', '有冲突', '已过期', '已消费', '等待补设计', '已并入/已拆分',
] as const

export type StateFamily = '计划族' | '工件族' | '轮次族'

export function familyOf(state: string): StateFamily | null {
  if ((PLANNING_STATES as readonly string[]).includes(state)) return '计划族'
  if ((ARTIFACT_STATES as readonly string[]).includes(state)) return '工件族'
  if ((EPHEMERAL_STATES as readonly string[]).includes(state)) return '轮次族'
  return null
}

/** 校验:状态必须在词表内且族属正确(D56⑪:族属标错即违规)。 */
export function assertState(state: string, expected: StateFamily): void {
  const fam = familyOf(state)
  if (fam === null) {
    throw new Error(`状态「${state}」不在三族词表内(格式规格 §7.3,禁止自造近义词)`)
  }
  if (fam !== expected) {
    throw new Error(`状态「${state}」属${fam},期望${expected}(D56⑪ 族属校验)`)
  }
}

/** 近期窗口条目状态(格式规格 §7.3 末条):计划族已确认/暂定 + 轮次族三态。 */
export const WINDOW_ENTRY_STATES = ['已确认', '暂定', '已消费', '已失效', '等待补设计'] as const

export function isWindowEntryReady(state: string): boolean {
  return state === '已确认' // 「可进入细纲」判定(推导表行 1)
}
