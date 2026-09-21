import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  assembleMaterials, deriveChapterFacts, listChapters, loadMaterialPackage,
  paths, queryLedger, scanChapter, serializeDocument, syncFinalizedIndex,
  searchFinalized, writeAuthorMemory,
} from '../src/index'
import { makeFixtureBook } from './helpers/fixture-book'
import type { EmbeddingProvider } from '../src/retrieval/types'

/** 确定性嵌入桩（无网络）：文本码位伪向量，供容量基准测量索引构建路径，不冒充真实嵌入质量。 */
const stubVec = (text: string): readonly number[] => {
  const v = [0, 0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < text.length; i++) v[i % 8] += text.charCodeAt(i) % 997
  return v.map((x) => x / 1000)
}
const stubProvider: EmbeddingProvider = {
  metadata: { provider: 'stub', model: 'stub-8d', dimensions: 8, revision: 'v1', batchSize: 64 },
  embed: (inputs) => Promise.resolve(inputs.map((input) => stubVec(input.text))),
  embedBatch: (inputs) => Promise.resolve(inputs.map((input) => stubVec(input.text))),
}

/**
 * 10B 合成容量基准（任务 09-06-longform-scale-validation）。
 * 固定种子、不请求模型；200/1000 章、约 200 万字书仓。
 * 默认跳过以免拖慢常规测试；显式运行：SCALE_BENCH=1 pnpm exec vitest run packages/core/tests/scale-benchmark.spec.ts
 */

const RUN = process.env['SCALE_BENCH'] === '1'
const KEEP = process.env['KEEP_10B'] === '1'
const REPS = 5

const roots: string[] = []
afterAll(() => {
  if (KEEP) return
  for (const root of roots) {
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 300 }) } catch { /* %TEMP% 残留无害 */ }
  }
})

interface BenchResult { op: string; book: string; median: number; p95: number; detail?: string }
const results: BenchResult[] = []

function timeOp(op: string, book: string, fn: () => unknown, detail?: string): void {
  const times: number[] = []
  for (let i = 0; i < REPS; i++) {
    const t0 = performance.now()
    fn()
    times.push(performance.now() - t0)
  }
  times.sort((a, b) => a - b)
  results.push({ op, book, median: times[Math.floor(times.length / 2)]!, p95: times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)]!, detail })
}

function makeBook(label: string, chapters: number, opts?: { 记忆条数?: number; 卷摘要?: number }): { root: string; buildMs: number } {
  const t0 = performance.now()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `webnovel-10b-${label}-`))
  roots.push(root)
  makeFixtureBook(root, chapters, { 每卷章数: 50 })
  // 夹具补记：末章须见于本卷卷纲脚手架（真实书里卷纲随章滚动补记）
  const lateVol = Math.ceil(chapters / 50)
  fs.appendFileSync(path.join(root, paths.卷纲(lateVol)), `\n- 卷末收束：章${chapters} 〔已确认〕\n`, 'utf-8')
  const memoryCount = opts?.记忆条数 ?? 0
  for (let i = 1; i <= memoryCount; i++) {
    const r = writeAuthorMemory(root, {
      名称: `决策样本${String(i).padStart(3, '0')}`, 类: '决策',
      描述: `第${i}条作者决策的一句话描述`,
      标签: ['容量夹具'],
      来源: '对谈共创', 正文: `这是第${i}条作者决策的正文，记录当时的判断依据与适用边界。`.repeat(3),
    })
    if (!r.ok) throw new Error(`记忆写入失败:${r.reason}`)
  }
  for (let v = 1; v <= (opts?.卷摘要 ?? 0); v++) {
    const rel = paths.卷摘要(v)
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), `# 卷摘要\n\n卷${v}的阶段摘要：主线推进与伏笔状态。\n`.repeat(20), 'utf-8')
  }
  // 加厚定稿章至约 2500 字/章（1000 章 ≈ 250 万字总定稿），保持确定性内容
  const finalizedDir = path.join(root, '定稿')
  const fatten = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) fatten(abs)
      else if (e.name.endsWith('.md') && !e.name.endsWith('.gitkeep')) {
        fs.appendFileSync(abs, `\n${'剧情依细纲推进，线索逐章埋设与回收。'.repeat(120)}\n`, 'utf-8')
      }
    }
  }
  fatten(finalizedDir)
  return { root, buildMs: performance.now() - t0 }
}

function charCount(root: string): number {
  let total = 0
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) walk(abs)
      else if (e.name.endsWith('.md')) total += fs.readFileSync(abs, 'utf-8').length
    }
  }
  walk(path.join(root, '定稿'))
  return total
}

async function benchBook(label: string, root: string, chapters: number): Promise<void> {
  const late = { 卷: Math.ceil(chapters / 50), 章: chapters, 章名: `章${chapters}` }
  const early = { 卷: 1, 章: 1, 章名: '章1' }

  timeOp('listChapters', label, () => {
    const keys = listChapters(root)
    expect(keys.filter((k) => k.章 > 0).length).toBeGreaterThanOrEqual(chapters)
  })
  timeOp('scanChapter+derive(末章)', label, () => {
    const sc = scanChapter(root, late)
    expect(sc.key.章).toBe(late.章)
    expect(deriveChapterFacts(sc).事实项.length).toBeGreaterThan(0)
  })
  timeOp('assembleMaterials(末章)', label, () => {
    const r = assembleMaterials(root, late)
    expect(r.ok, r.gaps.join(';')).toBe(true)
  }, '十段+窗口切片')
  timeOp('loadMaterialPackage(末章)', label, () => {
    const pkg = loadMaterialPackage(root, late)
    expect(pkg.问题, pkg.问题.join(';')).toEqual([])
    expect(Object.keys(pkg.段).length).toBeGreaterThan(0)
  })
  timeOp('queryLedger(全部线索)', label, () => {
    const r = queryLedger(root, { 名称: '线索' })
    expect(r.ok).toBe(true)
  })
  timeOp('queryLedger(章上限=50)', label, () => {
    const r = queryLedger(root, { 名称: '线索', 章上限: 50 })
    expect(r.ok).toBe(true)
  })
  const syncTimes: number[] = []
  let syncDetail = ''
  for (let i = 0; i < REPS; i++) {
    const t0 = performance.now()
    const syncResult = await syncFinalizedIndex(root, { getProvider: () => stubProvider })
    if (!syncResult.ok) throw new Error(`索引同步失败:${syncResult.failure.message}`)
    syncTimes.push(performance.now() - t0)
    syncDetail = `索引${syncResult.state.chapters}章/场景生成${syncResult.state.generated}`
  }
  syncTimes.sort((a, b) => a - b)
  results.push({ op: 'syncFinalizedIndex(全量重建)', book: label, median: syncTimes[Math.floor(syncTimes.length / 2)]!, p95: syncTimes[syncTimes.length - 1]!, detail: syncDetail })
  const searchTimes: number[] = []
  for (let i = 0; i < REPS; i++) {
    const t0 = performance.now()
    const r = await searchFinalized(root, { query: '城门', mode: 'keyword' })
    expect(r.ok).toBe(true)
    searchTimes.push(performance.now() - t0)
  }
  searchTimes.sort((a, b) => a - b)
  results.push({ op: 'searchFinalized(关键词)', book: label, median: searchTimes[Math.floor(searchTimes.length / 2)]!, p95: searchTimes[searchTimes.length - 1]!, detail: syncDetail })
  // 历史章界不变量：首章与末章材料均不得串入未来章事实
  expect(assembleMaterials(root, early).ok).toBe(true)
  const latePkg = loadMaterialPackage(root, late)
  expect(latePkg.问题).toEqual([])
  const lateText = JSON.stringify(latePkg.段)
  expect(/第9\d{3}章|事实@第9\d{3}章/.test(lateText)).toBe(false)
  results.push({ op: 'invariant:历史章界', book: label, median: 0, p95: 0, detail: '通过' })
}

describe.skipIf(!RUN)('10B 合成容量基准（200/1000 章）', () => {
  it('200 章书', async () => {
    const small = makeBook('200', 200, { 记忆条数: 30, 卷摘要: 4 })
    await benchBook('200章', small.root, 200)
    writeReport({ 小书: { chapters: 200, 定稿字数: charCount(small.root), buildMs: Math.round(small.buildMs), 记忆: 30, 卷摘要: 4 } }, '200')
  }, 300_000)

  it('1000 章书', async () => {
    const big = makeBook('1000', 1000, { 记忆条数: 200, 卷摘要: 20 })
    await benchBook('1000章', big.root, 1000)
    writeReport({ 大书: { chapters: 1000, 定稿字数: charCount(big.root), buildMs: Math.round(big.buildMs), 记忆: 200, 卷摘要: 20 } }, '1000')
  }, 600_000)
})

function writeReport(fixture: Record<string, unknown>, tag: string): void {
  const report = {
    date: '2026-09-19',
    node: process.version,
    platform: process.platform,
    reps: REPS,
    fixture,
    results: [...results],
    roots: KEEP ? roots : undefined,
  }
  fs.mkdirSync('.tmp/scale-benchmark', { recursive: true })
  fs.writeFileSync(`.tmp/scale-benchmark/10b-benchmark-results-${tag}-2026-09-19.json`, JSON.stringify(report, null, 2) + '\n')
  for (const r of results) console.log(`${r.book} ${r.op}: median ${r.median.toFixed(1)}ms p95 ${r.p95.toFixed(1)}ms ${r.detail ?? ''}`)
}
