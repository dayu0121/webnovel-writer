/**
 * 最小 Markdown 导出（任务 09-06-minimal-markdown-export）。
 *
 * 只算不写：computeExport 读取定稿真源，在内存中生成「定稿合集」与「来源清单」两份
 * 完整载荷；inspectExportTarget 对作者选定目录做只读检查。实际写盘由主 Agent 经原生
 * 文件工具完成（目标通常在书仓围栏外，属 R20 预留的提权情形），书仓事务锁不扩展到
 * 任意目录。导出确定性（无时间戳），同一书仓状态重复计算结果字节相同。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { canonicalizePath, isInsidePath } from '../gate/canonical'
import { parseDocument } from '../repo/frontmatter'
import { chapterNo, pad, validateSegment } from '../repo/paths'
import { extractVersionFields } from '../provenance'
import { materialHash, readMaterialFile } from '../assembly/source'

/** 导出范围：默认全书；卷限定单卷；起/止章按全书连续章号（含端点），可与卷叠加。 */
export interface ExportScope {
  readonly 卷?: number
  readonly 起章?: number
  readonly 止章?: number
}

export interface ExportChapter {
  readonly 卷: number
  readonly 章: number
  readonly 章名: string
  readonly 相对路径: string
  readonly 版本: number | null
  readonly 内容哈希: string
  readonly 字数: number
  readonly 正文: string
}

export interface ComputedExport {
  readonly ok: boolean
  readonly gaps: readonly string[]
  readonly 书名: string
  readonly 范围: string
  readonly 章列表: readonly ExportChapter[]
  readonly 合计字数: number
  readonly 合集文件: string
  readonly 清单文件: string
  readonly 合集: string
  readonly 清单: string
  readonly 合集哈希: string
}

export interface ExportTargetReport {
  readonly ok: boolean
  readonly 目标目录: string
  readonly 已存在: boolean
  readonly problems: readonly string[]
  readonly 冲突: readonly string[]
}

const FINALIZED_RE = /^定稿\/卷(\d+)\/(\d{4,})-(.+)\.md$/

function walkFinalized(root: string, gaps: string[]): string[] {
  const out: string[] = []
  const walk = (abs: string, rel: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true })
    } catch {
      if (rel !== '定稿') gaps.push(`定稿目录无法读取：${rel}`)
      return
    }
    for (const entry of entries) {
      const childAbs = path.join(abs, entry.name)
      const childRel = `${rel}/${entry.name}`
      if (entry.isSymbolicLink()) {
        gaps.push(`定稿目录包含链接或别名：${childRel}`)
        continue
      }
      if (entry.isDirectory()) {
        walk(childAbs, childRel)
        continue
      }
      if (entry.isFile() && FINALIZED_RE.test(childRel)) out.push(childRel)
    }
  }
  walk(path.join(root, '定稿'), '定稿')
  return out
}

function scopeLabel(scope: ExportScope): string {
  const parts: string[] = []
  if (scope.卷 !== undefined) parts.push(`卷${pad(scope.卷)}`)
  if (scope.起章 !== undefined || scope.止章 !== undefined) {
    parts.push(`第${scope.起章 !== undefined ? chapterNo(scope.起章) : '起'}–${scope.止章 !== undefined ? chapterNo(scope.止章) : '止'}章`)
  }
  return parts.length === 0 ? '全书' : parts.join('，')
}

function safeFileStem(书名: string): string {
  return validateSegment(书名).length === 0 && 书名 !== '' ? 书名 : '书稿'
}

/** 只读计算导出计划与两份完整载荷；不落盘、不改书仓。 */
export function computeExport(bookRoot: string, scope: ExportScope = {}): ComputedExport {
  const gaps: string[] = []
  const fail = (extra?: readonly string[]): ComputedExport => ({
    ok: false, gaps: [...gaps, ...(extra ?? [])], 书名: '', 范围: '', 章列表: [], 合计字数: 0,
    合集文件: '', 清单文件: '', 合集: '', 清单: '', 合集哈希: '',
  })
  if (scope.卷 !== undefined && (!Number.isSafeInteger(scope.卷) || scope.卷 < 1)) return fail(['导出范围卷号必须是正整数'])
  if (scope.起章 !== undefined && (!Number.isSafeInteger(scope.起章) || scope.起章 < 1)) return fail(['导出范围起章必须是正整数'])
  if (scope.止章 !== undefined && (!Number.isSafeInteger(scope.止章) || scope.止章 < 1)) return fail(['导出范围止章必须是正整数'])
  if (scope.起章 !== undefined && scope.止章 !== undefined && scope.起章 > scope.止章) return fail(['导出范围起章不能晚于止章'])
  const root = canonicalizePath(bookRoot)
  if (root === '') return fail(['书仓路径无效'])
  const 书名 = path.basename(root)

  const chapters: ExportChapter[] = []
  const seenChapterNo = new Map<number, string>()
  for (const rel of walkFinalized(root, gaps)) {
    const m = FINALIZED_RE.exec(rel)!
    const 卷 = Number(m[1])
    const 章 = Number(m[2])
    const 章名 = m[3]!
    let read: ReturnType<typeof readMaterialFile>
    try {
      read = readMaterialFile(root, rel)
    } catch (err) {
      gaps.push(`定稿读取失败：${rel}（${err instanceof Error ? err.message : String(err)}）`)
      continue
    }
    const parsed = parseDocument(read.text)
    if (!parsed.ok) {
      gaps.push(`定稿 frontmatter 解析失败：${rel}（${parsed.detail}）`)
      continue
    }
    const 状态 = parsed.data.fields['状态']
    if (状态 !== undefined && 状态 !== '已定稿') {
      gaps.push(`定稿目录中的文档状态不是已定稿：${rel}`)
      continue
    }
    const occupied = seenChapterNo.get(章)
    if (occupied !== undefined) {
      gaps.push(`章号全书不连续：第${chapterNo(章)}章同时出现在 ${occupied} 与 ${rel}`)
      continue
    }
    seenChapterNo.set(章, rel)
    const 正文 = parsed.data.body.replace(/\n+$/, '')
    chapters.push({
      卷, 章, 章名, 相对路径: rel, 版本: extractVersionFields(parsed.data.fields).版本,
      内容哈希: read.hash, 字数: [...正文].length, 正文,
    })
  }
  if (gaps.length > 0) return fail()
  const selected = chapters
    .filter((c) => (scope.卷 === undefined || c.卷 === scope.卷)
      && (scope.起章 === undefined || c.章 >= scope.起章)
      && (scope.止章 === undefined || c.章 <= scope.止章))
    .sort((a, b) => a.章 - b.章)
  if (selected.length === 0) return fail([`空选择：范围内没有已定稿章节（${scopeLabel(scope)}）`])

  const stem = safeFileStem(书名)
  const 合集文件 = `${stem}-定稿合集.md`
  const 清单文件 = `${stem}-来源清单.md`
  const 范围 = scopeLabel(scope)
  const 合计字数 = selected.reduce((sum, c) => sum + c.字数, 0)

  const compendium: string[] = [
    `# 《${书名}》定稿合集`,
    '',
    `> 范围：${范围}；共 ${selected.length} 章，合计 ${合计字数} 字。来源路径与版本哈希见同目录「${清单文件}」。`,
    '',
  ]
  let currentVolume = 0
  for (const c of selected) {
    if (c.卷 !== currentVolume) {
      currentVolume = c.卷
      compendium.push(`## 卷${pad(c.卷)}`, '')
    }
    compendium.push(`### 第${chapterNo(c.章)}章 ${c.章名}`, '', c.正文, '')
  }
  const 合集 = `${compendium.join('\n').replace(/\n+$/, '')}\n`
  const 合集哈希 = materialHash(合集)

  const manifest: string[] = [
    `# 《${书名}》定稿来源清单`,
    '',
    `- 导出范围：${范围}`,
    `- 章数：${selected.length}；合计字数：${合计字数}`,
    `- 合集文件：${合集文件}`,
    `- 合集 SHA-256：${合集哈希}`,
    '- 口径：只读导出；源书仓内容与 Git HEAD 不因本导出改变。',
    '- 完成验收：本清单最后落盘；须读取合集和清单校验实际内容，仅清单存在不代表完成。',
    '',
    '| 章 | 卷 | 来源路径 | 版本 | 内容 SHA-256 | 字数 |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  for (const c of selected) {
    manifest.push(`| 第${chapterNo(c.章)}章 ${c.章名} | 卷${pad(c.卷)} | ${c.相对路径} | ${c.版本 ?? '无'} | ${c.内容哈希} | ${c.字数} |`)
  }
  const 清单 = `${manifest.join('\n')}\n`

  return {
    ok: true, gaps: [], 书名, 范围, 章列表: selected, 合计字数,
    合集文件, 清单文件, 合集, 清单, 合集哈希,
  }
}

/**
 * 只读检查作者选定目录：落在源定稿目录（含其内）拒绝；目标已存在且不是目录拒绝；
 * 已存在的同名导出文件列入冲突（先说明，不默认覆盖）。不写任何文件。
 * 目标路径先 canonical 化：经链接/别名进入时报告与比较都用真实落点，作者看到的就是
 * 实际写入位置；别名指向定稿目录时同样命中拒绝。
 */
export function inspectExportTarget(bookRoot: string, targetDir: string, fileNames: readonly string[]): ExportTargetReport {
  const problems: string[] = []
  const 冲突: string[] = []
  const root = canonicalizePath(bookRoot)
  const target = canonicalizePath(targetDir)
  if (root === '' || target === '') {
    return { ok: false, 目标目录: targetDir, 已存在: false, problems: ['书仓或目标目录路径无效'], 冲突 }
  }
  const finalizedRoot = path.join(root, '定稿')
  if (target === finalizedRoot || isInsidePath(finalizedRoot, target)) {
    problems.push('目标位于源定稿目录内，导出会污染真源：请另选目录')
  }
  let stat: fs.Stats | null = null
  try {
    stat = fs.lstatSync(target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') problems.push(`目标目录无法读取：${err instanceof Error ? err.message : String(err)}`)
  }
  const 已存在 = stat !== null
  if (stat !== null) {
    if (!stat.isDirectory()) problems.push('目标已存在且不是目录')
    else {
      for (const name of fileNames) {
        if (validateSegment(name).length > 0) {
          problems.push(`导出文件名不合法：${name}`)
          continue
        }
        try {
          fs.accessSync(path.join(target, name))
          冲突.push(name)
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') problems.push(`目标文件无法检查：${name}`)
        }
      }
    }
  }
  return { ok: problems.length === 0 && 冲突.length === 0, 目标目录: target, 已存在, problems, 冲突 }
}

export interface ExportVerification {
  readonly ok: boolean
  readonly 目标目录: string
  readonly problems: readonly string[]
  readonly 文件: readonly { 名称: string; 预期哈希: string; 实际哈希: string | null; 一致: boolean }[]
}

/** 只读验收实际落盘的两个文件；清单存在本身不代表本批已完成。 */
export function verifyExportTarget(bookRoot: string, targetDir: string, computed: ComputedExport): ExportVerification {
  const expected = [{ 名称: computed.合集文件, content: computed.合集 }, { 名称: computed.清单文件, content: computed.清单 }]
  const target = inspectExportTarget(bookRoot, targetDir, computed.ok ? expected.map(f => f.名称) : [])
  const problems = [...target.problems, ...computed.gaps]
  const 文件: Array<{ 名称: string; 预期哈希: string; 实际哈希: string | null; 一致: boolean }> = []
  if (computed.ok && problems.length === 0) {
    for (const file of expected) {
      const 预期哈希 = materialHash(file.content)
      let 实际哈希: string | null = null
      try { 实际哈希 = readMaterialFile(target.目标目录, file.名称).hash }
      catch (err) { problems.push(`导出文件不可读取：${file.名称}（${err instanceof Error ? err.message : String(err)}）`) }
      const 一致 = 实际哈希 === 预期哈希
      if (实际哈希 !== null && !一致) problems.push(`导出文件内容不一致：${file.名称}`)
      文件.push({ 名称: file.名称, 预期哈希, 实际哈希, 一致 })
    }
  }
  return { ok: computed.ok && problems.length === 0 && 文件.length === 2 && 文件.every(f => f.一致), 目标目录: target.目标目录, problems, 文件 }
}
