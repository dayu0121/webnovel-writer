/**
 * 路径 canonicalization 与工作范围 membership（dsh 运行时对齐批，2026-09-06）。
 *
 * 背景：rc.1 宿主对路径只做 `isAbsolute` 校验，全宿主无 realpath/大小写归一/
 * 长路径前缀处理；插件侧 `agentWorkspaceRoot`（会话 cwd）与门禁 membership
 * 判定原先都是裸 `path.resolve`+`relative` 字符串比较——Windows 下盘符大小写
 * （`d:\` vs `D:\`）、junction/symlink 别名、`\\?\` 长路径形态会让同一物理目录
 * 判成不同路径：门禁误报「路径逃逸书仓根」、书解析不到书仓。
 *
 * 纪律：现算不缓存（D1）——每次调用都做真实 IO probe，调用频率为门禁级（低），
 * 不引入失效难题。realpath 用 `realpathSync.native`（返回文件系统真名，含真
 * 大小写并解 junction/symlink）；目标不存在时取最长存在祖先再拼回尾段
 * （草稿目录常先于目录存在被引用）。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

/** 判断是否 Windows 运行形态（盘符大小写与 `\\?\` 前缀只在此有意义）。 */
function isWin32(): boolean {
  return process.platform === 'win32'
}

/** Whether a session/workspace root names a fixed host location. */
export function isFullyQualifiedPath(p: string): boolean {
  const value = stripDevicePrefix(p)
  if (!isWin32()) return path.posix.isAbsolute(value)
  const root = path.win32.parse(value).root
  return path.win32.isAbsolute(value) && root !== '\\' && root !== '/'
}

/**
 * 剥 Windows 长路径/UNC 设备前缀，输出普通形态：
 * `\\?\C:\a` → `C:\a`；`\\?\UNC\srv\share\a` → `\\srv\share\a`。
 * 非 win32 或无前缀原样返回。
 */
export function stripDevicePrefix(p: string): string {
  if (!isWin32() || !p.startsWith('\\\\?\\')) return p
  if (p.startsWith('\\\\?\\UNC\\')) return `\\\\${p.slice('\\\\?\\UNC\\'.length)}`
  return p.slice('\\\\?\\'.length)
}

/**
 * realpath 最长存在祖先：从整条路径向上逐级 probe，第一个存在的真实路径
 * 拼上尚未存在的尾段。路径必然在文件系统根处终止，循环必收束。
 */
function realpathDeepest(p: string): string {
  let current = p
  const tail: string[] = []
  for (;;) {
    try {
      const real = stripDevicePrefix(fs.realpathSync.native(current))
      return tail.length === 0 ? real : `${real}${path.sep}${tail.join(path.sep)}`
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return stripDevicePrefix(current)
      tail.unshift(path.basename(current))
      current = parent
    }
  }
}

/**
 * fully-qualified canonical 路径：resolve 绝对化 → 剥设备前缀 →
 * 最长存在祖先 realpath（真大小写＋解别名）→ Windows 盘符大写。
 * 输入可以是相对路径（按进程 cwd 解）、别名路径（junction/symlink）、
 * `\\?\` 形态；输出统一为可直接字符串比较的形态。
 */
export function canonicalizePath(p: string): string {
  if (typeof p !== 'string' || p === '') return ''
  let resolved = path.resolve(p)
  // 先剥前缀再 probe：node 的 win32 解析对 `\\?\` 路径跳过规范化（`.`/`..` 不消解）
  resolved = stripDevicePrefix(resolved)
  const real = realpathDeepest(resolved)
  if (!isWin32()) return real
  const driveMatch = /^([a-zA-Z]):/.exec(real)
  if (driveMatch === null) return real
  return `${driveMatch[1]!.toUpperCase()}${real.slice(1)}`
}

/**
 * membership 判定（canonical 化后比较）：target 严格位于 root 内
 * （root 本身不算 inside——书仓根不是书仓内的可写目标）。
 */
export function isInsidePath(rootAbs: string, targetAbs: string): boolean {
  const root = canonicalizePath(rootAbs)
  const target = canonicalizePath(targetAbs)
  if (root === '' || target === '') return false
  const rel = path.relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}
