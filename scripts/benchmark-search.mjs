import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { performance } from 'node:perf_hooks'
import { register } from 'node:module'
import { createServer } from 'node:http'

register('./strip-types-loader.mjs', import.meta.url)
const { searchFinalized } = await import('../packages/core/src/retrieval/search.ts')
const { syncFinalizedIndex } = await import('../packages/core/src/retrieval/sync.ts')
const { SearchCache } = await import('../packages/core/src/retrieval/cache.ts')
const { HttpEmbeddingProvider } = await import('../packages/embedding-provider/src/http.ts')
const { removeSync } = await import('../packages/core/src/repo/remove.ts')

const outputArg = process.argv.indexOf('--out')
const output = outputArg < 0 ? undefined : process.argv[outputArg + 1]
if (outputArg >= 0 && !output) throw new Error('--out requires a JSON path')
const chapterArg = process.argv.indexOf('--chapters')
const selectedChapters = chapterArg < 0 ? [200, 1000] : [Number(process.argv[chapterArg + 1])]
if (selectedChapters.some(count => !Number.isInteger(count) || count < 1 || count > 1000)) throw new Error('--chapters must be 1–1000')
const modeArg = process.argv.indexOf('--mode')
const selectedModes = modeArg < 0 ? ['keyword', 'hybrid'] : [process.argv[modeArg + 1]]
if (selectedModes.some(mode => !['keyword', 'hybrid'].includes(mode))) throw new Error('--mode must be keyword or hybrid')
// Instrument this isolated benchmark only; the product has no timing state or watcher.
const phases = { cacheOpenMs: 0, vectorsMs: 0, publishMs: 0, keywordMs: 0, embeddingMs: 0 }
const filesystem = { realpathCalls: 0, realpathMs: 0 }
const realpath = fs.realpathSync.native
fs.realpathSync.native = (...args) => {
  const start = performance.now()
  try { return realpath(...args) } finally { filesystem.realpathCalls++; filesystem.realpathMs += performance.now() - start }
}
const openCache = SearchCache.open
SearchCache.open = async function (...args) {
  const start = performance.now()
  try { return await openCache.apply(this, args) } finally { phases.cacheOpenMs += performance.now() - start }
}
for (const method of ['vectors', 'publish', 'keyword']) {
  const original = SearchCache.prototype[method]
  SearchCache.prototype[method] = function (...args) {
    const start = performance.now()
    try { return original.apply(this, args) } finally { phases[`${method}Ms`] += performance.now() - start }
  }
}
const tempPrefix = path.join(os.tmpdir(), 'webnovel-benchmark-search-')
const root = fs.mkdtempSync(tempPrefix)
const marker = '独有青铜信物'
const changedMarker = '独有琉璃信物'
const dimensions = 1536
const traffic = { requests: 0, documents: 0, queries: 0 }
const server = createServer((req, res) => {
  void (async () => {
    let text = ''
    for await (const part of req) text += part
    const body = JSON.parse(text)
    assert.equal(req.url, '/v1/embeddings')
    assert.equal(body.dimensions, dimensions)
    traffic.requests++
    const data = body.input.map((input, index) => {
      if (input.startsWith('document:\n')) traffic.documents++
      else traffic.queries++
      let seed = 17
      for (const char of input) seed = (Math.imul(seed, 31) + char.codePointAt(0)) >>> 0
      const embedding = Array.from({ length: dimensions }, (_, dimension) => {
        if (dimension === 0 && (input.includes(marker) || input.includes(changedMarker))) return 100
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return Math.round(((seed / 0xffffffff) - 0.5) * 10000) / 10000
      })
      return { index, embedding }
    }).reverse()
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data }))
  })().catch(error => { console.error(error.message); res.destroy() })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

const report = {
  measuredAt: new Date().toISOString(), node: process.version, platform: `${process.platform}/${process.arch}`,
  cpu: os.cpus()[0]?.model, dimensions, warmRepeats: 3,
  boundary: '合成中文语料，每章约 2000 汉字。计时覆盖源扫描、哈希、SQLite 校准、查询、原文复核；hybrid 另含独立提供方和本地 HTTP 批量传输。向量由确定性夹具生成，不代表实际模型质量、远端延迟或费用。首次索引不是冷操作系统页缓存。',
  cases: [],
}
function makeBook(chapters, mode) {
  const book = path.join(root, `${chapters}-${mode}`)
  const alphabet = [...'山水天地人海青云故乡归客长夜星河风雪灯火旧城远路江湖刀剑门前月下少年记忆书信岁梦舟渡桥岸声影明暗欢悲前后左右言语心事春夏秋冬']
  let sourceBytes = 0
  let hanCharacters = 0
  let target
  for (let number = 1; number <= chapters; number++) {
    let seed = number
    const chars = Array.from({ length: 2000 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return alphabet[seed % alphabet.length]
    })
    if (number === Math.ceil(chapters / 2)) chars.splice(640, marker.length, ...marker)
    const body = Array.from({ length: 20 }, (_, row) => chars.slice(row * 100, row * 100 + 100).join('')).join('\n\n')
    const text = `---\n版本: 1\n角色: 已定稿\n---\n\n${body}\n`
    const file = path.join(book, `定稿/卷${String(Math.ceil(number / 100)).padStart(2, '0')}/${String(number).padStart(4, '0')}-合成章节.md`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
    sourceBytes += Buffer.byteLength(text)
    hanCharacters += chars.length
    if (number === Math.ceil(chapters / 2)) target = file
  }
  return { book, target, sourceBytes, hanCharacters }
}
const milliseconds = value => Math.round(value * 100) / 100
async function measure(book, query, provider) {
  const beforeTraffic = { ...traffic }
  const beforePhases = { ...phases }
  const beforeFilesystem = { ...filesystem }
  const start = performance.now()
  const result = await searchFinalized(book, { query, provider })
  const elapsedMs = milliseconds(performance.now() - start)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.mode, provider ? 'hybrid' : 'keyword', JSON.stringify(result))
  assert.equal(result.status, 'matches')
  assert.ok(result.hits.some(hit => hit.snippet.includes(query)))
  assert.equal(result.issues.length, 0)
  const timings = Object.fromEntries(Object.keys(phases).map(key => [key, milliseconds(phases[key] - beforePhases[key])]))
  timings.scansAndFusionMs = milliseconds(elapsedMs - Object.values(timings).reduce((sum, value) => sum + value, 0))
  const filesystemTimings = { realpathCalls: filesystem.realpathCalls - beforeFilesystem.realpathCalls, realpathMs: milliseconds(filesystem.realpathMs - beforeFilesystem.realpathMs) }
  console.error(`[search benchmark] ${path.basename(book)}: ${elapsedMs} ms ${JSON.stringify({ ...timings, ...filesystemTimings })}`)
  return {
    elapsedMs, timings, filesystemTimings, index: result.index, hits: result.hits.length,
    requests: traffic.requests - beforeTraffic.requests, documentsSent: traffic.documents - beforeTraffic.documents,
    queriesSent: traffic.queries - beforeTraffic.queries,
  }
}
async function measureSync(book, provider) {
  if (!provider) return undefined
  const before = { ...traffic }
  const start = performance.now()
  const result = await syncFinalizedIndex(book, { getProvider: () => provider })
  assert.ok(result.ok, result.failure?.message)
  return { elapsedMs: milliseconds(performance.now() - start), generated: result.state.generated,
    reused: result.state.reused, requests: traffic.requests - before.requests,
    documentsSent: traffic.documents - before.documents }
}
try {
  for (const chapters of selectedChapters) for (const mode of selectedModes) {
    const fixture = makeBook(chapters, mode)
    const provider = mode === 'keyword' ? undefined : new HttpEmbeddingProvider({
      protocol: 'openai-compatible', baseURL: `http://127.0.0.1:${server.address().port}/v1`, model: 'benchmark-fixture',
      dimensions, apiKeyEnv: 'UNUSED_FIXTURE_KEY', batchSize: 32, timeoutMs: 30_000, maxRetries: 0,
      sendDimensions: true, documentPrefix: 'document:', queryPrefix: 'query:', geminiTaskMode: 'native',
    }, async () => 'benchmark-fixture-key')
    if (provider) {
      const embed = provider.embed.bind(provider)
      provider.embed = async (...args) => {
        const start = performance.now()
        try { return await embed(...args) } finally { phases.embeddingMs += performance.now() - start }
      }
    }
    try {
      console.error(`[search benchmark] ${chapters} chapters / ${mode}: first index`)
      const initialSync = await measureSync(fixture.book, provider)
      const cold = await measure(fixture.book, marker, provider)
      const coldIndexBytes = fs.statSync(path.join(fixture.book, '.webnovel/finalized-search.sqlite')).size
      const warm = []
      for (let iteration = 0; iteration < report.warmRepeats; iteration++) warm.push(await measure(fixture.book, marker, provider))
      console.error(`[search benchmark] ${chapters} chapters / ${mode}: content update`)
      const before = fs.statSync(fixture.target)
      fs.writeFileSync(fixture.target, fs.readFileSync(fixture.target, 'utf8').replace(marker, changedMarker))
      fs.utimesSync(fixture.target, before.atime, before.mtime)
      const updateSync = await measureSync(fixture.book, provider)
      const update = await measure(fixture.book, changedMarker, provider)
      if (provider) {
        assert.equal(warm[0].index.embedded, 0)
        assert.equal(warm[0].index.reused, cold.index.chunks)
        assert.equal(update.documentsSent, 0)
        assert.ok(updateSync.generated > 0 && updateSync.generated < cold.index.chunks)
      }
      report.cases.push({ chapters, mode, sourceBytes: fixture.sourceBytes, hanCharacters: fixture.hanCharacters, initialSync, updateSync, cold, warm,
        warmMedianMs: [...warm.map(row => row.elapsedMs)].sort((a, b) => a - b)[1], update, coldIndexBytes,
        updatedIndexBytes: fs.statSync(path.join(fixture.book, '.webnovel/finalized-search.sqlite')).size })
    } finally { await provider?.close() }
  }
  const json = JSON.stringify(report, null, 2) + '\n'
  if (output) fs.writeFileSync(path.resolve(output), json)
  console.log(json)
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  if (!path.resolve(root).startsWith(path.resolve(tempPrefix))) throw new Error('Unexpected benchmark cleanup path')
  removeSync(root)
}
