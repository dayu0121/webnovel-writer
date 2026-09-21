/**
 * 作者层记忆写入器(拍板 4,2026-08-29;格式规格 §6 形态):落工作范围 `书房/作者记忆/`,
 * 一事一文件 + `索引.md` 由写入路径同步重建(判据四:索引是派生数据),`标签` 必填。
 * 作者层资产不进书仓、不走 `design:` 提交;新增不挂审批,改删按「生成模块」分档。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { assertSegment } from '../repo/paths'

export const 作者记忆相对目录 = '书房/作者记忆'
export const 作者记忆类别 = ['文风', '决策', '对话', '灵感'] as const
export type 作者记忆类 = (typeof 作者记忆类别)[number]

export interface AuthorMemoryInput {
  /** 条目标识(短横线小写语义,一事一文件的文件名)。 */
  readonly 名称: string
  /** 一行描述,专供召回判断。 */
  readonly 描述: string
  readonly 类: 作者记忆类
  /** 书名/卷/题材/维度等,供召回过滤与进度卡筛选;至少一条。 */
  readonly 标签: readonly string[]
  /** 章号或「对谈」。 */
  readonly 来源: string
  readonly 正文: string
}

export type AuthorMemoryResult =
  | { readonly ok: true; readonly relPath: string; readonly updated: boolean }
  | { readonly ok: false; readonly reason: string }

export function writeAuthorMemory(workspaceRoot: string, input: AuthorMemoryInput): AuthorMemoryResult {
  const 名称 = input.名称.trim()
  if (名称 === '' || 名称 === '索引') return { ok: false, reason: '条目名称必填且不得为「索引」' }
  try {
    assertSegment(名称, '条目名称')
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
  if (input.描述.trim() === '') return { ok: false, reason: '一行描述必填(供召回判断)' }
  if (!(作者记忆类别 as readonly string[]).includes(input.类)) {
    return { ok: false, reason: `类必须是 ${作者记忆类别.join('/')}` }
  }
  const 标签 = input.标签.map((t) => t.trim()).filter((t) => t !== '')
  if (标签.length === 0) return { ok: false, reason: '标签必填(书名/卷/题材/维度,供召回过滤)' }

  const dir = 作者记忆目录(workspaceRoot)
  fs.mkdirSync(dir, { recursive: true })
  const rel = `${作者记忆相对目录}/${名称}.md`
  const abs = path.join(dir, `${名称}.md`)
  const updated = fs.existsSync(abs)
  const text = serializeDocument(
    {
      名称,
      描述: input.描述.trim(),
      类: input.类,
      标签,
      来源: input.来源.trim(),
      生成模块: '模型',
    },
    input.正文,
  )
  fs.writeFileSync(abs, text, 'utf-8')
  rebuildIndex(dir)
  return { ok: true, relPath: rel, updated }
}

export function 作者记忆目录(workspaceRoot: string): string {
  return path.join(workspaceRoot, ...作者记忆相对目录.split('/'))
}

export interface AuthorMemoryEntry {
  readonly 名称: string
  readonly 描述: string
  readonly 类: string
  readonly 标签: readonly string[]
  readonly relPath: string
  readonly 正文: string
}

/** 枚举作者层记忆条目(召回/进度卡筛选用;索引损坏不挡,按文件实读)。 */
export function listAuthorMemory(workspaceRoot: string): readonly AuthorMemoryEntry[] {
  const dir = 作者记忆目录(workspaceRoot)
  let names: string[] = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: AuthorMemoryEntry[] = []
  for (const name of names.filter((n) => n.endsWith('.md') && n !== '索引.md').sort()) {
    let doc: ReturnType<typeof parseDocument>
    try {
      doc = parseDocument(fs.readFileSync(path.join(dir, name), 'utf-8'))
    } catch {
      continue
    }
    if (!doc.ok) continue
    out.push({
      名称: typeof doc.data.fields['名称'] === 'string' ? doc.data.fields['名称'] : name.replace(/\.md$/, ''),
      描述: typeof doc.data.fields['描述'] === 'string' ? doc.data.fields['描述'] : '',
      类: typeof doc.data.fields['类'] === 'string' ? doc.data.fields['类'] : '',
      标签: Array.isArray(doc.data.fields['标签']) ? (doc.data.fields['标签'] as unknown[]).map(String) : [],
      relPath: `${作者记忆相对目录}/${name}`,
      正文: doc.data.body,
    })
  }
  return out
}

/** 索引全量重建:一行一条 `- [标题](文件名.md) — 一句话钩子`;正文永不进索引。 */
export function rebuildAuthorMemoryIndex(workspaceRoot: string): string {
  const dir = 作者记忆目录(workspaceRoot)
  fs.mkdirSync(dir, { recursive: true })
  return rebuildIndex(dir)
}

function rebuildIndex(dir: string): string {
  const lines: string[] = ['# 作者记忆索引', '']
  let names: string[] = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    names = []
  }
  for (const name of names.filter((n) => n.endsWith('.md') && n !== '索引.md').sort()) {
    let doc: ReturnType<typeof parseDocument>
    try {
      doc = parseDocument(fs.readFileSync(path.join(dir, name), 'utf-8'))
    } catch {
      continue
    }
    if (!doc.ok) continue
    const 标题 = typeof doc.data.fields['名称'] === 'string' ? doc.data.fields['名称'] : name.replace(/\.md$/, '')
    const 钩子 = typeof doc.data.fields['描述'] === 'string' ? doc.data.fields['描述'] : ''
    lines.push(`- [${标题}](${name}) — ${钩子}`)
  }
  const idx = path.join(dir, '索引.md')
  fs.writeFileSync(idx, `${lines.join('\n')}\n`, 'utf-8')
  return idx
}
