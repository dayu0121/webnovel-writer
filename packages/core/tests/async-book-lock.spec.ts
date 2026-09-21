import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { withBookLock, withBookLockAsync, withBookWriteAsync, writeBatchAtomic } from '../src'
import { removeSync } from '../src/repo/remove'

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-async-lock-')) })
afterEach(() => { removeSync(root) })
const lockPath = () => path.join(root, '.webnovel/book.lock')

describe('等待原生写入时的书仓锁', () => {
  it('跨 await 保持独占，同一调用链可重入同步提交与原子事务', async () => {
    let release!: () => void
    const paused = new Promise<void>(resolve => { release = resolve })
    const task = withBookWriteAsync(root, async () => {
      await paused
      expect(fs.existsSync(lockPath())).toBe(true)
      await withBookLockAsync(root, async () => {
        withBookLock(root, () => writeBatchAtomic(root, [{ relPath: '大纲/故事骨架.md', content: '正文\n' }]))
      })
      expect(fs.existsSync(lockPath())).toBe(true)
    }, { operationId: 'async-native-write', callId: 'call-1' })
    try {
      const owner = fs.readFileSync(lockPath(), 'utf8')
      expect(() => withBookLock(root, () => undefined)).toThrow(/写入锁定中/)
      await expect(withBookLockAsync(root, async () => undefined)).rejects.toThrow(/写入锁定中/)
      expect(fs.readFileSync(lockPath(), 'utf8')).toBe(owner)
    } finally { release(); await task }
    expect(fs.existsSync(lockPath())).toBe(false)
    expect(fs.readFileSync(path.join(root, '大纲/故事骨架.md'), 'utf8')).toBe('正文\n')
    const audit = JSON.parse(fs.readFileSync(path.join(root, '.webnovel/operations/async-native-write.json'), 'utf8'))
    expect(audit).toMatchObject({ status: 'completed', callId: 'call-1', targets: ['大纲/故事骨架.md'] })
  })

  it.each(['throw', 'failure'] as const)('%s 时释放锁并保留失败审计，随后能重新写入', async mode => {
    const task = withBookLockAsync(root, async () => {
      await Promise.resolve()
      if (mode === 'throw') throw new Error('原生版本冲突')
      return { ok: false, reason: '原生版本冲突' }
    }, { operationId: `failure-${mode}` })
    if (mode === 'throw') await expect(task).rejects.toThrow('原生版本冲突')
    else await expect(task).resolves.toEqual({ ok: false, reason: '原生版本冲突' })
    expect(fs.existsSync(lockPath())).toBe(false)
    const audit = JSON.parse(fs.readFileSync(path.join(root, `.webnovel/operations/failure-${mode}.json`), 'utf8'))
    expect(audit.status).toBe('failed')
    expect(audit.error).toContain('原生版本冲突')
    expect(withBookLock(root, () => '再次写入')).toBe('再次写入')
  })

  it('同步锁中不能启动异步临界区', async () => {
    let nested!: Promise<void>
    withBookLock(root, () => { nested = withBookLockAsync(root, async () => undefined) })
    await expect(nested).rejects.toThrow(/同步书仓锁内不得启动异步写入/)
    expect(fs.existsSync(lockPath())).toBe(false)
  })
})
