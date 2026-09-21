/**
 * 路径 canonicalization 与 membership（dsh 运行时对齐批）。
 *
 * 覆盖：盘符大小写、相对路径绝对化、不存在深路径（最长存在祖先＋尾段）、
 * junction/symlink 别名（修复前误判逃逸）、`\\?\` 长路径前缀、逃逸仍拒。
 */
import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { canonicalizePath, isInsidePath, resolveInsideBook, stripDevicePrefix } from '../src/index'

const roots: string[] = []
function mkDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(dir)
  return dir
}
afterAll(() => {
  for (const r of roots) {
    try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟 */ }
  }
})

const IS_WIN = process.platform === 'win32'

describe('canonicalizePath', () => {
  it('相对路径绝对化且与 resolve 一致', () => {
    const c = canonicalizePath('some/relative/path')
    expect(path.isAbsolute(c)).toBe(true)
  })

  it('不存在深路径:取最长存在祖先 realpath 并拼回尾段', () => {
    const base = mkDir('webnovel-can-')
    const deep = path.join(base, '不存在的目录', '更深', '草稿.md')
    const c = canonicalizePath(deep)
    expect(c.startsWith(canonicalizePath(base))).toBe(true)
    expect(c.endsWith(path.join('不存在的目录', '更深', '草稿.md'))).toBe(true)
  })

  it('stripDevicePrefix:剥 \\\\?\\ 与 \\\\?\\UNC\\ 前缀', () => {
    if (!IS_WIN) {
      expect(stripDevicePrefix('/a/b')).toBe('/a/b')
      expect(stripDevicePrefix('\\\\?\\C:\\a\\b')).toBe('\\\\?\\C:\\a\\b')
      return
    }
    expect(stripDevicePrefix('\\\\?\\C:\\a\\b')).toBe('C:\\a\\b')
    expect(stripDevicePrefix('\\\\?\\UNC\\srv\\share\\a')).toBe('\\\\srv\\share\\a')
    expect(stripDevicePrefix('C:\\a\\b')).toBe('C:\\a\\b')
  })

  it('盘符大小写归一(win32)', () => {
    if (!IS_WIN) return
    const lower = 'c:\\'
    const c = canonicalizePath(lower)
    expect(c.startsWith('C:')).toBe(true)
  })

  it('junction/symlink 别名解析到真实目标', () => {
    const base = mkDir('webnovel-can-alias-')
    const realDir = path.join(base, '真实目录')
    fs.mkdirSync(realDir, { recursive: true })
    const linkPath = path.join(base, '别名目录')
    try {
      fs.symlinkSync(realDir, linkPath, IS_WIN ? 'junction' : 'dir')
    } catch {
      // 环境不支持符号链接:跳过本例(权限不足的 CI 等)
      return
    }
    const c = canonicalizePath(path.join(linkPath, '子文件.md'))
    expect(c.startsWith(canonicalizePath(realDir))).toBe(true)
    expect(c.includes('别名目录')).toBe(false)
  })
})

describe('isInsidePath', () => {
  it('严格内含判成立,根自身不算内含,外部位拒', () => {
    const base = mkDir('webnovel-can-inside-')
    const child = path.join(base, '子')
    fs.mkdirSync(child, { recursive: true })
    expect(isInsidePath(base, child)).toBe(true)
    expect(isInsidePath(base, path.join(child, '再深', 'x.md'))).toBe(true)
    expect(isInsidePath(base, base)).toBe(false)
    expect(isInsidePath(base, path.dirname(base))).toBe(false)
  })

  it('别名路径(child)仍判内含——修复前 junction 别名误判逃逸', () => {
    const base = mkDir('webnovel-can-gate-')
    const realDir = path.join(base, '书仓')
    fs.mkdirSync(path.join(realDir, '草稿区'), { recursive: true })
    const alias = path.join(base, '书仓别名')
    try {
      fs.symlinkSync(realDir, alias, IS_WIN ? 'junction' : 'dir')
    } catch {
      return
    }
    expect(isInsidePath(realDir, path.join(alias, '草稿区', '稿.md'))).toBe(true)
    // resolveInsideBook 同口径放行(修复前误判「路径逃逸书仓根」)
    const r = resolveInsideBook(realDir, path.join(alias, '草稿区', '稿.md'))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.relPath.replace(/\\/g, '/')).toBe('草稿区/稿.md')
  })

  it('盘符大小写与 \\\\?\\ 形态不影响 membership(win32)', () => {
    if (!IS_WIN) return
    const base = mkDir('webnovel-can-drive-')
    const child = path.join(base, '子')
    fs.mkdirSync(child, { recursive: true })
    const drive = child.slice(0, 1)
    expect(isInsidePath(base, `${drive.toLowerCase()}${child.slice(1)}`)).toBe(true)
    expect(isInsidePath(base, `\\\\?\\${child}`)).toBe(true)
  })

  it('resolveInsideBook:真逃逸仍拒', () => {
    const base = mkDir('webnovel-can-esc-')
    const book = path.join(base, '书仓')
    fs.mkdirSync(book, { recursive: true })
    expect(resolveInsideBook(book, path.join(base, '外面.md')).ok).toBe(false)
    expect(resolveInsideBook(book, path.join(book, '..', '逃逸.md')).ok).toBe(false)
    expect(resolveInsideBook(book, book).ok).toBe(false)
  })
})
