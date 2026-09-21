/**
 * 设计侧确认提交(拍板 1/7:提交点跟随作者确认;裁决点仍只有定稿入档与吃书补偿)。
 *
 * 写入器(writeContract / confirmOutline / seedMinDesign 等)只写文件、不碰 git;
 * 「作者已确认」这个事实只有工具层知道,故提交发生在工具层确认动作里,经本通道执行。
 *
 * 幂等可重放(拍板 2):真源已落位、候选已删时重跑确认工具＝只补提交,不重写文件——
 * 文件与 HEAD 有差异则 add 后正常提交;完全一致(上一次已提交成功)则无改动、不空提交。
 * 提案批次粒度(拍板 7):paths 接收整批整改文件(上游工件＋受影响未定稿下游),一次确认一次提交。
 */

import * as path from 'node:path'
import { checkGitHealth } from './health'
import { formatCommitMessage } from './message'
import { checkCommitPath } from './paths'
import { commitWithIsolatedIndex } from './git'
import { withBookLock } from '../repo/lock'
import { recoverTransactions } from '../repo/transaction'
import type { OperationProvenance } from '../repo/transaction'

export interface CommitConfirmedOptions {
  readonly bookRoot: string
  /** 整批整改文件(书仓相对路径);逐条过路径白名单,任一不过即整体拒绝。 */
  readonly paths: readonly string[]
  /** 设计侧确认＝design;作者手改真源规范＝fix。 */
  readonly prefix: 'design' | 'fix'
  readonly summary: string
  /** 活跃章号(章号全书连续);无活跃章则不携带 Scope。 */
  readonly chapterScope?: number
  readonly lines?: readonly string[]
  readonly provenance?: OperationProvenance
}

export type CommitConfirmedResult =
  | { readonly ok: true; readonly message: string; readonly dests: readonly string[]; readonly noChanges?: boolean }
  | { readonly ok: false; readonly reason: string }

export function commitConfirmed(opts: CommitConfirmedOptions): CommitConfirmedResult {
  return withBookLock(opts.bookRoot, () => {
    recoverTransactions(opts.bookRoot)
    return commitConfirmedLocked(opts)
  }, opts.provenance === undefined ? { targets: opts.paths } : { ...opts.provenance, targets: opts.paths })
}

function commitConfirmedLocked(opts: CommitConfirmedOptions): CommitConfirmedResult {
  if (opts.paths.length === 0) return { ok: false, reason: '提交清单为空,拒绝' }

  const dests: string[] = []
  for (const target of opts.paths) {
    const check = checkCommitPath(opts.bookRoot, target)
    if (!check.ok) return check
    if (!dests.includes(check.relPath)) dests.push(check.relPath)
  }

  const health = checkGitHealth(opts.bookRoot)
  if (!health.ok) return health

  // 文件已由写入器落盘;这里只做 add→commit,不做清单读取与 sha256 校验,
  // 也不做「目标已存在即拒绝」(设计侧是覆盖式写入)。
  const message = formatCommitMessage({
    prefix: opts.prefix,
    summary: opts.summary,
    lines: opts.lines,
    chapterScope: opts.chapterScope,
  })
  const commit = commitWithIsolatedIndex(opts.bookRoot, dests, message)
  if (commit.noChanges) {
    return { ok: true, message: '无改动,未产生提交', dests, noChanges: true }
  }
  if (commit.status !== 0) {
    return { ok: false, reason: `文件已写入但提交失败,未形成提交:${commit.stderr.trim() || 'git commit 失败'}` }
  }
  return { ok: true, message, dests }
}

/** 把书仓相对路径规范为 posix(与 paths 模块同形);供工具层组装 paths 用。 */
export function toBookRelPath(bookRoot: string, target: string): string {
  return path.relative(path.resolve(bookRoot), path.resolve(bookRoot, target)).split(path.sep).join('/')
}
