/**
 * 当前书路径解析(PRD §4.7 / plugin-spec §12)。
 *
 * 工具面不收裸相对路径——只收:
 *   1) `书id:仓内相对路径` 复合(书id 显式标示)
 *   2) 绝对路径(是否落在书仓内/分区由路径门禁 gateFileAccess 判定)
 * 模型给裸相对路径(无书标识)时拒绝并报错,不猜。
 */

import * as path from 'node:path'

export type ResolveTarget =
  | { readonly kind: 'absolute'; readonly abs: string }
  | { readonly kind: 'book-relative'; readonly bookId: string; readonly rel: string }
  | { readonly kind: 'bare-relative'; readonly detail: string }

/** 解析输入:绝对路径 / 书id:相对路径 / 裸相对路径(拒绝)。 */
export function parseBookPathInput(input: string): ResolveTarget {
  if (path.isAbsolute(input)) return { kind: 'absolute', abs: input }
  const idx = input.indexOf(':')
  if (idx > 0) {
    const bookId = input.slice(0, idx)
    const rel = input.slice(idx + 1)
    if (bookId !== '' && rel !== '') return { kind: 'book-relative', bookId, rel }
  }
  return { kind: 'bare-relative', detail: '裸相对路径拒绝:请携带 书id:仓内相对路径 或绝对路径(PRD §4.7)' }
}

/** 子路径判定(immutable,防 ../ 逃逸)。 */
function isSubOf(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * 解析目标输入为仓内绝对路径。
 * - book-relative:root=rootOfBook(bookId),join 后必须仍在书仓内,否则拒绝(逃逸)
 * - absolute:直接返回(门禁再判分区)
 */
export function resolveToBookPath(
  rootOfBook: (bookId: string) => string | undefined,
  input: string,
): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string } {
  const target = parseBookPathInput(input)
  if (target.kind === 'bare-relative') return { ok: false, reason: target.detail }
  if (target.kind === 'absolute') return { ok: true, path: target.abs }
  const bookRoot = rootOfBook(target.bookId)
  if (bookRoot === undefined) return { ok: false, reason: `未知书目:${target.bookId}(书id 须已在书架扫描中发现)` }
  const abs = path.resolve(bookRoot, target.rel)
  if (!isSubOf(bookRoot, abs)) return { ok: false, reason: '路径逃逸书仓根,拒绝(不变量 4)' }
  return { ok: true, path: abs }
}
