/**
 * 影响分析(插件规格 §4.1/§6 不变量 3):只认书仓中真实来源引用,沿反向边走传递闭包。
 * 该服务不维护第二套状态;**影响面现算呈报,不落盘**(拍板 7,2026-08-29:
 * 原 markImpacted 把下游状态覆写为「需复核」的落盘通道退役——裁决通过后
 * 受影响未定稿下游同批整改、整批一次确认一次 `design:` 提交;已定稿下游走吃书补偿)。
 * 现算不缓存(拍板 D1,2026-09-02):每次调用一次 walkMarkdown 建正/反图、走完闭包、
 * 丢弃——无快照、无状态机、无 watcher、无 timer、无常驻句柄,过期在构造上不可能。
 * 节点键=规范化后的仓内相对路径(拍板 D2);悬空引用如实报出、不猜改名(拍板 D3)。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseDocument } from '../repo/frontmatter'
import { parseSourceRef } from '../repo/sourceRef'

/**
 * 节点键:规范化后的仓内相对路径(拍板 D2)。branded 防未规范化路径混入当键。
 */
declare const nodeKeyBrand: unique symbol
export type NodeKey = string & { readonly [nodeKeyBrand]: 'NodeKey' }

/** 分区(格式规格 §2.1/§9.1:路径前缀即真源区分区)。 */
export type 分区 = '真源未定稿' | '草稿区' | '已定稿'

/** 分区判定单一函数:`定稿/`→已定稿、`草稿区/`→草稿区、其余→真源未定稿。 */
export function zoneOf(key: NodeKey | string): 分区 {
  if (key.startsWith('定稿/')) return '已定稿'
  if (key.startsWith('草稿区/')) return '草稿区'
  return '真源未定稿'
}

/**
 * 节点键规范化单一入口(R10):`\`→`/`、不折叠大小写(git 区分大小写且是真源)、
 * NFC 规范化(跨平台 clone 不分裂节点)、拒 `..`/绝对路径/盘符、posix.normalize。
 * 不合法返回 null。
 */
export function normalizeNodeKey(rel: string): NodeKey | null {
  const value = rel.replace(/\\/g, '/').trim().normalize('NFC')
  if (value === '' || value.includes('..') || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return null
  return path.posix.normalize(value) as NodeKey
}

/** 一条引用边:from 引用 to。source 存原始行,取证用。 */
export interface Edge {
  readonly from: NodeKey
  readonly to: NodeKey
  readonly source: string
  readonly version: string
  readonly field: '来源引用' | '来源细纲版本'
}

/** 悬空引用:from 引用了仓内不存在的 to(R4,如实报出,不静默)。 */
export interface DanglingRef {
  readonly from: NodeKey
  readonly to: NodeKey
  readonly source: string
  readonly version: string
  readonly field: Edge['field']
}

/** 解析失败:该文件的边无法入图(R11,收进报告,不静默跳过)。 */
export interface ParseFailure {
  readonly rel: string
  readonly detail: string
}

/** 一次扫描建出的正/反图 + 悬空引用 + 解析失败(拍板 D1:不缓存,调用方每次现建)。 */
export interface RefGraph {
  readonly forward: ReadonlyMap<NodeKey, readonly Edge[]>
  readonly reverse: ReadonlyMap<NodeKey, readonly Edge[]>
  readonly 悬空引用: readonly DanglingRef[]
  readonly 解析失败: readonly ParseFailure[]
  readonly 提示: readonly string[]
}

function parseOutlineVersionRef(raw: unknown): { path: string; version: string; raw: string } | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (t === '') return null
  const m = /^(.+?)@([^/@]+)$/.exec(t)
  if (m) return { path: m[1]!, version: m[2]!, raw: t }
  return { path: t, version: '', raw: t }
}

/**
 * 一次 walkMarkdown 建正/反图(R1,算法修复:禁止闭包推进时重复扫仓)。
 * 边读两处来源字段:`来源引用`(各形态)与 `来源细纲版本`(R12:定稿章→确认细纲
 * 的唯一边;缺 @版本 仍建边、计入提示;来源快照 形状不一,不当边读)。
 * frontmatter 解析失败、来源引用语法错、路径不合法均收进 解析失败(R11)。
 * 悬空引用 = 被引用的键减去实际存在的文件,逐个 existsSync(不限 .md)(R4)。
 */
export function buildRefGraph(bookRoot: string): RefGraph {
  const edges: Edge[] = []
  const 解析失败: ParseFailure[] = []
  const 提示: string[] = []
  for (const rel of walkMarkdown(bookRoot)) {
    const text = safeRead(bookRoot, rel)
    if (text === null) {
      解析失败.push({ rel, detail: '文件不可读' })
      continue
    }
    const doc = parseDocument(text)
    if (!doc.ok) {
      解析失败.push({ rel, detail: doc.detail })
      continue
    }
    const from = normalizeNodeKey(rel)
    if (from === null) {
      解析失败.push({ rel, detail: '路径无法规范化' })
      continue
    }
    const fields = doc.data.fields
    for (const line of sourceLines(fields)) {
      const parsed = parseSourceRef(line.startsWith('来源') ? line : `来源:${line}`)
      if (parsed === null) {
        解析失败.push({ rel, detail: `来源引用语法无法解析:「${line}」` })
        continue
      }
      if (parsed.kind !== '仓内') continue // 知识库/作者自定义/对谈共创 无仓内边
      const to = normalizeNodeKey(parsed.path)
      if (to === null) {
        解析失败.push({ rel, detail: `来源引用路径不合法:「${line}」` })
        continue
      }
      edges.push({ from, to, source: line, version: parsed.version, field: '来源引用' })
    }
    if (fields['来源细纲版本'] !== undefined) {
      const ref = parseOutlineVersionRef(fields['来源细纲版本'])
      if (ref === null) {
        提示.push(`「${rel}」的 来源细纲版本 形状异常(应为 <路径>@<版本>),未建边`)
      } else {
        const to = normalizeNodeKey(ref.path)
        if (to === null) {
          解析失败.push({ rel, detail: `来源细纲版本 路径不合法:「${ref.raw}」` })
        } else {
          if (ref.version === '') 提示.push(`「${rel}」的 来源细纲版本 缺 @版本,边已建但版本未知`)
          edges.push({ from, to, source: ref.raw, version: ref.version, field: '来源细纲版本' })
        }
      }
    }
  }
  // 排序保证跨平台确定性(walk 顺序依赖文件系统),再按 (from,to) 去重:重复是
  // 作者手改的痕迹,计提示但不让闭包多走一遍
  edges.sort((a, b) =>
    a.from < b.from ? -1 : a.from > b.from ? 1
    : a.to < b.to ? -1 : a.to > b.to ? 1
    : a.field < b.field ? -1 : a.field > b.field ? 1
    : 0)
  const deduped: Edge[] = []
  const seenPairs = new Set<string>()
  for (const edge of edges) {
    const pair = `${edge.from}\u0000${edge.to}`
    if (seenPairs.has(pair)) {
      提示.push(`「${edge.from}」重复引用「${edge.to}」,只计一条`)
      continue
    }
    seenPairs.add(pair)
    deduped.push(edge)
  }
  const forward = new Map<NodeKey, Edge[]>()
  const reverse = new Map<NodeKey, Edge[]>()
  for (const edge of deduped) {
    const fwd = forward.get(edge.from)
    if (fwd) fwd.push(edge)
    else forward.set(edge.from, [edge])
    const rev = reverse.get(edge.to)
    if (rev) rev.push(edge)
    else reverse.set(edge.to, [edge])
  }
  const 悬空引用: DanglingRef[] = []
  for (const edge of deduped) {
    if (!fs.existsSync(path.join(bookRoot, edge.to))) {
      悬空引用.push({ from: edge.from, to: edge.to, source: edge.source, version: edge.version, field: edge.field })
    }
  }
  悬空引用.sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0)
  解析失败.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return { forward, reverse, 悬空引用, 解析失败, 提示 }
}

export interface ImpactReference {
  readonly relPath: NodeKey
  readonly source: string
  readonly version: string
  readonly field: Edge['field']
  readonly 分区: 分区
}

/** R1 纪律落在返回值形状上:报告里没有任何「该不该改」字段,只有事实。 */
export interface ImpactReport {
  readonly changed: NodeKey
  readonly references: readonly ImpactReference[]
  readonly 闭包逐跳: readonly (readonly ImpactReference[])[]
  readonly 已定稿命中: readonly (ImpactReference & { readonly 处置: '须走吃书补偿' })[]
  readonly 悬空引用: readonly DanglingRef[]
  readonly 解析失败: readonly ParseFailure[]
  readonly 提示: readonly string[]
  readonly 可入批次文件: readonly NodeKey[]
}

/** 变更路径入参归一:兼容带 `来源:` 前缀与 `@版本` 后缀的写法。 */
function normalizeChangedPath(changedPath: string): NodeKey | null {
  const value = changedPath.replace(/\\/g, '/').replace(/^来源\s*:\s*/, '').trim()
  return normalizeNodeKey(value.replace(/@[^/@]+$/, ''))
}

function walkMarkdown(root: string, dir = root): string[] {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return [] }
  const out: string[] = []
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkMarkdown(root, abs))
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(path.relative(root, abs).replace(/\\/g, '/'))
  }
  return out
}

function sourceLines(fields: Readonly<Record<string, unknown>>): string[] {
  const raw = fields['来源引用']
  if (typeof raw === 'string') return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (Array.isArray(raw)) return raw.filter((line): line is string => typeof line === 'string').map((line) => line.trim()).filter(Boolean)
  return []
}

function safeRead(root: string, rel: string): string | null {
  try { return fs.readFileSync(path.join(root, rel), 'utf8') } catch { return null }
}

/**
 * 走反向边的传递闭包(R2)。`已见` 集合是环/自环/重复边的统一收敛解;
 * `止于:'已定稿'`(默认)= 命中即停不是命中即丢:该节点进 `已定稿命中` 并标注
 * 「须走吃书补偿」,但不从它继续往下扩——已定稿章不是设计侧整改的传播源,它走
 * 吃书补偿另一条路。`最大跳数` 默认不限,靠 `已见` 天然收敛。
 * `graph` 可传入复用(D1 的 ADR 留口:将来上快照层只需包住 buildRefGraph)。
 */
export function analyzeImpact(
  bookRoot: string,
  changedPath: string,
  options?: {
    readonly 最大跳数?: number
    readonly 止于?: '已定稿' | null
    readonly graph?: RefGraph
  },
): ImpactReport {
  const changed = normalizeChangedPath(changedPath) ?? (changedPath.replace(/\\/g, '/').trim().normalize('NFC') as NodeKey)
  const graph = options?.graph ?? buildRefGraph(bookRoot)
  const 止于 = options?.止于 === undefined ? '已定稿' : options.止于
  const 最大跳数 = options?.最大跳数
  const 已见 = new Set<NodeKey>([changed])
  const 闭包逐跳: ImpactReference[][] = []
  const 已定稿命中: (ImpactReference & { readonly 处置: '须走吃书补偿' })[] = []
  let 前沿: NodeKey[] = [changed]
  let 跳 = 0
  while (前沿.length > 0 && (最大跳数 === undefined || 跳 < 最大跳数)) {
    跳 += 1
    const 本跳: ImpactReference[] = []
    const 下一层: NodeKey[] = []
    for (const 节点 of 前沿) {
      for (const 边 of graph.reverse.get(节点) ?? []) {
        if (已见.has(边.from)) continue
        已见.add(边.from)
        const ref: ImpactReference = {
          relPath: 边.from,
          source: 边.source,
          version: 边.version,
          field: 边.field,
          分区: zoneOf(边.from),
        }
        本跳.push(ref)
        if (ref.分区 === '已定稿') {
          已定稿命中.push({ ...ref, 处置: '须走吃书补偿' })
          if (止于 === '已定稿') continue
        }
        下一层.push(边.from)
      }
    }
    闭包逐跳.push(本跳)
    前沿 = 下一层
  }
  const references = 闭包逐跳[0] ?? []
  const 可入批次文件 = [...new Set(闭包逐跳.flat().filter((ref) => ref.分区 === '真源未定稿').map((ref) => ref.relPath))].sort()
  return {
    changed,
    references,
    闭包逐跳,
    已定稿命中,
    悬空引用: graph.悬空引用,
    解析失败: graph.解析失败,
    提示: graph.提示,
    可入批次文件,
  }
}


