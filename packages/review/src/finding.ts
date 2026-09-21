/**
 * 发现项契约(插件规格 §9)。
 */

import type { Finding, 处置状态 } from '@webnovel/core'

export type { Finding }

export function makeFinding(partial: Omit<Finding, '处置' | '处置状态'> & { readonly 处置状态?: 处置状态 }): Finding {
  const 处置状态 = partial.处置状态 ?? '待处理'
  return { ...partial, 处置状态, 处置: 处置状态 }
}
