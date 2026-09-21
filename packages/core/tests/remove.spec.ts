import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { removeSync } from '../src/repo/remove'

const roots: string[] = []
function mkRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-remove-'))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

describe('removeSync', () => {
  it('删除含中文路径的文件与目录，ENOENT 不抛', () => {
    const root = mkRoot()
    const dir = path.join(root, '记忆', '灵感')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, '纸条.md')
    fs.writeFileSync(file, '夜里忽然想到的金手指', 'utf-8')

    removeSync(file)
    expect(fs.existsSync(file)).toBe(false)

    removeSync(path.join(root, '记忆'))
    expect(fs.existsSync(path.join(root, '记忆'))).toBe(false)

    expect(() => removeSync(file)).not.toThrow()
  })
})
