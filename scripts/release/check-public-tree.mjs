import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const rootFiles = new Set(['.gitattributes', '.gitignore', '.npmrc', '.node-version', 'LICENSE', 'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'dsh-baseline.json', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'vitest.config.ts', 'eslint.config.mjs'])
export function checkPublicPath(file) {
  assert.ok(!file.includes('\\') && !file.includes(':') && !file.startsWith('/') && !file.split('/').includes('..'), `Unsafe public path: ${file}`)
  assert.ok(rootFiles.has(file) || /^(packages|scripts\/release|docs\/(user|maintenance)|examples|\.github)\//.test(file)
    || /^docs\/(development|book-format)\.md$/.test(file) || /^scripts\/(benchmark-(derive|impact|search)|strip-types-loader)\.mjs$/.test(file), `File outside public allowlist: ${file}`)
  assert.ok(!/(^|\/)(\.trellis|\.credentials[^/]*|session[^/]*\.jsonl|node_modules|\.env(?:\..*)?|\.webnovel)(\/|$)/.test(file), `Private content path: ${file}`)
  assert.notEqual(file, 'packages/bundle/dsh-local.yml', 'Local instance config is private')
}
export function checkPublicText(file, data) {
  const text = data.toString('utf8')
  assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{30,}/.test(text), `Possible credential in ${file}; value withheld`)
  assert.ok(!/[A-Z]:[\\/](?:Users|wk)[\\/]/.test(text), `Personal absolute path in ${file}`)
}
export function checkMarkdownLinks(root, file, text) {
  const prose = text.replace(/```[\s\S]*?```/g, '')
  for (const match of prose.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').split('#')[0]
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    const resolved = path.resolve(path.dirname(path.join(root, file)), decodeURIComponent(target))
    assert.ok(resolved === root || resolved.startsWith(root + path.sep), `Link escapes public root: ${file}`)
    assert.ok(fs.existsSync(resolved), `Broken public link in ${file}: ${target}`)
  }
}

export function checkTree(root, history = true) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  const files = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))]
  for (const file of files) {
    checkPublicPath(file)
    assert.ok(!fs.lstatSync(path.join(root, file)).isSymbolicLink(), `Public symlink: ${file}`)
    const data = fs.readFileSync(path.join(root, file))
    checkPublicText(file, data)
    if (file.endsWith('.md')) checkMarkdownLinks(root, file, data.toString('utf8'))
  }
  let commits = 0
  if (history) {
    const revisions = git(['rev-list', 'HEAD']).trim().split('\n').filter(Boolean)
    const checked = new Set()
    for (const revision of revisions) {
      commits++
      for (const line of git(['ls-tree', '-rz', revision]).split('\0').filter(Boolean)) {
        const [meta, file] = line.split('\t')
        const [mode, kind, oid] = meta.split(' ')
        checkPublicPath(file)
        assert.ok(kind === 'blob' && ['100644', '100755'].includes(mode), `Non-regular history entry: ${file}`)
        if (!checked.has(oid)) {
          checkPublicText(file, git(['cat-file', 'blob', oid]))
          checked.add(oid)
        }
      }
    }
  }
  return { ok: true, files: files.length, commits }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
  console.log(JSON.stringify(checkTree(root, !process.argv.includes('--no-history'))))
}
