import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createHash } from 'node:crypto'
import { recoverTransactions, runTransaction, withBookLock, writeBatchAtomic } from '../src'

const roots: string[] = []
function mkRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-txn-'))
  roots.push(root)
  return root
}
afterAll(() => { for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* temp cleanup */ } } })

describe('书仓写入锁', () => {
  it('同一进程嵌套可重入,退出后锁清理', () => {
    const root = mkRoot()
    const seen: string[] = []
    withBookLock(root, () => {
      seen.push('outer')
      withBookLock(root, () => { seen.push('inner') })
    })
    expect(seen).toEqual(['outer', 'inner'])
    expect(fs.existsSync(path.join(root, '.webnovel', 'book.lock'))).toBe(false)
  })

  it('活跃锁拒绝第二个写入者,不会盲删锁', () => {
    const root = mkRoot()
    fs.mkdirSync(path.join(root, '.webnovel'), { recursive: true })
    fs.writeFileSync(path.join(root, '.webnovel', 'book.lock'), JSON.stringify({ pid: process.pid }) + '\n', 'utf-8')
    expect(() => withBookLock(root, () => undefined)).toThrow(/写入锁定中/)
    expect(fs.existsSync(path.join(root, '.webnovel', 'book.lock'))).toBe(true)
  })
})

describe('多文件事务恢复', () => {
  it('中断批次恢复既有目标并删除新目标与同目录临时文件', () => {
    const root = mkRoot()
    const id = 'crashed'
    const tx = path.join(root, '.webnovel', 'transactions', id)
    fs.mkdirSync(path.join(tx, 'backups'), { recursive: true })
    fs.mkdirSync(path.join(root, '正文'), { recursive: true })
    fs.writeFileSync(path.join(root, '正文', '旧.md'), '新内容\n', 'utf-8')
    fs.writeFileSync(path.join(tx, 'backups', '0.bak'), '旧内容\n', 'utf-8')
    fs.writeFileSync(path.join(root, '正文', '.webnovel-txn-crashed-1.tmp'), '临时\n', 'utf-8')
    fs.writeFileSync(path.join(root, '正文', '新.md'), '新目标\n', 'utf-8')
    const hash = createHash('sha256').update('新内容\n').digest('hex')
    fs.writeFileSync(path.join(tx, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      id,
      createdAt: new Date().toISOString(),
      phase: 'applying',
      entries: [
        { relPath: '正文/旧.md', tmpRel: `正文/.webnovel-txn-${id}-0.tmp`, backupRel: `.webnovel/transactions/${id}/backups/0.bak`, originalHash: createHash('sha256').update('旧内容\n').digest('hex'), hadOriginal: true, backupRecorded: true, applied: true, contentHash: hash },
        { relPath: '正文/新.md', tmpRel: `正文/.webnovel-txn-${id}-1.tmp`, backupRel: `.webnovel/transactions/${id}/backups/1.bak`, originalHash: null, hadOriginal: false, backupRecorded: true, applied: true, contentHash: createHash('sha256').update('新目标\n').digest('hex') },
      ],
    }), 'utf-8')
    recoverTransactions(root)
    expect(fs.readFileSync(path.join(root, '正文', '旧.md'), 'utf-8')).toBe('旧内容\n')
    expect(fs.existsSync(path.join(root, '正文', '新.md'))).toBe(false)
    expect(fs.existsSync(path.join(root, '正文', '.webnovel-txn-crashed-1.tmp'))).toBe(false)
    expect(fs.existsSync(tx)).toBe(false)
  })

  it('manifest 在 rename 后尚未标记 applied 时按内容指纹恢复', () => {
    const root = mkRoot()
    const id = 'crashed-after-rename'
    const tx = path.join(root, '.webnovel', 'transactions', id)
    fs.mkdirSync(path.join(tx, 'backups'), { recursive: true })
    fs.mkdirSync(path.join(root, '正文'), { recursive: true })
    fs.writeFileSync(path.join(root, '正文', '章.md'), '新\n', 'utf-8')
    fs.writeFileSync(path.join(tx, 'backups', '0.bak'), '旧\n', 'utf-8')
    fs.writeFileSync(path.join(tx, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, id, createdAt: new Date().toISOString(), phase: 'applying',
      entries: [{ relPath: '正文/章.md', tmpRel: `正文/.webnovel-txn-${id}-0.tmp`, backupRel: `.webnovel/transactions/${id}/backups/0.bak`, originalHash: createHash('sha256').update('旧\n').digest('hex'), hadOriginal: true, backupRecorded: true, applied: false, contentHash: createHash('sha256').update('新\n').digest('hex') }],
    }), 'utf-8')
    recoverTransactions(root)
    expect(fs.readFileSync(path.join(root, '正文', '章.md'), 'utf-8')).toBe('旧\n')
    expect(fs.existsSync(tx)).toBe(false)
  })

  it('作者在中断后改过目标时不被恢复批次覆盖', () => {
    const root = mkRoot()
    const id = 'author-edited-after-crash'
    const tx = path.join(root, '.webnovel', 'transactions', id)
    fs.mkdirSync(path.join(tx, 'backups'), { recursive: true })
    fs.mkdirSync(path.join(root, '正文'), { recursive: true })
    fs.writeFileSync(path.join(root, '正文', '章.md'), '作者后来修改\n', 'utf-8')
    fs.writeFileSync(path.join(tx, 'backups', '0.bak'), '旧\n', 'utf-8')
    fs.writeFileSync(path.join(tx, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, id, createdAt: new Date().toISOString(), phase: 'applying',
      entries: [{ relPath: '正文/章.md', tmpRel: `正文/.webnovel-txn-${id}-0.tmp`, backupRel: `.webnovel/transactions/${id}/backups/0.bak`, originalHash: createHash('sha256').update('旧\n').digest('hex'), hadOriginal: true, backupRecorded: true, applied: true, contentHash: createHash('sha256').update('新\n').digest('hex') }],
    }), 'utf-8')
    expect(() => recoverTransactions(root)).toThrow(/恢复冲突/)
    expect(fs.readFileSync(path.join(root, '正文', '章.md'), 'utf-8')).toBe('作者后来修改\n')
    expect(fs.existsSync(tx)).toBe(true)
  })

  it('正常批次完成后不残留事务目录', () => {
    const root = mkRoot()
    runTransaction(root, [{ relPath: '正文/章.md', content: '正文\n' }])
    expect(fs.readFileSync(path.join(root, '正文', '章.md'), 'utf-8')).toBe('正文\n')
    expect(fs.readdirSync(path.join(root, '.webnovel', 'transactions'))).toEqual([])
  })

  it('传入 provenance 时保留可读的操作审计', () => {
    const root = mkRoot()
    writeBatchAtomic(root, [{ relPath: '正文/章.md', content: '正文\n' }], {
      provenance: {
        operationId: 'op-test-001',
        sessionId: 'session-test',
        agentId: 'agent-test',
        toolName: 'novel_import_draft',
        callId: 'call-test',
      },
    })
    const audit = JSON.parse(fs.readFileSync(path.join(root, '.webnovel', 'operations', 'op-test-001.json'), 'utf-8')) as Record<string, unknown>
    expect(audit.status).toBe('completed')
    expect(audit.operationId).toBe('op-test-001')
    expect(audit.sessionId).toBe('session-test')
    expect(audit.agentId).toBe('agent-test')
    expect(audit.toolName).toBe('novel_import_draft')
    expect(audit.callId).toBe('call-test')
    expect(audit.targets).toEqual(['正文/章.md'])
  })

  it('事务失败也记录 failed 阶段而不是伪造成功', () => {
    const root = mkRoot()
    fs.mkdirSync(path.join(root, '占位目录'), { recursive: true })
    expect(() => writeBatchAtomic(root, [{ relPath: '占位目录', content: '不能覆盖目录' }], {
      provenance: { operationId: 'op-test-failed', toolName: 'test' },
    })).toThrow(/B1/)
    const audit = JSON.parse(fs.readFileSync(path.join(root, '.webnovel', 'operations', 'op-test-failed.json'), 'utf-8')) as Record<string, unknown>
    expect(audit.status).toBe('failed')
    expect(String(audit.error)).toMatch(/事务|EPERM|目录/)
  })
})
