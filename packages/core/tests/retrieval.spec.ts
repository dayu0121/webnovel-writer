import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { searchFinalized, syncFinalizedIndex, withBookLockAsync, withBookWrite, writeBatchAtomic, type EmbeddingProvider, type FinalizedSearchResult } from '../src'
import { removeSync } from '../src/repo/remove'
import { scanFinalized } from '../src/retrieval/source'
import { CACHE_PATH } from '../src/retrieval/cache'

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-search-')) })
afterEach(() => { vi.restoreAllMocks(); removeSync(root) })

function write(relative: string, raw: string): string {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, raw)
  return file
}
function chapter(number: number, body: string, fields = '版本: 1\n角色: 已定稿'): string {
  return write(`定稿/卷01/${String(number).padStart(4, '0')}-章${number}.md`, `---\n${fields}\n---\n\n${body}\n`)
}
function success(result: FinalizedSearchResult): Extract<FinalizedSearchResult, { ok: true }> {
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
  if (!result.ok) throw new Error(result.reason)
  return result
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function provider(embed?: EmbeddingProvider['embed'], revision = 'fixture-v1', dimensions = 2): EmbeddingProvider {
  return {
    metadata: { provider: 'controlled-fixture', model: 'fixture', dimensions, revision },
    embed: embed ?? (async inputs => inputs.map(() => [1, 0])),
    embedBatch: embed ?? (async inputs => inputs.map(() => [1, 0])),
  }
}
const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })

describe('定稿来源、中文词句与定位', () => {
  it('单字、双字、人名子串、标点及 FTS 运算符全部按字面查询', async () => {
    chapter(1, '张三丰在青云剑宗等林舟。星光照着 A*B 和 "OR"，还有 😀星河。')
    chapter(2, '只有甲乙丙丁，不含其他搜索词。')
    for (const query of ['张', '三丰', '青云剑', '林舟', 'A*B', '"OR"', '😀星河']) {
      const result = success(await searchFinalized(root, { query }))
      expect(result).toMatchObject({ mode: 'keyword', status: 'matches' })
      expect(result.hits.map(hit => hit.chapter)).toEqual([1])
      expect(result.hits[0]!.snippet).toContain(query)
    }
    expect(success(await searchFinalized(root, { query: '林舟 OR 甲乙' })).status).toBe('no-matches')
  })

  it('只索引规范定稿正文，排除 frontmatter、候选事实和其他工件', async () => {
    chapter(1, '真实正文。\n\n## 草稿候选事实\n- 候选秘密', '版本: 7\n角色: 已定稿\n备注: 页眉秘密')
    for (const relative of ['世界书/人物/甲.md', '草稿区/草稿/稿1.md', '定稿/卷01/摘要.md', '定稿/卷01/0000-空.md', '定稿/卷01/.隐藏.md', '定稿/卷01/子目录/0002-不规范.md', '定稿/.隐藏/0002-隐藏.md']) write(relative, '工件秘密')
    for (const query of ['页眉秘密', '候选秘密', '工件秘密']) {
      expect(success(await searchFinalized(root, { query })).hits).toEqual([])
    }
    const result = success(await searchFinalized(root, { query: '真实正文' }))
    expect(result.index.chapters).toBe(1)
    expect(result.hits[0]!.version).toBe(7)
  })

  it('CRLF、空行、重复段和长段切片能回到原文行号、版本与字节哈希', async () => {
    const raw = ('---\n版本: 3\n角色: 已定稿\n---\n\n\n' + '前序行\n' + '甲'.repeat(785) + '😀跨段线索' + '乙'.repeat(1700) + '\n\n尾行\n').replaceAll('\n', '\r\n')
    const file = write('定稿/卷02/0042-跨段.md', raw)
    const snapshot = await scanFinalized(root)
    expect(snapshot.documents[0]!.chunks.length).toBeGreaterThan(2)
    const result = success(await searchFinalized(root, { query: '😀跨段线索' }))
    for (const hit of result.hits) {
      expect(hit.absolutePath).toBe(file)
      expect(hit).toMatchObject({ volume: 2, chapter: 42, version: 3 })
      expect(hit.hash).toBe(createHash('sha256').update(raw).digest('hex'))
      expect(raw.replaceAll('\r\n', '\n').split('\n').slice(hit.startLine - 1, hit.endLine).join('\n')).toContain(hit.snippet)
      expect(hit.来源标注.状态).toContain('未经原文核对')
      expect(Object.keys(hit.来源标注)).toHaveLength(6)
      expect(hit.snippet).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/)
    }
  })

  it('没有定稿、没有命中、部分源错误与缓存故障分别呈报', async () => {
    expect(success(await searchFinalized(root, { query: '线索' })).status).toBe('no-finalized')
    chapter(1, '林舟回家。')
    expect(success(await searchFinalized(root, { query: '线索' })).status).toBe('no-matches')
    write('定稿/卷01/0002-坏文件.md', '---\n坏 YAML: [\n---\n线索')
    const partial = success(await searchFinalized(root, { query: '林舟' }))
    expect(partial.status).toBe('partial')
    expect(partial.issues).toEqual([expect.objectContaining({ path: '定稿/卷01/0002-坏文件.md', code: 'invalid-document' })])
    expect(partial.hits[0]!.来源标注.完整性).toContain('部分')
    fs.unlinkSync(path.join(root, CACHE_PATH))
    fs.mkdirSync(path.join(root, CACHE_PATH))
    expect(await searchFinalized(root, { query: '林舟' })).toMatchObject({ ok: false, code: 'unsafe-cache' })
  })

  it('不可读文件不得静默变成完整搜索', async () => {
    chapter(1, '可读线索')
    const blocked = chapter(2, '隐藏线索')
    const open = fs.promises.open.bind(fs.promises)
    vi.spyOn(fs.promises, 'open').mockImplementation(((filename: fs.PathLike, flags: string | number) => {
      if (String(filename) === blocked) return Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
      return open(filename, flags)
    }) as typeof fs.promises.open)
    const result = success(await searchFinalized(root, { query: '线索' }))
    expect(result.status).toBe('partial')
    expect(result.hits.map(hit => hit.chapter)).toEqual([1])
    expect(result.issues[0]!.code).toBe('read-error')
  })

  it('目录链接、越界文件链接和硬链接不参与正文索引', async () => {
    const outside = write('资料/0001-外部.md', '外部秘密')
    fs.mkdirSync(path.join(root, '定稿/卷01'), { recursive: true })
    fs.symlinkSync(path.dirname(outside), path.join(root, '定稿/卷02'), 'junction')
    fs.linkSync(outside, path.join(root, '定稿/卷01/0003-硬链接.md'))
    const result = success(await searchFinalized(root, { query: '外部秘密' }))
    expect(result.hits).toEqual([])
    expect(result.status).toBe('partial')
    expect(result.issues.map(issue => issue.code)).toEqual(['unsafe-path', 'unsafe-path'])
  })

  it('检查路径后被替换成其他文件时，不索引替换文件的内容', async () => {
    const file = chapter(1, '书仓原文')
    const external = write('资料/外部.md', '不应发送的外部内容')
    const open = fs.promises.open.bind(fs.promises)
    vi.spyOn(fs.promises, 'open').mockImplementation(((filename: fs.PathLike, flags: string | number) => open(String(filename) === file ? external : filename, flags)) as typeof fs.promises.open)
    const embeddings = provider(vi.fn(async () => [[1, 0]]))
    const result = success(await searchFinalized(root, { query: '外部内容', provider: embeddings }))
    expect(result).toMatchObject({ status: 'partial', hits: [] })
    expect(result.issues[0]!.code).toBe('unsafe-path')
    expect(embeddings.embed).not.toHaveBeenCalled()
  })

  it('不存在的书仓明确报源错误，不为它创建目录', async () => {
    const missing = path.join(root, '不存在的书')
    expect(await searchFinalized(missing, { query: '线索' })).toMatchObject({ ok: false, code: 'source-error' })
    expect(fs.existsSync(missing)).toBe(false)
  })
})

describe('可丢弃缓存与真实内容校准', () => {
  it('同大小同 mtime 修改、更名和删除会移除旧结果', async () => {
    const file = chapter(1, '旧港线索')
    const before = fs.statSync(file)
    expect(success(await searchFinalized(root, { query: '旧港' })).hits).toHaveLength(1)
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('旧港', '新港'))
    fs.utimesSync(file, before.atime, before.mtime)
    expect(success(await searchFinalized(root, { query: '旧港' })).hits).toEqual([])
    expect(success(await searchFinalized(root, { query: '新港' })).hits).toHaveLength(1)
    const renamed = path.join(path.dirname(file), '0001-改名.md')
    fs.renameSync(file, renamed)
    expect(success(await searchFinalized(root, { query: '新港' })).hits[0]!.title).toBe('改名')
    fs.unlinkSync(renamed)
    const empty = success(await searchFinalized(root, { query: '新港' }))
    expect(empty).toMatchObject({ status: 'no-finalized', hits: [], index: { chunks: 0 } })
  })

  it('损坏和删除索引都能重建出相同结果，排序不随插入顺序变化', async () => {
    chapter(2, '线索在此')
    await searchFinalized(root, { query: '线索' })
    chapter(1, '线索在此')
    const first = success(await searchFinalized(root, { query: '线索', limit: 1 }))
    expect(first.hits[0]!.chapter).toBe(1)
    expect(first.limited).toBe(true)
    fs.writeFileSync(path.join(root, CACHE_PATH), 'broken sqlite')
    const rebuilt = success(await searchFinalized(root, { query: '线索', limit: 1 }))
    expect(rebuilt.index.state).toBe('rebuilt')
    expect(rebuilt.hits).toEqual(first.hits)
    fs.unlinkSync(path.join(root, CACHE_PATH))
    expect(success(await searchFinalized(root, { query: '线索', limit: 1 })).hits).toEqual(first.hits)
  })

  it.each(['DELETE FROM terms', 'DROP TABLE terms', 'DELETE FROM terms_data WHERE id > 10', "UPDATE metadata SET value='obsolete' WHERE key='chunk-version'"])(
    '缓存结构或内容损坏自动重建：%s', async sql => {
      chapter(1, '可靠原文线索')
      const first = success(await searchFinalized(root, { query: '原文线索' }))
      const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
      const db = new DatabaseSync(path.join(root, CACHE_PATH))
      try {
        // Only the disposable fixture disables SQLite's default shadow-table guard.
        if (sql.includes('terms_data')) (db as typeof db & { enableDefensive(enabled: boolean): void }).enableDefensive(false)
        db.exec(sql)
      } finally { db.close() }
      const rebuilt = success(await searchFinalized(root, { query: '原文线索' }))
      expect(rebuilt.index.state).toBe('rebuilt')
      expect(rebuilt.hits).toEqual(first.hits)
    },
  )

  it('未知 SQLite 和共享缓存硬链接保持原样并明确拒绝', async () => {
    chapter(1, '线索')
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
    fs.mkdirSync(path.join(root, '.webnovel'))
    const file = path.join(root, CACHE_PATH)
    const db = new DatabaseSync(file)
    try { db.exec('CREATE TABLE author_data(value TEXT); INSERT INTO author_data VALUES (\'保留\')') } finally { db.close() }
    const original = fs.readFileSync(file)
    expect(await searchFinalized(root, { query: '线索' })).toMatchObject({ ok: false, code: 'foreign-cache' })
    expect(fs.readFileSync(file)).toEqual(original)
    fs.linkSync(file, path.join(root, '其他缓存.sqlite'))
    expect(await searchFinalized(root, { query: '线索' })).toMatchObject({ ok: false, code: 'unsafe-cache' })
    expect(fs.readFileSync(file)).toEqual(original)
  })

  it('分支切换按文件字节重新校准，搜索自身不改作品或 Git HEAD', async () => {
    const file = chapter(1, '旧分支线索')
    git('init', '--quiet')
    git('config', 'user.name', 'Search Test')
    git('config', 'user.email', 'search@example.invalid')
    git('config', 'commit.gpgsign', 'false')
    git('config', 'core.autocrlf', 'false')
    git('add', '.')
    git('commit', '--quiet', '-m', 'fixture')
    const firstHead = git('rev-parse', 'HEAD').trim()
    const original = fs.readFileSync(file, 'utf8')
    await searchFinalized(root, { query: '旧分支' })
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
    expect(git('rev-parse', 'HEAD').trim()).toBe(firstHead)
    expect(git('status', '--porcelain')).toBe('')
    git('checkout', '--quiet', '-b', 'fixture-next')
    fs.writeFileSync(file, original.replace('旧分支', '新分支'))
    git('add', '.')
    git('commit', '--quiet', '-m', 'next')
    expect(success(await searchFinalized(root, { query: '旧分支' })).hits).toEqual([])
    const nextHead = git('rev-parse', 'HEAD').trim()
    expect(success(await searchFinalized(root, { query: '新分支' })).hits).toHaveLength(1)
    expect(git('rev-parse', 'HEAD').trim()).toBe(nextHead)
    git('checkout', '--quiet', '--detach', firstHead)
    expect(success(await searchFinalized(root, { query: '新分支' })).hits).toEqual([])
    expect(success(await searchFinalized(root, { query: '旧分支' })).hits).toHaveLength(1)
    expect(git('status', '--porcelain')).toBe('')
  })
})

describe('向量融合、新鲜度与取消', () => {
  it('融合、去重、稳定排序并复用当前版本向量', async () => {
    chapter(1, '归家：林舟回到故乡。')
    chapter(2, '他终于重返阔别多年的家园。')
    chapter(3, '山巅落雪。')
    const embed = vi.fn<EmbeddingProvider['embed']>(async (inputs, role) => inputs.map(input => role === 'query' ? [1, 0] : input.text.includes('山巅') ? [-1, 0] : input.text.includes('归家') ? [0.8, 0.2] : [1, 0]))
    const embeddings = provider(embed)
    expect(await syncFinalizedIndex(root, { getProvider: () => embeddings })).toMatchObject({ ok: true, state: { generated: 3 } })
    const result = success(await searchFinalized(root, { query: '归家', provider: embeddings }))
    expect(result.mode).toBe('hybrid')
    expect(result.hits.map(hit => hit.chapter)).toEqual([1, 2])
    expect(result.hits.map(hit => hit.matchedBy)).toEqual([['keyword', 'semantic'], ['semantic']])
    expect(result.index).toMatchObject({ embedded: 0, reused: 3 })
    const again = success(await searchFinalized(root, { query: '归家', provider: embeddings }))
    expect(again.index).toMatchObject({ embedded: 0, reused: 3 })
    expect(embed.mock.calls.map(call => call[1])).toEqual(['document', 'query', 'query'])
    expect(again.hits).toEqual(result.hits)
    const changed = provider(embed, 'fixture-v2')
    expect(await syncFinalizedIndex(root, { getProvider: () => changed })).toMatchObject({ ok: true, state: { generated: 3 } })
  })

  it.each(['short-batch', 'sparse-batch', 'wrong-width', 'zero-vector', 'non-finite', 'throw'] as const)('%s 明确降级而不保存错配向量', async failure => {
    chapter(1, '线索原文')
    const broken = provider(async () => {
      if (failure === 'throw') throw new Error('SECRET remote payload')
      if (failure === 'sparse-batch') return new Array(1)
      return failure === 'short-batch' ? [] : failure === 'wrong-width' ? [[1]] : failure === 'zero-vector' ? [[0, 0]] : [[NaN, 1]]
    })
    expect((await syncFinalizedIndex(root, { getProvider: () => broken, retry: { maxRetries: 0 } })).ok).toBe(false)
    const result = success(await searchFinalized(root, { query: '线索', provider: broken }))
    expect(result).toMatchObject({ mode: 'keyword', index: { embedded: 0, reused: 0 } })
    expect(result.degraded).toContain('仅检索关键词')
    expect(JSON.stringify(result)).not.toContain('SECRET')
    const recovered = provider()
    expect(await syncFinalizedIndex(root, { getProvider: () => recovered })).toMatchObject({ ok: true, state: { generated: 1, reused: 0 } })
  })

  it('网络等待不持锁，写入后拒绝发布旧向量', async () => {
    chapter(1, '旧线索原文')
    const entered = deferred<void>()
    const response = deferred<readonly (readonly number[])[]>()
    const embeddings = provider(async (_inputs, role) => {
      if (role === 'query') return [[1, 0]]
      entered.resolve(); return response.promise
    })
    const pending = syncFinalizedIndex(root, { getProvider: () => embeddings })
    await entered.promise
    expect(fs.existsSync(path.join(root, '.webnovel/book.lock'))).toBe(false)
    withBookWrite(root, () => writeBatchAtomic(root, [{ relPath: '定稿/卷01/0001-章1.md', content: '新线索原文' }]))
    response.resolve([[1, 0]])
    expect(await pending).toMatchObject({ ok: false, failure: { code: 'source-changed' } })
    expect(success(await searchFinalized(root, { query: '旧线索' })).hits).toEqual([])
  })

  it('提供方在等待中被替换，即使同一模型版本也拒绝迟到发布', async () => {
    chapter(1, '线索')
    const entered = deferred<void>()
    const response = deferred<readonly (readonly number[])[]>()
    let current = provider(async (_inputs, role) => {
      if (role === 'query') return [[1, 0]]
      entered.resolve(); return response.promise
    })
    const pending = syncFinalizedIndex(root, { getProvider: () => current })
    await entered.promise
    current = provider()
    response.resolve([[1, 0]])
    expect(await pending).toMatchObject({ ok: false, failure: { code: 'provider-changed' } })
    expect(await syncFinalizedIndex(root, { getProvider: () => current })).toMatchObject({ ok: true, state: { generated: 1 } })
  })

  it('预取消零调用；未配合的提供方也不能阻塞取消或迟到写入缓存', async () => {
    chapter(1, '线索')
    const abort = new AbortController()
    abort.abort()
    const embed = vi.fn<EmbeddingProvider['embed']>(async () => [[1, 0]])
    expect(await searchFinalized(root, { query: '线索', provider: provider(embed), signal: abort.signal })).toMatchObject({ code: 'cancelled' })
    expect(embed).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(root, CACHE_PATH))).toBe(false)
    const active = new AbortController()
    const entered = deferred<void>()
    const late = deferred<readonly (readonly number[])[]>()
    const delayed = provider(async () => { entered.resolve(); return late.promise })
    const pending = syncFinalizedIndex(root, { signal: active.signal, getProvider: () => delayed })
    await entered.promise
    active.abort()
    expect(await pending).toMatchObject({ ok: false, failure: { code: 'cancelled' } })
    late.resolve([[1, 0]])
    const recovered = provider()
    expect(await syncFinalizedIndex(root, { getProvider: () => recovered })).toMatchObject({ ok: true, state: { generated: 1 } })
  })

  it('活跃锁和待恢复事务明确拒绝，保留锁及事务证据', async () => {
    chapter(1, '线索')
    const release = deferred<void>()
    const held = withBookLockAsync(root, () => release.promise)
    const lock = fs.readFileSync(path.join(root, '.webnovel/book.lock'), 'utf8')
    try {
      expect(await searchFinalized(root, { query: '线索' })).toMatchObject({ ok: false, code: 'book-busy' })
      expect(fs.readFileSync(path.join(root, '.webnovel/book.lock'), 'utf8')).toBe(lock)
    } finally { release.resolve(); await held }
    const evidence = write('.webnovel/transactions/unfinished/manifest.json', '{"incomplete":true}')
    expect(await searchFinalized(root, { query: '线索' })).toMatchObject({ ok: false, code: 'recovery-required' })
    expect(fs.readFileSync(evidence, 'utf8')).toBe('{"incomplete":true}')
  })

  it.each([{ query: '' }, { query: '   ' }, { query: '\0' }, { query: '甲'.repeat(257) }, { query: '线索', limit: 0 }, { query: '线索', limit: 1.5 }])('拒绝无效查询 %j', async options => {
    expect(await searchFinalized(root, options)).toMatchObject({ ok: false, code: 'invalid-query' })
    expect(fs.existsSync(path.join(root, CACHE_PATH))).toBe(false)
  })
})
