/**
 * 单文件原子替换与多文件可恢复批次(机制 B1)。
 *
 * - 路径校验(与 B2 衔接):拒绝绝对路径与 `..` 段,不越书仓根
 * - 三段式:全部写临时文件 → 备份既有目标 → 统一改名落位
 * - 回滚前检查整批旧/新指纹；外部修改冲突保留备份并拒绝继续
 * - 临时文件建在**目标文件所在目录**(F6,2026-09-05):renameSync 只在同一文件系统内
 *   原子生效——系统临时目录(C 盘)与书仓(D 盘)跨盘时 rename 会抛 EXDEV;同目录建
 *   临时文件天然同盘,异常回滚与残留清理也作用于同一目录。
 */

import * as path from 'node:path'
import { withBookLock, withBookLockAsync } from './lock'
import { recoverTransactions, runTransaction, type OperationProvenance } from './transaction'

export interface FileOp {
  readonly relPath: string
  readonly content: string
}

export interface AtomicWriteOptions {
  readonly provenance?: OperationProvenance
}

function assertRelPath(relPath: string): void {
  if (path.isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) {
    throw new Error(`原子写拒绝绝对路径:「${relPath}」(B1/B2)`)
  }
  const segments = relPath.split(/[\\/]/)
  if (segments.includes('..')) {
    throw new Error(`原子写拒绝路径穿越:「${relPath}」(B1/B2)`)
  }
}

/** Acquire the write boundary and recover interrupted work before any reads. */
export function withBookWrite<T>(root: string, operation: () => T, provenance?: OperationProvenance): T {
  return withBookLock(root, () => {
    recoverTransactions(root)
    return operation()
  }, provenance)
}

export function withBookWriteAsync<T>(root: string, operation: () => Promise<T>, provenance?: OperationProvenance): Promise<T> {
  return withBookLockAsync(root, async () => {
    recoverTransactions(root)
    return operation()
  }, provenance)
}

/** Share the same boundary across synchronous domain writers without changing their signatures. */
export function bookWriter<Args extends unknown[], Result>(
  writer: (root: string, ...args: Args) => Result,
): (root: string, ...args: Args) => Result {
  return (root, ...args) => withBookWrite(root, () => writer(root, ...args))
}

/** Batch replacement with crash recovery; conflicts retain their recovery evidence. */
export function writeBatchAtomic(root: string, ops: readonly FileOp[], options: AtomicWriteOptions = {}): void {
  for (const op of ops) assertRelPath(op.relPath)
  if (ops.length === 0) return
  withBookLock(root, () => {
    recoverTransactions(root)
    try {
      runTransaction(root, ops, options)
    } catch (err) {
      throw new Error(`原子写失败(B1):${String(err)}`)
    }
  }, options.provenance === undefined
    ? { targets: ops.map((op) => op.relPath) }
    : { ...options.provenance, targets: ops.map((op) => op.relPath) })
}

/** 单文件原子写(批量写之特例)。 */
export function writeFileAtomic(root: string, relPath: string, content: string, options: AtomicWriteOptions = {}): void {
  writeBatchAtomic(root, [{ relPath, content }], options)
}
