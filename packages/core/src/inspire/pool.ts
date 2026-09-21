/**
 * 作者层灵感池(PRD §3.1 / D46):挂作者层记忆·灵感类,随手记自动入池,可见可删。
 * 落工作范围 `书房/灵感池/`(拍板 6,2026-08-29 权威落点),不进书仓;跨会话只凭文件恢复。
 * 调用方以工作范围根为 authorRoot。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { assertSegment } from '../repo/paths'
import { removeSync } from '../repo/remove'

export const 灵感池相对目录 = '书房/灵感池'

export interface InspirationNote {
  readonly id: string
  readonly body: string
  readonly createdAt: string
}

export function poolDir(authorRoot: string): string {
  return path.join(authorRoot, ...灵感池相对目录.split('/'))
}

export function ingestNote(authorRoot: string, note: string): string {
  const id = nextNoteId()
  assertSegment(id, '灵感id')
  const dir = poolDir(authorRoot)
  fs.mkdirSync(dir, { recursive: true })
  const createdAt = new Date().toISOString()
  const text = serializeDocument({ 状态: '候选', 身份: id, 来源快照: createdAt }, note)
  fs.writeFileSync(path.join(dir, `${id}.md`), text, 'utf-8')
  return id
}

export function listNotes(authorRoot: string): readonly InspirationNote[] {
  const dir = poolDir(authorRoot)
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: InspirationNote[] = []
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const id = name.slice(0, -3)
    const abs = path.join(dir, name)
    let text: string
    try {
      text = fs.readFileSync(abs, 'utf-8')
    } catch {
      continue
    }
    const r = parseDocument(text)
    const body = (r.ok ? r.data.body : text).replace(/\r\n/g, '\n').replace(/\n+$/, '')
    const createdAt = r.ok && typeof r.data.fields['来源快照'] === 'string'
      ? r.data.fields['来源快照']
      : ''
    out.push({ id, body, createdAt })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function deleteNote(authorRoot: string, id: string): boolean {
  assertSegment(id, '灵感id')
  const abs = path.join(poolDir(authorRoot), `${id}.md`)
  if (!fs.existsSync(abs)) return false
  removeSync(abs)
  return true
}

export function searchNotes(authorRoot: string, query: string): readonly InspirationNote[] {
  return listNotes(authorRoot).filter((n) => n.body.includes(query) || n.id.includes(query))
}

function nextNoteId(): string {
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 6)
  return `n${t}${r}`
}
