import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseDocument } from '../repo/frontmatter'
import { writeBatchAtomic } from '../repo/atomic'
import { checkGitHealth } from '../commit/health'
import { commitWithIsolatedIndex } from '../commit/git'
import { formatCommitMessage } from '../commit/message'
import { shortStoryHash } from './hash'
import { readShortStoryManifest } from './drafts'
import { shortStoryPaths, validateShortStoryTitle } from './paths'

export interface ShortStoryExportFile {
  readonly name: string
  readonly content: string
}

export type ShortStoryExportResult =
  | {
      readonly ok: true
      readonly title: string
      readonly finalRelPath: string
      readonly finalHash: string
      readonly markdown: string
      readonly text: string
      readonly files: readonly ShortStoryExportFile[]
    }
  | { readonly ok: false; readonly reason: string }

export type WriteShortStoryExportResult =
  | { readonly ok: true; readonly targetDir: string; readonly files: readonly ShortStoryExportFile[]; readonly changed: boolean; readonly recordHash: string }
  | { readonly ok: false; readonly reason: string; readonly written?: boolean }

function safeStem(title: string): string {
  try { validateShortStoryTitle(title); return title } catch { return '短故事' }
}

export function computeShortStoryExport(root: string, storyId: string): ShortStoryExportResult {
  try {
    const manifest = readShortStoryManifest(root, storyId)
    const dir = path.join(root, shortStoryPaths.finalDir())
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => /^r\d+\.md$/.test(name)).sort() : []
    const name = names.at(-1)
    if (name === undefined) return { ok: false, reason: '没有可导出的短故事定稿' }
    const relPath = path.posix.join(shortStoryPaths.finalDir(), name)
    const text = fs.readFileSync(path.join(root, relPath), 'utf8')
    const parsed = parseDocument(text)
    if (!parsed.ok) return { ok: false, reason: `短故事定稿解析失败:${parsed.detail}` }
    if (parsed.data.fields['故事id'] !== storyId || parsed.data.fields['状态'] !== '已定稿') return { ok: false, reason: '短故事定稿身份或状态非法' }
    const body = parsed.data.body.replace(/\r\n/g, '\n').replace(/\s+$/u, '').trim()
    const stem = safeStem(manifest.title)
    const markdown = `# ${manifest.title}\n\n${body}\n`
    const textOnly = `${manifest.title}\n\n${body}\n`
    return {
      ok: true,
      title: manifest.title,
      finalRelPath: relPath,
      finalHash: shortStoryHash(body),
      markdown,
      text: textOnly,
      files: [
        { name: `${stem}-定稿.md`, content: markdown },
        { name: `${stem}-定稿.txt`, content: textOnly },
      ],
    }
  } catch (error) {
    return { ok: false, reason: String(error) }
  }
}

function sameFile(target: string, content: string): boolean {
  try { return fs.readFileSync(target, 'utf8') === content } catch { return false }
}

export function writeShortStoryExport(root: string, storyId: string, targetDirInput: string, expectedFinalHash: string): WriteShortStoryExportResult {
  const computed = computeShortStoryExport(root, storyId)
  if (!computed.ok) return computed
  if (expectedFinalHash !== computed.finalHash) return { ok: false, reason: '定稿 hash 与作者批准不一致' }
  if (!path.isAbsolute(targetDirInput)) return { ok: false, reason: '导出目录必须是绝对路径' }
  const targetDir = path.resolve(targetDirInput)
  try {
    fs.mkdirSync(targetDir, { recursive: true })
    const pending: ShortStoryExportFile[] = []
    for (const file of computed.files) {
      const target = path.join(targetDir, file.name)
      if (fs.existsSync(target)) {
        if (!sameFile(target, file.content)) return { ok: false, reason: `导出目标存在不同内容，拒绝覆盖:${file.name}` }
      } else {
        pending.push(file)
      }
    }
    if (pending.length === 0) {
      const recordPath = path.join(root, shortStoryPaths.exportRecord())
      const recordHash = fs.existsSync(recordPath) ? shortStoryHash(fs.readFileSync(recordPath, 'utf8')) : ''
      return { ok: true, targetDir, files: computed.files, changed: false, recordHash }
    }

    const staging = fs.mkdtempSync(path.join(targetDir, '.story-export-'))
    const created: string[] = []
    try {
      for (const file of pending) fs.writeFileSync(path.join(staging, file.name), file.content, { encoding: 'utf8', flag: 'wx' })
      for (const file of pending) {
        const target = path.join(targetDir, file.name)
        if (fs.existsSync(target)) throw new Error(`导出冲突在落盘期间出现:${file.name}`)
        fs.renameSync(path.join(staging, file.name), target)
        created.push(target)
      }
    } catch (error) {
      for (const target of created) { try { fs.rmSync(target, { force: true }) } catch { /* best effort */ } }
      throw error
    } finally {
      fs.rmSync(staging, { recursive: true, force: true })
    }
    for (const file of computed.files) {
      if (!sameFile(path.join(targetDir, file.name), file.content)) return { ok: false, reason: `导出后读回不一致:${file.name}`, written: true }
    }
    const record = `${JSON.stringify({
      schemaVersion: 1,
      kind: 'short-story-export',
      storyId,
      targetDir,
      finalRelPath: computed.finalRelPath,
      finalHash: computed.finalHash,
      files: computed.files.map(file => ({ name: file.name, hash: shortStoryHash(file.content) })),
    }, null, 2)}\n`
    writeBatchAtomic(root, [{ relPath: shortStoryPaths.exportRecord(), content: record }])
    const health = checkGitHealth(root)
    if (!health.ok) return { ok: false, reason: health.reason, written: true }
    const message = formatCommitMessage({ prefix: 'story', summary: `记录短故事导出 ${path.basename(targetDir)}` })
    const committed = commitWithIsolatedIndex(root, [shortStoryPaths.exportRecord()], message)
    if (committed.status !== 0 && !committed.noChanges) return { ok: false, reason: `导出已写入但记录提交失败:${committed.stderr.trim()}`, written: true }
    return { ok: true, targetDir, files: computed.files, changed: true, recordHash: shortStoryHash(record) }
  } catch (error) {
    return { ok: false, reason: String(error) }
  }
}
