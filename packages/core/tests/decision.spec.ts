/**
 * 3c 写入器统一:裁决回写校验失败不落盘。
 *
 * writeSettlementDecision（原 novel-tools 工具层裸写,收编进 core）:
 * 清单缺失/机器态解析失败即失败、零写盘;合法清单才写裁决字段。
 */
import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import * as os from 'node:os'
import { serializeMachineJson, MACHINE_SCHEMA_VERSION, writeSettlementDecision } from '../src/index'

const roots: string[] = []
function mkBook(): string {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'webnovel-decision-'))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放 */ } } })

const dir = nodePath.join('草稿区', '定稿准备', '卷01-开篇任务')
const 清单abs = (root: string): string => nodePath.join(root, dir, '清单.json')

describe('裁决回写(写入器统一,校验失败不落盘)', () => {
  it('缺清单.json → 失败且不写任何文件', () => {
    const root = mkBook()
    const r = writeSettlementDecision(root, { 卷: 1, 章名: '开篇任务' }, '已批准')
    expect(r.ok).toBe(false)
    expect(fs.existsSync(nodePath.join(root, dir))).toBe(false)
  })

  it('清单非机器态 → 解析失败且原文不被改写', () => {
    const root = mkBook()
    fs.mkdirSync(nodePath.join(root, dir), { recursive: true })
    fs.writeFileSync(清单abs(root), '不是 json', 'utf-8')
    const r = writeSettlementDecision(root, { 卷: 1, 章名: '开篇任务' }, '已批准')
    expect(r.ok).toBe(false)
    expect(fs.readFileSync(清单abs(root), 'utf-8')).toBe('不是 json')
  })

  it('合法清单 → 裁决写入,机器态可解析', () => {
    const root = mkBook()
    fs.mkdirSync(nodePath.join(root, dir), { recursive: true })
    fs.writeFileSync(清单abs(root), serializeMachineJson({ 文件: [], 校验: '通过' }, MACHINE_SCHEMA_VERSION), 'utf-8')
    const r = writeSettlementDecision(root, { 卷: 1, 章名: '开篇任务' }, '已退回')
    expect(r.ok).toBe(true)
    const text = fs.readFileSync(清单abs(root), 'utf-8')
    const parsed = JSON.parse(text)
    expect(parsed['裁决']).toBe('已退回')
    expect(parsed['schemaVersion']).toBe(MACHINE_SCHEMA_VERSION)
  })
})
