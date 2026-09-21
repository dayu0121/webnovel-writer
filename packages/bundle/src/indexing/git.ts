import * as path from 'node:path'
import { execFile } from 'node:child_process'

async function git(root: string, args: string[]): Promise<string | undefined> {
  return new Promise(resolve => execFile('git', ['--literal-pathspecs', '-C', root, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024,
  }, (error, stdout) => resolve(error ? undefined : stdout)))
}

export async function bookHead(root: string): Promise<string | undefined> {
  const value = (await git(root, ['rev-parse', '--verify', 'HEAD']))?.trim()
  return value && /^[a-f0-9]{40,64}$/.test(value) ? value : undefined
}

export async function finalizedChanged(root: string, from: string | undefined, to: string | undefined): Promise<boolean> {
  if (!from || !to) return true
  if (from === to) return false
  const changed = await git(root, ['diff', '--name-only', '-z', from, to, '--', '定稿'])
  return changed === undefined || changed.length > 0
}

/** Watch Git's own resolved metadata paths, including linked worktree/common refs. */
export async function bookGitWatchPaths(root: string): Promise<string[]> {
  const directories = await Promise.all([
    git(root, ['rev-parse', '--absolute-git-dir']),
    git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
  ])
  return [...new Set(directories.filter((value): value is string => !!value?.trim()).flatMap(value => {
    const directory = path.resolve(root, value.trim())
    return [directory, path.join(directory, 'refs')]
  }))]
}
