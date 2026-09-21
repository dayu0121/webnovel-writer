import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { canonicalizePath, stripDevicePrefix } from '../gate/canonical'
import { parseDocument } from '../repo/frontmatter'
import type { SupplementSource } from './sections'

export const materialHash = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex')

/** Same physical-file guarantees as finalized retrieval, synchronous for book transactions. */
export function readMaterialFile(base: string, relative: string): { text: string; hash: string } {
  const parts = relative.split('/')
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || parts.some(part => !part || part.startsWith('.') || part === 'node_modules' || /[\x00-\x1f:]/.test(part) || /[. ]$/.test(part))) throw new Error(`材料路径不合法：${relative}`)
  const target = path.join(base, ...parts)
  const checkPath = () => {
    if (stripDevicePrefix(fs.realpathSync.native(target)) !== target) throw new Error(`材料路径包含链接或别名：${relative}`)
  }
  checkPath()
  const initial = fs.lstatSync(target)
  if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1) throw new Error(`材料不是独立普通文件：${relative}`)
  const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    const opened = fs.fstatSync(fd)
    if (opened.dev !== initial.dev || opened.ino !== initial.ino || opened.nlink !== 1) throw new Error(`材料读取时被替换：${relative}`)
    const bytes = fs.readFileSync(fd)
    checkPath()
    const after = fs.fstatSync(fd)
    const current = fs.lstatSync(target)
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
      || current.dev !== opened.dev || current.ino !== opened.ino || current.nlink !== 1) throw new Error(`材料读取时已变化：${relative}`)
    if (bytes.includes(0)) throw new Error(`材料不是UTF-8文本：${relative}`)
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), hash: materialHash(bytes) }
  } finally { fs.closeSync(fd) }
}

export function readSupplementSource(bookRoot: string, source: SupplementSource, chapter: number) {
  if (!source || (source.域 !== '本书' && source.域 !== '书房') || typeof source.路径 !== 'string') throw new Error('补充来源格式无效')
  if (!/\.(md|txt)$/i.test(source.路径) || path.posix.basename(source.路径).toLowerCase() === '索引.md'
    || /^草稿区\/(材料包|审核|定稿准备|批次)\//.test(source.路径)) throw new Error(`补充必须引用原文，不能把索引或机器工件作为证据：${source.路径}`)
  const root = canonicalizePath(bookRoot)
  // R20: books and the shared 书房 are siblings in the selected workspace.
  const base = source.域 === '本书' ? root : path.join(path.dirname(root), '书房')
  const read = readMaterialFile(base, source.路径)
  const lines = read.text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  if (!lines.length) throw new Error(`补充来源为空：${source.路径}`)
  const start = source.起行 ?? 1
  const end = source.终行 ?? lines.length
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > lines.length) throw new Error(`补充原文行范围无效：${source.路径}`)
  if (source.域 === '本书') {
    const pathChapter = /(?:定稿\/卷\d+|章细纲)\/(\d{4})-/.exec(source.路径)?.[1]
    const parsed = parseDocument(read.text)
    const identity = parsed.ok ? parsed.data.fields['身份'] : undefined
    const fieldChapter = identity && typeof identity === 'object' ? (identity as Record<string, unknown>)['章'] : undefined
    const explicitChapter = typeof fieldChapter === 'number' || (typeof fieldChapter === 'string' && /^\d+$/.test(fieldChapter)) ? Number(fieldChapter) : 0
    const origin = parsed.ok && typeof parsed.data.fields['来源'] === 'string' ? parsed.data.fields['来源'] : ''
    const originChapter = /定稿\/卷\d+\/(\d{4})-/.exec(origin)?.[1]
    if ((pathChapter && Number(pathChapter) > chapter) || explicitChapter > chapter || (originChapter && Number(originChapter) > chapter)) throw new Error(`补充来源晚于目标章：${source.路径}`)
    let activeFactChapter = 0
    for (let i = 0; i < end; i++) {
      const fact = /^###\s+事实@第\s*(\d+)\s*章\s*$/.exec(lines[i]!.trim())
      if (fact) activeFactChapter = Number(fact[1])
      else if (/^#{2,3}\s+/.test(lines[i]!.trim()) && !/^#{2,3}\s+正文\s*$/.test(lines[i]!.trim())) activeFactChapter = 0
      const provenance = /^\s*(?:[-*]\s*)?(?:来源|定稿落点)[：:].*?定稿\/卷\d+\/(\d{4})-/.exec(lines[i]!)
      if (provenance) activeFactChapter = Math.max(activeFactChapter, Number(provenance[1]))
      if (i >= start - 1 && activeFactChapter > chapter) throw new Error(`补充范围包含未来事实：${source.路径}:${i + 1}`)
    }
  }
  return { text: lines.slice(start - 1, end).join(''), source: { ...source, 起行: start, 终行: end, 读取哈希: read.hash }, sourceHash: read.hash }
}
