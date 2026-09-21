import { describe, expect, it } from 'vitest'
import {
  MACHINE_SCHEMA_VERSION,
  parseMachineJson,
  serializeMachineJson,
} from '../src/repo/schema'

describe('机器态 JSON(B8 schemaVersion)', () => {
  it('接受已知版本', () => {
    const r = parseMachineJson(JSON.stringify({ schemaVersion: 1, 状态: '可写' }), MACHINE_SCHEMA_VERSION)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.schemaVersion).toBe(1)
      expect(r.data['状态']).toBe('可写')
    }
  })

  it('拒绝缺 schemaVersion', () => {
    const r = parseMachineJson(JSON.stringify({ 状态: '可写' }), MACHINE_SCHEMA_VERSION)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('parse-error')
      expect(r.detail).toContain('schemaVersion')
    }
  })

  it('拒绝未知版本', () => {
    const r = parseMachineJson(JSON.stringify({ schemaVersion: 99 }), MACHINE_SCHEMA_VERSION)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('parse-error')
      expect(r.detail).toMatch(/未知|不匹配/)
    }
  })

  it('拒绝非法 JSON', () => {
    const r = parseMachineJson('{坏的 json', MACHINE_SCHEMA_VERSION)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('parse-error')
  })

  it('往返:serialize 必写 schemaVersion,parse 还原字段', () => {
    const text = serializeMachineJson({ 完成: true, 问题: [] }, MACHINE_SCHEMA_VERSION)
    expect(JSON.parse(text).schemaVersion).toBe(1)
    const r = parseMachineJson(text, MACHINE_SCHEMA_VERSION)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data['完成']).toBe(true)
      expect(r.data.schemaVersion).toBe(1)
    }
  })
})
