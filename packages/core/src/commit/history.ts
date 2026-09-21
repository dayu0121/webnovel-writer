/**
 * 「某工件最近一次提交」查询(拍板 3:git log 双轨的专用工具主路;供进度卡消费)。
 * 类型级区分「从未提交」(never)与「查询失败」(error),不返回空成功(机制 B4)。
 * 章号解析:优先 Header Scope `design(chNNNN):`;次选提交变更文件里的定稿章路径;仍无则 null。
 */

import { spawnSync } from 'node:child_process'

export interface LastCommitChapter {
  /** 定稿章路径可得卷号;Scope 只有全书连续章号,卷未知为 null。 */
  readonly 卷: number | null
  readonly 章: number
}

export type LastCommitResult =
  | {
      readonly ok: true
      /** 原样保留 Header 首段,如 `design(ch0012)`、`ch`;展示用。 */
      readonly prefix: string
      readonly summary: string
      readonly hash: string
      readonly chapter: LastCommitChapter | null
    }
  | { readonly ok: false; readonly kind: 'never' | 'error'; readonly detail: string }

const SCOPE章 = /^design\(ch(\d+)\):/
const 定稿章 = /^定稿\/卷(\d+)\/(\d{4})-/

function runGit(bookRoot: string, args: readonly string[]): { readonly status: number; readonly stderr: string; readonly stdout: string } {
  // core.quotepath=false:中文路径不转义,否则章号解析与路径比对全部失配。
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: bookRoot, encoding: 'utf-8', windowsHide: true })
  if (r.error) return { status: 1, stderr: r.error.message, stdout: '' }
  return { status: r.status ?? 1, stderr: r.stderr ?? '', stdout: r.stdout ?? '' }
}

function chapterFrom(subject: string, files: readonly string[]): LastCommitChapter | null {
  const scope = SCOPE章.exec(subject)
  if (scope !== null) return { 卷: null, 章: Number(scope[1]) }
  for (const f of files) {
    const m = 定稿章.exec(f)
    if (m !== null) return { 卷: Number(m[1]), 章: Number(m[2]) }
  }
  return null
}

export function lastCommitOf(bookRoot: string, relPath: string): LastCommitResult {
  const log = runGit(bookRoot, ['log', '-1', '--format=%H%x1f%s', '--', relPath])
  if (log.status !== 0) {
    const stderr = log.stderr.trim()
    if (/does not have any commits yet|还没有任何提交/.test(stderr)) {
      return { ok: false, kind: 'never', detail: '书仓尚无任何提交' }
    }
    return { ok: false, kind: 'error', detail: stderr || 'git log 失败' }
  }
  const line = log.stdout.trim()
  if (line === '') return { ok: false, kind: 'never', detail: `「${relPath}」从未提交` }

  const [hash, subject] = line.split('\x1f')
  if (hash === undefined || subject === undefined) {
    return { ok: false, kind: 'error', detail: 'git log 输出无法解析' }
  }

  const show = runGit(bookRoot, ['show', '--name-only', '--pretty=format:', hash])
  const files = show.status === 0 ? show.stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '') : []

  const head = subject.indexOf(': ')
  const prefix = head === -1 ? subject : subject.slice(0, head)
  const summary = head === -1 ? subject : subject.slice(head + 2)

  return { ok: true, prefix, summary, hash, chapter: chapterFrom(subject, files) }
}
