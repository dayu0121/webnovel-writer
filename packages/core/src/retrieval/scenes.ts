import * as fs from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { renameSync } from '../repo/rename'
import { checkedIndexFile } from './state'
import { SearchError, type SearchChunk } from './types'

export const SCENE_RULE_VERSION = 'scene-paragraph-ends-v1'
export const SCENE_CACHE_PATH = '.webnovel/finalized-scenes.json'
export const sceneBodyHash = (body: string) => createHash('sha256').update(body).digest('hex')
export interface ProseParagraph { readonly start: number; readonly end: number; readonly text: string }
export interface SceneRecord {
  readonly rule: string
  readonly paragraphs: number
  readonly ends: readonly number[]
  readonly model: string
  readonly status: 'ready' | 'fallback'
  readonly reason?: string
}
export type SceneRecords = Record<string, SceneRecord>

/** Blank-line delimiters remain part of their source paragraph, preserving exact offsets. */
export function proseParagraphs(body: string): ProseParagraph[] {
  const result: ProseParagraph[] = []
  let start = 0
  for (const match of body.matchAll(/\n[ \t]*\n(?:[ \t]*\n)*/g)) {
    const end = match.index! + match[0].length
    const text = body.slice(start, end)
    if (!text.trim()) continue
    result.push({ start, end, text })
    start = end
  }
  if (body.slice(start).trim()) result.push({ start, end: body.length, text: body.slice(start) })
  else if (result.length && result[result.length - 1]!.end !== body.length) {
    const last = result.pop()!
    result.push({ ...last, end: body.length, text: body.slice(last.start) })
  }
  return result
}

export function validateSceneEnds(value: unknown, count: number): readonly number[] {
  if (!Array.isArray(value) || count < 1 || value.length < 1 || value.length > count) throw new SearchError('invalid-scenes', '场景边界数量无效')
  let previous = 0
  for (let index = 0; index < value.length; index++) {
    const end: unknown = value[index]
    if (typeof end !== 'number' || !Number.isSafeInteger(end) || end <= previous || end > count) throw new SearchError('invalid-scenes', '场景边界须严格递增且覆盖原段落')
    previous = end
  }
  if (previous !== count) throw new SearchError('invalid-scenes', '场景边界未覆盖全部段落')
  return [...value] as number[]
}

/** This cache is never cleared by rebuilding the search SQLite database. */
export function readSceneRecords(root: string): SceneRecords {
  try {
    const filename = checkedIndexFile(root, SCENE_CACHE_PATH)
    if (fs.statSync(filename).size > 16 * 1024 * 1024) throw new Error('oversize')
    const data = JSON.parse(fs.readFileSync(filename, 'utf8')) as { schema?: unknown; records?: unknown }
    if (data?.schema !== 1 || !data.records || typeof data.records !== 'object' || Array.isArray(data.records)) throw new Error('schema')
    const records = data.records as SceneRecords
    for (const [hash, record] of Object.entries(records)) {
      if (!/^[a-f0-9]{64}$/.test(hash) || !record || typeof record !== 'object' || !['ready', 'fallback'].includes(record.status)
        || typeof record.model !== 'string' || typeof record.rule !== 'string' || !Number.isSafeInteger(record.paragraphs) || record.paragraphs < 1
        || (record.reason !== undefined && typeof record.reason !== 'string')) throw new Error('record')
      if (record.status === 'ready') validateSceneEnds(record.ends, record.paragraphs)
      else if (!Array.isArray(record.ends) || record.ends.length) throw new Error('fallback')
    }
    return records
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    if (error instanceof SearchError && error.code === 'unsafe-cache') throw error
    throw new SearchError('scene-cache-error', '场景缓存无法读取，已保留原文件；请检查缓存或权限')
  }
}

/** Caller holds the short book lock and has verified source bytes and task generation. */
export function writeSceneRecords(root: string, records: SceneRecords): void {
  const filename = checkedIndexFile(root, SCENE_CACHE_PATH)
  const text = JSON.stringify({ schema: 1, records }) + '\n'
  if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new SearchError('scene-cache-error', '场景缓存超过容量，已保留原记录')
  const temporary = filename + '.' + randomUUID() + '.tmp'
  try {
    fs.writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 })
    checkedIndexFile(root, SCENE_CACHE_PATH)
    renameSync(temporary, filename)
  } finally { try { fs.unlinkSync(temporary) } catch { /* Renamed or not created. */ } }
}

export function currentSceneRecord(records: SceneRecords, hash: string, paragraphs: number): SceneRecord | undefined {
  const record = records[hash]
  return record?.rule === SCENE_RULE_VERSION && record.paragraphs === paragraphs ? record : undefined
}

export function sceneChunks(relative: string, hash: string, body: string, precedingLines: number, record: SceneRecord): SearchChunk[] {
  const paragraphs = proseParagraphs(body)
  validateSceneEnds(record.ends, paragraphs.length)
  const chunks: SearchChunk[] = []
  const line = (offset: number) => precedingLines + body.slice(0, offset).split('\n').length
  const lastLine = (offset: number) => precedingLines + body.slice(0, offset).replace(/\n$/, '').split('\n').length
  let sceneStart = 0
  for (const finalParagraph of record.ends) {
    const sceneEnd = paragraphs[finalParagraph - 1]!.end
    const scene = { id: sceneBodyHash(relative + '\0' + hash + '\0scene\0' + sceneStart), startLine: line(sceneStart), endLine: lastLine(sceneEnd) }
    let start = sceneStart
    while (start < sceneEnd) {
      let end = Math.min(sceneEnd, start + 800)
      if (end < sceneEnd) {
        const boundary = paragraphs.filter(item => item.end > start + 400 && item.end <= end).at(-1)
        if (boundary) end = boundary.end
        if (/^[\uDC00-\uDFFF]$/.test(body[end]!)) end--
      }
      const text = body.slice(start, end)
      if (text.trim()) chunks.push({ id: sceneBodyHash(relative + '\0' + hash + '\0' + start + '\0' + SCENE_RULE_VERSION + '\0' + sceneEnd),
        path: relative, start, end, text, startLine: line(start), endLine: lastLine(end), scene })
      if (end === sceneEnd) break
      const overlap = end - 256
      const boundary = paragraphs.find(item => item.start >= overlap && item.start > start && item.start < end)
      start = boundary?.start ?? Math.max(start + 1, overlap)
      if (/^[\uDC00-\uDFFF]$/.test(body[start]!)) start--
    }
    sceneStart = sceneEnd
  }
  return chunks
}
