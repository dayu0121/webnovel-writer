/**
 * 作者裁决记录(格式规格 §7.1):谁 / 何时 / 哪个版本 / 什么范围 + 种类与决定。
 */

import type { IrreversibleKind } from './kinds'
import { isIrreversibleKind } from './kinds'

export const 裁决决定词 = ['已批准', '已退回', '已确认'] as const
export type 裁决决定 = (typeof 裁决决定词)[number]

export interface 作者裁决记录 {
  readonly 谁: string
  readonly 何时: string
  readonly 版本: string | number
  readonly 范围: string
  readonly 种类: IrreversibleKind
  readonly 决定: 裁决决定
}

export function serializeArbitration(record: 作者裁决记录): Record<string, unknown> {
  return {
    谁: record.谁,
    何时: record.何时,
    版本: record.版本,
    范围: record.范围,
    种类: record.种类,
    决定: record.决定,
  }
}

export function parseArbitration(value: unknown): 作者裁决记录 | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const o = value as Record<string, unknown>
  const 谁 = o['谁']
  const 何时 = o['何时']
  const 版本 = o['版本']
  const 范围 = o['范围']
  const 种类 = o['种类']
  const 决定 = o['决定']
  if (typeof 谁 !== 'string' || 谁 === '') return null
  if (typeof 何时 !== 'string' || 何时 === '') return null
  if (!(typeof 版本 === 'string' || typeof 版本 === 'number')) return null
  if (typeof 范围 !== 'string' || 范围 === '') return null
  if (typeof 种类 !== 'string' || !isIrreversibleKind(种类)) return null
  if (决定 !== '已批准' && 决定 !== '已退回' && 决定 !== '已确认') return null
  return { 谁, 何时, 版本, 范围, 种类, 决定 }
}

export function applyArbitrationField(
  fields: Readonly<Record<string, unknown>>,
  record: 作者裁决记录,
): Record<string, unknown> {
  return { ...fields, 作者裁决: serializeArbitration(record) }
}
