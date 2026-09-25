import * as fs from 'node:fs'
import * as path from 'node:path'
import { diffLines } from 'diff'
import {
  AuthorDocumentError, authorDocumentPath, authorReadOnlyReason, documentHash, saveAuthorDocument, readAuthorSave,
  parseDocument, listChapters, scanChapter, deriveChapterFacts, paths, retryAuthorSaveCommit, withBookWrite,
  canonicalizePath, isFullyQualifiedPath, findPendingReviewDraft, listShortStories, deriveShortStoryState,
  type OperationProvenance, type AuthorSaveResult,
} from '@webnovel/core'
import { scanBooks } from '../bookshelf'
import { progressLineOf } from '../status-context'
import type { ChapterView, FileRef, StudyBook, StudyDocument, StudySave, StudyShelf, TreeEntry } from './types'
import type { IndexBook } from '../indexing/manager'
import { readStoryGraph } from './graph'

const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024
const ROOT_ORDER = ['作品卡.md', '蓝图', '正文', '检查', '作品契约', '构想', '大纲', '世界书', '定稿', '账本', '本书记忆', '草稿区']

export function routeForDocument(ref: FileRef): string {
  if (ref.space === 'shared') return '共享资料更新：只处理相关构想、灵感或作者记忆，不默认复审所有书'
  if (ref.space.startsWith('story:')) {
    if (ref.path.startsWith('正文/草稿/')) return '短故事作者改稿：校准整篇审读状态并保留作者原文'
    if (ref.path.startsWith('检查/')) return '短故事审读与交付检查：按当前 hash 校准，不直接手改过程记录'
    return '短故事策划：核对故事卡、蓝图和全篇生产状态'
  }
  if (/^草稿区\/草稿\//.test(ref.path)) return '作者改稿：校准章节状态，保留作者原文，复审受影响项'
  if (/章细纲/.test(ref.path)) return '细纲与备料：核对变更和下游材料影响'
  if (/^(大纲|世界书|作品契约)\//.test(ref.path)) return '定调设计：先分析影响，再处理相关设计与未定稿章节'
  if (/^定稿\//.test(ref.path)) return '定稿更正：进入吃书补偿，不直接覆盖定稿'
  if (/^账本\//.test(ref.path)) return '账本与时序核对：检查事实一致性和受影响章节'
  return '校准作品现状，再按修改内容选择对应节点'
}

function textOf(target: string): string {
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new AuthorDocumentError('not-found', '文件不存在')
  if (fs.statSync(target).size > MAX_DOCUMENT_BYTES) throw new AuthorDocumentError('read-only', '文件超过 4 MiB，不能在编辑器中打开；内容未截断')
  const bytes = fs.readFileSync(target)
  if (bytes.includes(0)) throw new AuthorDocumentError('read-only', '该文件不是文本文件')
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch {
    throw new AuthorDocumentError('read-only', '只支持 UTF-8 文档')
  }
}

function fieldLabel(text: string): { badge?: string; version: string | number | null } {
  const parsed = parseDocument(text)
  if (!parsed.ok) return { badge: '格式异常', version: null }
  const fields = parsed.data.fields
  const badge = fields['角色'] === '待审稿' ? '待审稿'
    : typeof fields['状态'] === 'string' ? fields['状态']
      : fields['生成模块'] === '作者手改' ? '作者手改' : undefined
  const version = typeof fields['版本'] === 'number' || typeof fields['版本'] === 'string' ? fields['版本'] : null
  return { badge, version }
}

export class StudyService {
  readonly workspace: string
  constructor(workspace: string) {
    if (!isFullyQualifiedPath(workspace)) throw new AuthorDocumentError('invalid-path', '工作范围必须是绝对路径')
    this.workspace = canonicalizePath(workspace)
    if (!fs.existsSync(this.workspace) || !fs.statSync(this.workspace).isDirectory()) throw new AuthorDocumentError('not-found', '工作范围目录不存在')
  }

  private source(space: string): { root: string; owner: string; kind: 'shared' | 'book' | 'story'; bookId?: string; storyId?: string } {
    if (space === 'shared') {
      const root = authorDocumentPath(this.workspace, '书房')
      if (!fs.existsSync(root)) throw new AuthorDocumentError('not-found', '当前工作范围尚无共享资料')
      return { root, owner: '共享资料', kind: 'shared' }
    }
    if (space.startsWith('story:')) {
      const storyId = space.slice('story:'.length)
      const stories = listShortStories(this.workspace).filter(story => story.storyId === storyId)
      if (stories.length !== 1) throw new AuthorDocumentError('not-found', '短故事不存在或故事 id 不唯一')
      const story = stories[0]!
      const root = authorDocumentPath(this.workspace, path.relative(this.workspace, story.root))
      return { root, owner: story.name, kind: 'story', storyId }
    }
    const books = scanBooks(this.workspace).filter(book => book.bookId && 'book:' + book.bookId === space)
    if (books.length !== 1) throw new AuthorDocumentError('not-found', '书目不存在或书id不唯一')
    const book = books[0]!
    const root = authorDocumentPath(this.workspace, path.relative(this.workspace, book.root))
    return { root, owner: book.name, kind: 'book', bookId: book.bookId }
  }

  shelf(): StudyShelf {
    const scanned = scanBooks(this.workspace)
    const books: StudyBook[] = scanned.map(book => ({
      id: book.bookId ? 'book:' + book.bookId : 'invalid:' + book.name,
      kind: 'book',
      name: book.name,
      progress: book.bookId ? progressLineOf(book.root) : '书目缺少有效书id',
      ...(!book.bookId || scanned.filter(other => other.bookId === book.bookId).length > 1
        ? { error: '书id缺失或重复，请检查作品契约' } : {}),
    }))
    const stories = listShortStories(this.workspace)
    for (const story of stories) {
      const state = deriveShortStoryState(story.root, story.storyId)
      books.push({
        id: 'story:' + story.storyId,
        kind: 'story',
        name: story.name,
        platform: story.platform,
        platformProfile: story.platformProfile,
        rulePack: story.rulePack,
        progress: state.ok ? `${state.建议} · 下一步：${state.下一步}` : `状态异常：${state.reason}`,
        ...(state.ok ? {} : { error: state.reason }),
      })
    }
    let shared = false
    let sharedError: string | undefined
    try { shared = fs.statSync(authorDocumentPath(this.workspace, '书房')).isDirectory() } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') sharedError = error instanceof Error ? error.message : '共享资料不可访问'
    }
    return { workspace: this.workspace, books, shared, ...(sharedError ? { sharedError } : {}) }
  }

  indexBook(space: string): IndexBook {
    if (space === 'shared') throw new AuthorDocumentError('invalid-path', '索引只适用于指定书仓')
    const source = this.source(space)
    if (source.kind !== 'book' || !source.bookId) throw new AuthorDocumentError('invalid-path', '短故事与共享资料不使用长篇定稿索引')
    return { root: source.root, name: source.owner, bookId: source.bookId, workspace: this.workspace }
  }

  graph(space: string) {
    const source = this.source(space)
    if (source.kind !== 'book' || !source.bookId) throw new AuthorDocumentError('invalid-path', '图谱只适用于长篇作品')
    return readStoryGraph({ bookId: source.bookId, bookName: source.owner,
      maxChapter: Math.max(0, ...listChapters(source.root).map(item => item.章)),
      list: relative => this.treeAt(source, { space, path: relative }),
      read: relative => textOf(authorDocumentPath(source.root, relative)),
    })
  }

  tree(ref: FileRef): readonly TreeEntry[] {
    const source = this.source(ref.space)
    return this.treeAt(source, ref)
  }

  private treeAt(source: { root: string }, ref: FileRef): readonly TreeEntry[] {
    const directory = authorDocumentPath(source.root, ref.path, true)
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new AuthorDocumentError('not-found', '目录不存在')
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .map(entry => {
        const relative = path.posix.join(ref.path, entry.name)
        const item: TreeEntry = { ref: { space: ref.space, path: relative }, name: entry.name, directory: entry.isDirectory(), draft: ref.space !== 'shared' && (relative.startsWith('草稿区') || relative.startsWith('正文/草稿')) }
        try {
          const target = authorDocumentPath(source.root, relative)
          const info = fs.statSync(target)
          if (!info.isDirectory() && !info.isFile()) return { ...item, error: '不支持的文件类型' }
          const badge = info.isFile() && entry.name.endsWith('.md') && info.size <= MAX_DOCUMENT_BYTES
            ? fieldLabel(textOf(target)).badge : undefined
          return { ...item, directory: info.isDirectory(), ...(badge ? { badge } : {}) }
        } catch (error) {
          return { ...item, error: error instanceof Error ? error.message : '无法访问' }
        }
      }).sort((left, right) => {
        if (ref.path === '' && ref.space !== 'shared') {
          const a = ROOT_ORDER.indexOf(left.name), b = ROOT_ORDER.indexOf(right.name)
          if (a !== b) return (a < 0 ? 99 : a) - (b < 0 ? 99 : b)
        }
        return Number(right.directory) - Number(left.directory) || left.name.localeCompare(right.name, 'zh-CN', { numeric: true })
      })
  }

  read(ref: FileRef): StudyDocument {
    const source = this.source(ref.space)
    const absolutePath = authorDocumentPath(source.root, ref.path)
    const text = textOf(absolutePath)
    const parsed = parseDocument(text)
    const metadata = fieldLabel(text)
    const readOnly = ref.space.startsWith('story:')
      ? '短故事计划、正文与检查由故事工具维护，只读':
      parsed.ok ? authorReadOnlyReason(ref.path, ref.space === 'shared') : '文档格式异常，只读'
    return {
      ref, owner: source.owner, name: path.basename(ref.path), absolutePath,
      body: parsed.ok ? parsed.data.body : text, hash: documentHash(text),
      ...metadata, ...(readOnly ? { readOnly } : {}),
    }
  }

  resolve(absolutePath: string): StudyDocument | null {
    if (!isFullyQualifiedPath(absolutePath)) {
      const explicit = /^(?:book:)?([^:]+):(.+)$/.exec(absolutePath)
      if (explicit) {
        try { return this.read({ space: 'book:' + explicit[1], path: explicit[2]! }) } catch { /* try story space */ }
        try { return this.read({ space: 'story:' + explicit[1], path: explicit[2]! }) } catch { return null }
      }
      absolutePath = path.resolve(this.workspace, absolutePath)
    }
    const spaces = this.shelf().books.filter(book => !book.error).map(book => book.id)
    spaces.push('shared')
    for (const space of spaces) {
      try {
        const source = this.source(space)
        const relative = path.relative(source.root, absolutePath).split(path.sep).join('/')
        return this.read({ space, path: relative })
      } catch { /* A link outside an owned tree remains a native DSH file link. */ }
    }
    return null
  }

  search(query: string): { entries: readonly TreeEntry[]; limited: boolean } {
    if (!query.trim()) return { entries: [], limited: false }
    const entries: TreeEntry[] = []
    const scanned = scanBooks(this.workspace)
    const spaces = scanned.filter(book => book.bookId && scanned.filter(other => other.bookId === book.bookId).length === 1).map(book => 'book:' + book.bookId)
    spaces.push(...listShortStories(this.workspace).map(story => 'story:' + story.storyId))
    try { if (fs.statSync(authorDocumentPath(this.workspace, '书房')).isDirectory()) spaces.push('shared') } catch { /* Report unavailable shared roots in the shelf view. */ }
    const term = query.trim().toLocaleLowerCase()
    const visited = new Set<string>()
    let inspected = 0
    const walk = (source: { root: string; owner: string }, ref: FileRef): void => {
      if (entries.length >= 100 || inspected >= 10000) return
      const canonical = authorDocumentPath(source.root, ref.path, true)
      if (visited.has(canonical)) return
      visited.add(canonical)
      for (const entry of this.treeAt(source, ref)) {
        inspected++
        if (entry.error) continue
        if (!entry.directory && (source.owner + '/' + entry.ref.path).toLocaleLowerCase().includes(term)) entries.push(entry)
        if (entry.directory) walk(source, entry.ref)
        if (entries.length >= 100 || inspected >= 10000) return
      }
    }
    for (const space of spaces) walk(this.source(space), { space, path: '' })
    return { entries, limited: entries.length >= 100 || inspected >= 10000 }
  }

  private saveView(ref: FileRef, result: AuthorSaveResult): Omit<StudySave, 'notification' | 'notificationError'> {
    return {
      operationId: result.operationId,
      document: this.read({ ...ref, path: result.path }), changed: result.changed, previousPath: result.previousPath,
      changes: result.changed ? diffLines(result.previousBody, result.body).filter(part => part.added || part.removed)
        .map(part => ({ value: part.value, ...(part.added ? { added: true } : {}), ...(part.removed ? { removed: true } : {}) })) : [],
      commit: result.commit ? result.commit.ok ? 'saved' : 'failed' : 'not-required',
      ...(result.commit && !result.commit.ok ? { commitError: result.commit.reason } : {}),
      route: routeForDocument(ref),
    }
  }

  save(ref: FileRef, expectedHash: string, body: string, provenance: OperationProvenance, operationId?: string): Omit<StudySave, 'notification' | 'notificationError'> {
    if (Buffer.byteLength(body, 'utf8') > MAX_DOCUMENT_BYTES) throw new AuthorDocumentError('invalid-document', '正文超过 4 MiB，未保存')
    const source = this.source(ref.space)
    return withBookWrite(source.root, () => {
      const result = saveAuthorDocument(source.root, { path: ref.path, expectedHash, body, shared: ref.space === 'shared', provenance, operationId })
      return this.saveView(ref, result)
    }, provenance)
  }

  saved(ref: FileRef, hash: string, operationId: string, sessionId: string): Omit<StudySave, 'notification' | 'notificationError'> {
    const source = this.source(ref.space)
    return withBookWrite(source.root, () => {
      const result = readAuthorSave(source.root, operationId, sessionId, ref.space === 'shared')
      if (result.path !== ref.path || result.hash !== hash || this.read(ref).hash !== hash) throw new AuthorDocumentError('conflict', '文档已变化，请先核对磁盘版本')
      return this.saveView(ref, result)
    })
  }

  retryCommit(ref: FileRef, hash: string, operationId: string, sessionId: string) {
    const root = this.source(ref.space).root
    return withBookWrite(root, () => {
      const { document } = this.saved(ref, hash, operationId, sessionId)
      if (ref.space === 'shared' || ref.path.startsWith('草稿区/') || document.readOnly) throw new AuthorDocumentError('read-only', '此文件不适用补提交')
      return retryAuthorSaveCommit(root, operationId, hash, sessionId).commit
    })
  }

  chapters(space: string): ChapterView {
    const source = this.source(space)
    if (source.kind !== 'book' || !source.bookId) throw new AuthorDocumentError('invalid-path', '短故事与共享资料没有卷章视图')
    return {
      bookId: source.bookId, bookName: source.owner,
      chapters: listChapters(source.root).map(key => {
        const facts = scanChapter(source.root, key)
        const status = deriveChapterFacts(facts)
        const pending = findPendingReviewDraft(source.root, key)
        const candidates = [paths.定稿章(key.卷, key.章, key.章名), ...(pending ? [pending.relPath] : []), paths.确认细纲(key.卷, key.章, key.章名), paths.候选细纲(key.卷, key.章名)]
        const relative = candidates.find(candidate => fs.existsSync(path.join(source.root, candidate)))
        return { volume: key.卷, chapter: key.章, title: key.章名, status: status.建议.环节, finalized: facts.已定稿, ...(relative ? { source: { space, path: relative } } : {}) }
      }),
    }
  }
}
