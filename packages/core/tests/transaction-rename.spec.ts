import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import { writeFileAtomic } from '../src/repo/atomic'
import { removeSync } from '../src/repo/remove'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  for (const root of roots.splice(0)) removeSync(root)
})

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-rename-'))
  roots.push(root)
  return root
}

describe('事务 rename 失败边界', () => {
  it.runIf(process.platform === 'win32')('短暂 EPERM 后完成整批，不留半成品', () => {
    const root = fixture()
    const original = fs.renameSync
    let attempts = 0
    vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (String(source).endsWith('.preparing') && ++attempts < 3) {
        throw Object.assign(new Error('transient reader'), { code: 'EPERM' })
      }
      original(source, target)
    })
    syncBuiltinESMExports()
    writeFileAtomic(root, '定稿/卷01/0001-开篇.md', '完整正文')
    expect(attempts).toBe(3)
    expect(fs.readFileSync(path.join(root, '定稿/卷01/0001-开篇.md'), 'utf8')).toBe('完整正文')
    expect(fs.readdirSync(path.join(root, '.webnovel', 'transactions'))).toEqual([])
  })

  it('EXDEV 不重试，保留未发布批次且不写真源', () => {
    const root = fixture()
    const original = fs.renameSync
    let attempts = 0
    vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (String(source).endsWith('.preparing')) {
        attempts++
        throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' })
      }
      original(source, target)
    })
    syncBuiltinESMExports()
    expect(() => writeFileAtomic(root, '正文.md', '不应落盘')).toThrow('EXDEV')
    expect(attempts).toBe(1)
    expect(fs.existsSync(path.join(root, '正文.md'))).toBe(false)
    expect(fs.readdirSync(path.join(root, '.webnovel', 'transactions'))).toHaveLength(1)
  })
})
