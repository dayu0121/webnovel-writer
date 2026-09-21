import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

export const baseline = JSON.parse(fs.readFileSync(new URL('../../../dsh-baseline.json', import.meta.url), 'utf8'))

function directories(root) {
  return fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => path.join(root, item.name))
}

/** 固定官方 commit 的已构建 checkout；不改源码或安装状态。 */
export function loadSourceHost(input) {
  const root = fs.realpathSync.native(path.resolve(input))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  const commit = git('rev-parse', 'HEAD')
  if (commit !== baseline.source.commit) throw new Error(`DSH source must be ${baseline.source.tag} (${baseline.source.commit}); found ${commit}`)
  if (git('status', '--porcelain', '--untracked-files=no') !== '') throw new Error('DSH source has tracked changes; use the unmodified baseline checkout')
  const packages = new Map()
  const candidates = [
    ...directories(path.join(root, 'vendor')),
    ...directories(path.join(root, 'packages')).flatMap(directories),
    ...directories(path.join(root, 'apps')),
  ]
  for (const directory of candidates) {
    const file = path.join(directory, 'package.json')
    if (!fs.existsSync(file)) continue
    const metadata = JSON.parse(fs.readFileSync(file, 'utf8'))
    packages.set(metadata.name, { directory, metadata })
  }
  const get = name => {
    const pkg = packages.get(name)
    if (pkg === undefined) throw new Error(`DSH source package missing: ${name}`)
    if (name.startsWith('@deepseek-ai/dsh') && pkg.metadata.version !== baseline.source.version) throw new Error(`DSH package version mismatch: ${name}`)
    return pkg
  }
  const entry = name => {
    const pkg = get(name)
    if (typeof pkg.metadata.main !== 'string') throw new Error(`DSH package has no main entry: ${name}`)
    const file = path.resolve(pkg.directory, pkg.metadata.main)
    if (!fs.existsSync(file)) throw new Error(`DSH build missing: ${file}; run npm run build:lib:host in the checkout`)
    return file
  }
  const typePaths = {}
  for (const [name, pkg] of packages) {
    if (typeof pkg.metadata.types === 'string') {
      const file = path.resolve(pkg.directory, pkg.metadata.types)
      if (fs.existsSync(file)) typePaths[name] = [file]
    }
    for (const [subpath, definition] of Object.entries(pkg.metadata.exports ?? {})) {
      if (!subpath.startsWith('.') || typeof definition?.types !== 'string') continue
      const file = path.resolve(pkg.directory, definition.types)
      if (fs.existsSync(file)) typePaths[subpath === '.' ? name : name + subpath.slice(1)] = [file]
    }
  }
  return { root, commit, get, entry, typePaths, version: baseline.source.version }
}
