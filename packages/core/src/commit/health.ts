/**
 * git 健康检查(机制 B6):作者不直面 git 报错。M0 检测进行中合并/变基与 index 锁。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

export type GitHealth =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

function exists(p: string): boolean {
  try { return fs.existsSync(p) } catch { return false }
}

/**
 * 解析书仓根的 gitdir。
 * 常规仓库里 `<根>/.git` 是目录;worktree 里它是一个写着 `gitdir: <路径>` 的文件,
 * 进行中状态(MERGE_HEAD 等)存在该指针目录内而非根下的 `.git`。
 * 不区分二者会让下面三项检查全部查不到文件,在最该拦的时候返回 ok。
 */
function resolveGitDir(root: string): string | undefined {
  const dotGit = path.join(root, '.git')
  let stat: fs.Stats
  try { stat = fs.statSync(dotGit) } catch { return undefined }
  if (stat.isDirectory()) return dotGit
  if (!stat.isFile()) return undefined
  let text: string
  try { text = fs.readFileSync(dotGit, 'utf-8') } catch { return undefined }
  const pointer = /^\s*gitdir:\s*(.+?)\s*$/m.exec(text)?.[1]
  if (pointer === undefined || pointer === '') return undefined
  // 指针可为相对路径,按书仓根解析。
  const resolved = path.isAbsolute(pointer) ? pointer : path.resolve(root, pointer)
  return exists(resolved) ? resolved : undefined
}

/** 书仓根必须是 git 仓库;进行中操作或锁一律拒绝。 */
export function checkGitHealth(bookRoot: string): GitHealth {
  const root = path.resolve(bookRoot)
  if (/OneDrive|坚果云/i.test(root)) {
    return { ok: false, reason: '书仓位于网盘同步目录,拒绝提交(B6)' }
  }
  const gitDir = resolveGitDir(root)
  if (gitDir === undefined) return { ok: false, reason: '书仓尚未初始化版本库,无法提交(B6)' }
  if (exists(path.join(gitDir, 'MERGE_HEAD'))) return { ok: false, reason: '正在合并,拒绝提交以免半提交(B6)' }
  if (exists(path.join(gitDir, 'rebase-merge')) || exists(path.join(gitDir, 'rebase-apply'))) {
    return { ok: false, reason: '正在变基,拒绝提交以免半提交(B6)' }
  }
  if (exists(path.join(gitDir, 'index.lock'))) return { ok: false, reason: '版本库锁定中,拒绝提交(B6)' }
  return { ok: true }
}
