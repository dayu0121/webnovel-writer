import { performance } from 'node:perf_hooks'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { register } from 'node:module'
// Node ≥22.6 类型剥离直接跑源码:不依赖构建产物,`pnpm build` 是纯类型门禁(dsh 同款:
// tsc 只做聚合类型检查,产物由打包器产出——见 08-22 本地集成踩坑记录 #12)。
// 仓内源码是无扩展名相对导入,Node ESM 解析不了,先挂补 .ts 的解析钩子再动态导入。
register('./strip-types-loader.mjs', import.meta.url)
const { buildRefGraph, analyzeImpact } = await import('../packages/core/src/impact/index.ts')

// ── fixture:1000 章 + 200 条设定(4 层树)= 1200 文件 ─────────────────────────
// 设定树:`设定/类X/子Y/条N.md`,每条引用它的上一条(条N-5),每层 5 条成 40 级链;
// 1000 章各引用一条设定。预期总边数 = 195(设定链)+ 1000(章→设定)= 1195。
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-benchmark-impact-'))
const SETTING_COUNT = 200
const CHAPTER_COUNT = 1000
const doc = (fields, body) => {
  const fm = Object.entries(fields)
    .map(([k, v]) => (Array.isArray(v) ? `${k}:\n${v.join('\n')}` : `${k}: ${v}`))
    .join('\n')
  return fm === '' ? `${body}\n` : `---\n${fm}\n---\n${body}\n`
}
const ref = (p) => `  - 来源:${p}@1`
const settingRel = (i) => `设定/类${i % 5}/子${Math.floor(i / 5) % 5}/条${i}.md`
for (let i = 0; i < SETTING_COUNT; i++) {
  const rel = settingRel(i)
  const fields = i >= 5 ? { 来源引用: [ref(settingRel(i - 5))] } : {}
  fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), doc(fields, `设定 ${i}\n`))
}
for (let i = 0; i < CHAPTER_COUNT; i++) {
  const rel = `定稿/卷01/${String(i + 1).padStart(4, '0')}-章.md`
  const fields = { 状态: '已定稿', 来源引用: [ref(settingRel(i % SETTING_COUNT))] }
  fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), doc(fields, `第 ${i + 1} 章正文\n`))
}
const EXPECTED_EDGES = SETTING_COUNT - 5 + CHAPTER_COUNT

// ── fixture 探针(取数前必须先跑,不满足即抛不出数)──────────────────────────
// 提案 §1.1 的数字前两次都测错:fixture 的 来源引用 漏了 @版本 导致 parseSourceRef
// 全返回 null,等于拿「有效索引」比「什么都没找到的扫描」。此探针防重犯。
function probe(graph) {
  let forward = 0
  for (const list of graph.forward.values()) forward += list.length
  let reverse = 0
  for (const list of graph.reverse.values()) reverse += list.length
  if (forward !== EXPECTED_EDGES || reverse !== EXPECTED_EDGES) {
    throw new Error(`探针失败:正/反边数 ${forward}/${reverse} ≠ 预期 ${EXPECTED_EDGES}(检查 fixture 是否漏 @版本 或解析失败)`)
  }
  if (graph.悬空引用.length !== 0) throw new Error(`探针失败:悬空引用 ${graph.悬空引用.length} ≠ 0(fixture 应自洽)`)
  if (graph.解析失败.length !== 0) throw new Error(`探针失败:解析失败 ${graph.解析失败.length} ≠ 0`)
}

// 一、一次扫描建正/反图(R1 的收益,也是 D1 的成立前提)
let start = performance.now()
const graph = buildRefGraph(root)
const buildMs = performance.now() - start
probe(graph)

// 二、图建好后走 BFS 闭包(证明闭包本身不是瓶颈)
start = performance.now()
analyzeImpact(root, '设定/类0/子0/条0.md', { graph })
const closureMs = performance.now() - start

// 三、逐跳重扫(稻草人对照)——没人会那样写,只作对照
function naiveOneHop(dir = root, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) naiveOneHop(abs, acc)
    else if (entry.isFile() && entry.name.endsWith('.md')) acc.push(path.relative(root, abs).replace(/\\/g, '/'))
  }
  return acc
}
function naiveRescan(changed) {
  // 逐跳重扫的稻草人:每扩一跳就全仓重扫一遍,拿本轮前沿当命中集合
  const seen = new Set([changed])
  for (let grew = true; grew;) {
    grew = false
    const frontier = new Set(seen)
    for (const rel of naiveOneHop()) {
      if (seen.has(rel)) continue
      const text = fs.readFileSync(path.join(root, rel), 'utf8')
      const m = /^---\n([\s\S]*?)\n---/.exec(text)
      if (m === null) continue
      const refs = [...m[1].matchAll(/来源:([^@\n]+)@\d+/g)].map((x) => x[1])
      if (refs.some((r) => frontier.has(r))) {
        seen.add(rel)
        grew = true
      }
    }
  }
  return seen
}
start = performance.now()
const naiveSize = naiveRescan('设定/类0/子0/条0.md').size
const naiveMs = performance.now() - start

fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
console.log(JSON.stringify({
  files: SETTING_COUNT + CHAPTER_COUNT,
  edges: EXPECTED_EDGES,
  naiveClosureNodes: naiveSize,
  buildGraphMs: Number(buildMs.toFixed(3)),
  closureMs: Number(closureMs.toFixed(3)),
  naiveRescanMs: Number(naiveMs.toFixed(1)),
  note: 'naiveRescanMs 是逐跳重扫的稻草人对照,没人会那样写;ADR 触发条件:真实调用点延迟超 300ms 或出现热路径消费方,才回头上快照层(拍板 D1)',
}))
