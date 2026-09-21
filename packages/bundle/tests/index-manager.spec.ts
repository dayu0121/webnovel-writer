import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { commitWithIsolatedIndex, onBookCommit, readIndexState, withBookWrite, writeBatchAtomic, type EmbeddingProvider } from '@webnovel/core'
import { removeSync } from '../../core/src/repo/remove'
import { BookIndexManager, type IndexBook } from '../src/indexing/manager'
import { bookGitWatchPaths } from '../src/indexing/git'

let workspace: string
let book: IndexBook
const managers: BookIndexManager[] = []
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-index-manager-'))
  book = { root: path.join(workspace, '测试作品'), bookId: 'manager-book', name: '测试作品', workspace }
  put('作品契约/契约.md', '---\n书id: manager-book\n---\n测试作品')
  put('定稿/卷01/0001-开篇.md', '第一章原文')
  git('init', '--quiet')
  git('config', 'user.name', 'Index Test')
  git('config', 'user.email', 'index@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'core.autocrlf', 'false')
  commit('initial')
})
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.close()
  removeSync(workspace)
})
const git = (...args: string[]) => execFileSync('git', args, { cwd: book.root, encoding: 'utf8', windowsHide: true })
function put(relative: string, content: string) {
  const file = path.join(book.root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content)
}
function commit(message: string) { git('add', '.'); git('commit', '--quiet', '-m', message); return git('rev-parse', 'HEAD').trim() }
function client(run: EmbeddingProvider['embed'] = async inputs => inputs.map(() => [1, 0])): EmbeddingProvider {
  return { metadata: { provider: 'fixture', model: 'fixture', dimensions: 2, revision: 'v1', batchSize: 1 }, embed: run, embedBatch: run }
}
function manager(provider: EmbeddingProvider, notify?: ConstructorParameters<typeof BookIndexManager>[0]['notify']) {
  const result = new BookIndexManager({ getProvider: () => provider, workspaces: () => [workspace], pollMs: 50, debounceMs: 5, retry: { maxRetries: 0 }, notify })
  managers.push(result); return result
}
async function ready(head = git('rev-parse', 'HEAD').trim()) {
  await vi.waitFor(() => expect(readIndexState(book.root)).toMatchObject({ phase: 'ready', indexedHead: head }), { timeout: 8000, interval: 30 })
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

describe('Git 驱动的后台索引', () => {
  it('重启后发现新启用的场景配置；换模型和向量重建复用边界', async () => {
    const embedding = client()
    const old = manager(embedding)
    await old.control(book, 'enable', 'owner')
    await ready()
    await old.close()
    const segment = vi.fn(async (paragraphs: readonly string[]) => [paragraphs.length])
    let scenes = { metadata: { provider: 'fixture', model: 'scene', revision: 'v1' }, segment }
    const runtime = new BookIndexManager({ getProvider: () => embedding, getSceneProvider: () => scenes, workspaces: () => [workspace], pollMs: 50, debounceMs: 5 })
    managers.push(runtime)
    await runtime.refresh()
    await vi.waitFor(() => expect(readIndexState(book.root)).toMatchObject({ phase: 'ready', scenes: { completed: 1 } }), { timeout: 8000 })
    expect(segment).toHaveBeenCalledTimes(1)
    scenes = { ...scenes, metadata: { ...scenes.metadata, model: 'new-model', revision: 'v2' } }
    await runtime.refresh()
    await ready()
    expect(segment).toHaveBeenCalledTimes(1)
    await runtime.control(book, 'rebuild', 'owner')
    await ready()
    expect(segment).toHaveBeenCalledTimes(1)
    await runtime.control(book, 'rescan-scenes', 'owner', 1)
    await ready()
    expect(segment).toHaveBeenCalledTimes(2)
  }, 15_000)

  it('默认停用，启用后覆盖手工提交，设计提交不重复嵌入', async () => {
    const embed = vi.fn<EmbeddingProvider['embed']>(async inputs => inputs.map(() => [1, 0]))
    const runtime = manager(client(embed))
    await runtime.refresh()
    expect(embed).not.toHaveBeenCalled()
    await runtime.control(book, 'enable', 'owner')
    await ready()
    expect(embed).toHaveBeenCalledTimes(1)
    put('定稿/卷01/0002-新章.md', '第二章原文')
    const next = commit('external chapter')
    await ready(next)
    expect(embed).toHaveBeenCalledTimes(2)
    expect(embed.mock.calls[1]![0][0]!.text).toBe('第二章原文')
    put('大纲/故事骨架.md', '只是设计更新')
    const design = commit('design only')
    await ready(design)
    expect(embed).toHaveBeenCalledTimes(2)
    fs.unlinkSync(path.join(book.root, '定稿/卷01/0002-新章.md'))
    await ready(commit('delete chapter'))
    expect(readIndexState(book.root).chunks).toBe(1)
    expect(embed).toHaveBeenCalledTimes(2)
  }, 20_000)

  it('后台 API 挂起不妨碍 Git 提交，提交观察者故障不改变提交结果', async () => {
    const entered = deferred<void>(), response = deferred<readonly (readonly number[])[]>()
    const runtime = manager(client(async () => { entered.resolve(); return response.promise }))
    await runtime.control(book, 'enable', 'owner')
    await entered.promise
    const observed: string[][] = []
    const off = onBookCommit(event => { observed.push([...event.paths]); throw new Error('observer failure') })
    try {
      const result = withBookWrite(book.root, () => {
        writeBatchAtomic(book.root, [{ relPath: '大纲/故事骨架.md', content: '作者保存仍可完成' }])
        return commitWithIsolatedIndex(book.root, ['大纲/故事骨架.md'], 'design: while embedding')
      })
      expect(result.status).toBe(0)
      await Promise.resolve()
      expect(observed).toEqual([['大纲/故事骨架.md']])
      expect(fs.existsSync(path.join(book.root, '.webnovel/book.lock'))).toBe(false)
    } finally { off(); response.resolve([[1, 0]]) }
    await ready()
  }, 15_000)

  it('暂停和重启保留成功批次，不依赖主 Agent 存活', async () => {
    put('定稿/卷01/0002-次章.md', '第二章原文'); commit('second')
    const entered = deferred<void>(), response = deferred<readonly (readonly number[])[]>()
    let block = true, calls = 0
    const provider = client(async () => {
      calls++
      if (calls === 2 && block) { entered.resolve(); return response.promise }
      return [[1, 0]]
    })
    const original = manager(provider)
    await original.control(book, 'enable', 'owner')
    await entered.promise
    expect(readIndexState(book.root).completedChunks).toBe(1)
    await original.close()
    block = false
    response.resolve([[1, 0]])
    const restarted = manager(provider)
    await restarted.refresh()
    await ready()
    expect(readIndexState(book.root)).toMatchObject({ completedChunks: 2, reused: 1, generated: 1, recipientSession: 'owner' })
    expect(calls).toBe(3)
    await restarted.control(book, 'pause', 'owner')
    put('定稿/卷01/0003-末章.md', '第三章原文'); const newest = commit('while paused')
    await restarted.refresh()
    expect(readIndexState(book.root).phase).toBe('paused')
    expect(calls).toBe(3)
    await restarted.control(book, 'resume', 'owner')
    await ready(newest)
    expect(calls).toBe(4)
  }, 20_000)

  it('失败保留原因及收件会话，恢复收件人后只投递一次', async () => {
    let receiver = false
    const deliveries: string[] = []
    const runtime = manager(client(async () => { throw { code: 'http-error', httpStatus: 401 } }), (_book, notice) => {
      expect(notice.sessionId).toBe('owner-session')
      if (!receiver) return false
      deliveries.push(notice.id); return true
    })
    await runtime.control(book, 'enable', 'owner-session')
    await vi.waitFor(() => expect(readIndexState(book.root).phase).toBe('failed'))
    expect(readIndexState(book.root).notice?.error.message).toContain('401')
    expect(deliveries).toEqual([])
    receiver = true
    await runtime.refresh()
    await vi.waitFor(() => expect(readIndexState(book.root).notice?.delivered).toBe(true))
    await runtime.refresh()
    expect(deliveries).toHaveLength(1)
  }, 15_000)

  it('两个运行实例协调同一持久任务，不互相换代或重复请求', async () => {
    const entered = deferred<void>(), response = deferred<readonly (readonly number[])[]>()
    const embed = vi.fn<EmbeddingProvider['embed']>(async () => { entered.resolve(); return response.promise })
    const provider = client(embed)
    const first = manager(provider), second = manager(provider)
    await first.control(book, 'enable', 'owner')
    await entered.promise
    const generation = readIndexState(book.root).generation
    await second.refresh()
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(readIndexState(book.root).generation).toBe(generation)
    expect(embed).toHaveBeenCalledTimes(1)
    response.resolve([[1, 0]])
    await ready()
  }, 15_000)

  it('worktree 的 git 文件与共享 refs 均能定位，分支切换刷新来源', async () => {
    const original = book
    const alternateWorkspace = path.join(workspace, 'linked')
    fs.mkdirSync(alternateWorkspace)
    const alternateRoot = path.join(alternateWorkspace, '分支作品')
    git('worktree', 'add', '--quiet', '-b', 'index-side', alternateRoot)
    book = { ...book, root: alternateRoot, workspace: alternateWorkspace }
    expect(fs.lstatSync(path.join(book.root, '.git')).isFile()).toBe(true)
    const watches = await bookGitWatchPaths(book.root)
    expect(watches.some(directory => directory.startsWith(path.join(original.root, '.git')))).toBe(true)
    const embed = vi.fn<EmbeddingProvider['embed']>(async inputs => inputs.map(() => [1, 0]))
    const runtime = manager(client(embed))
    await runtime.control(book, 'enable', 'owner')
    await ready()
    put('定稿/卷01/0001-开篇.md', '分支新正文'); const changed = commit('side edit')
    await ready(changed)
    git('checkout', '--quiet', '--detach', 'HEAD~1')
    await ready()
    expect(embed.mock.calls.some(call => call[0][0]?.text === '分支新正文')).toBe(true)
    await runtime.close()
    book = original
    expect(path.resolve(alternateRoot).startsWith(path.resolve(workspace) + path.sep)).toBe(true)
    git('worktree', 'remove', '--force', alternateRoot)
  }, 25_000)
})
