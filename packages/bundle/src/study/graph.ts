import { entryChapterNo, LEDGER_NAMES, parseDocument, parseLedgerHistory } from '@webnovel/core'
import type { TreeEntry } from './types'
import type { StoryGraph, StoryGraphEdge, StoryGraphRecord } from './graph-types'

interface GraphSource {
  bookId: string
  bookName: string
  maxChapter: number
  list(path: string): readonly TreeEntry[]
  read(path: string): string
}
const chapter = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : undefined
  if (typeof value !== 'string') return undefined
  const match = /^(?:第\s*)?(\d+)(?:\s*章)?$/.exec(value.trim())
  return match && Number.isSafeInteger(Number(match[1])) && Number(match[1]) > 0 ? Number(match[1]) : undefined
}
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const terms = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(terms)
  : typeof value === 'string' ? value.split(/[、,，;]/).map(item => item.trim()).filter(Boolean) : []
const wiki = (body: string): string[] => [...body.matchAll(/\[\[([^\]\n]+)\]\]/g)].map(match => match[1]!.split('|')[0]!.trim())
const identity = (name: string) => name.trim().replace(/[\s「」『』【】（）()：:，,。！？!?]/g, '').toLowerCase()
const kindOf = (path: string) => path.includes('/人物档案/') ? '人物' : path.includes('/人物关系/') ? '关系'
  : path.includes('/组织与阵营/') ? '组织' : path.includes('/地点与空间/') ? '地点' : '设定'

/** A read-only projection of settled records. No model calls, co-occurrence edges or second graph store. */
export function readStoryGraph(source: GraphSource): StoryGraph {
  const records: StoryGraphRecord[] = [], edges: StoryGraphEdge[] = [], events: StoryGraphRecord[] = []
  const warnings: { path: string; message: string }[] = []
  const aliases = new Map<string, Set<string>>()
  const links: { record: StoryGraphRecord; targets: string[]; relation?: string; pair: boolean }[] = []
  const alias = (name: string, id: string) => { if (!name) return; const values = aliases.get(name) ?? new Set<string>(); values.add(id); aliases.set(name, values) }
  const strings = (fields: Readonly<Record<string, unknown>>) => Object.fromEntries(Object.entries(fields).filter((pair): pair is [string, string] => typeof pair[1] === 'string'))
  const fromFields = (id: string, label: string, kind: string, path: string, line: number, fields: Readonly<Record<string, unknown>>, body: string): StoryGraphRecord => ({
    id, label, kind, status: text(fields['状态']), plan: fields['性质'] === '计划',
    chapter: chapter(fields['起始章']) ?? chapter(fields['生效章']) ?? chapter(fields['章号']) ?? entryChapterNo({ 字段: strings(fields) }) ?? undefined,
    endChapter: chapter(fields['失效章']), revealChapter: chapter(fields['披露章']) ?? chapter(fields['揭示章']),
    source: { space: 'book:' + source.bookId, path }, line, preview: body.trim().slice(0, 600),
  })
  const scan = (path: string, depth = 0) => {
    if (depth > 12) { warnings.push({ path, message: '目录层级过深，未继续读取' }); return }
    let entries: readonly TreeEntry[]
    try { entries = source.list(path) } catch (error) {
      if ((error as { code?: unknown }).code !== 'not-found') warnings.push({ path, message: '该目录无法读取' })
      return
    }
    for (const entry of entries) {
      if (entry.error) { warnings.push({ path: entry.ref.path, message: entry.error }); continue }
      if (entry.directory) { scan(entry.ref.path, depth + 1); continue }
      if (!entry.name.endsWith('.md') || entry.name === '模块声明.md') continue
      try {
        const parsed = parseDocument(source.read(entry.ref.path))
        if (!parsed.ok) { warnings.push({ path: entry.ref.path, message: '文档字段无法解析' }); continue }
        const { fields, body } = parsed.data
        const label = text(fields['名称']) || entry.name.replace(/\.md$/, '')
        const record = fromFields('world:' + entry.ref.path, label, kindOf(entry.ref.path), entry.ref.path, 1, fields, body)
        records.push(record)
        for (const name of [label, entry.name, entry.ref.path, entry.ref.path.replace(/\.md$/, ''), ...terms(fields['别名'])]) alias(name, record.id)
        const pair = terms(fields['关系双方']).length ? terms(fields['关系双方']) : [text(fields['主体']), text(fields['客体'])].filter(Boolean)
        links.push({ record, targets: pair.length ? pair : [...terms(fields['关联人物']), ...wiki(body)], pair: pair.length === 2,
          relation: text(fields['关系']) || text(fields['关系类型']) || (record.kind === '关系' ? label : undefined) })
        if (record.kind === '关系' && !pair.length && !wiki(body).length) warnings.push({ path: entry.ref.path, message: '关系条目未记录明确两端；保留记录，不猜连线' })
      } catch { warnings.push({ path: entry.ref.path, message: '该条目无法安全读取' }) }
    }
  }
  scan('世界书')
  for (const category of LEDGER_NAMES) {
    const path = '账本/' + category + '.md'
    let raw: string
    try { raw = source.read(path) } catch (error) {
      if ((error as { code?: unknown }).code !== 'not-found') warnings.push({ path, message: '该账本无法读取' })
      continue
    }
    const parsed = parseLedgerHistory(raw, category, path)
    if (!parsed.ok) { warnings.push({ path, message: parsed.reason }); continue }
    for (const entry of parsed.entries) {
      const id = category === '时间线' ? 'event:' + path + ':' + entry.行号 : 'ledger:' + category + ':' + identity(entry.名称)
      const record = fromFields(id, entry.名称, category === '时间线' ? '事件' : category, path, entry.行号, entry.字段, entry.正文)
      records.push(record)
      if (category === '时间线') events.push(record)
      links.push({ record, targets: wiki(entry.正文), pair: false })
    }
  }
  const resolve = (target: string, path: string) => {
    const name = target.replace(/^\[\[|\]\]$/g, '').replace(/@\d+$/, '').replace(/\\/g, '/')
    const found = aliases.get(name)
    if (found?.size === 1) return [...found][0]
    warnings.push({ path, message: found?.size ? '同名或别名不唯一，未合并：' + name : '引用未找到对应实体：' + name })
    return undefined
  }
  for (const item of links) {
    const targets = [...new Set(item.targets.map(target => resolve(target, item.record.source.path)).filter((id): id is string => !!id))]
    if (item.pair && targets.length === 2) {
      edges.push({ ...item.record, id: 'relation:' + item.record.id, from: targets[0]!, to: targets[1]!, label: item.relation || item.record.label, relation: true })
    } else {
      for (const target of targets) if (target !== item.record.id) edges.push({ ...item.record, id: 'ref:' + item.record.id + ':' + target,
        from: item.record.id, to: target, label: item.record.kind === '事件' ? '参与记录' : '关联引用', relation: false })
    }
  }
  const maxChapter = Math.max(source.maxChapter, 1, ...records.map(item => item.chapter ?? 0), ...records.map(item => item.revealChapter ?? 0))
  return { bookId: source.bookId, bookName: source.bookName, maxChapter, records, edges, events, warnings }
}
