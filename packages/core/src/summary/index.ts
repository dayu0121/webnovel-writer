/**
 * 卷摘要候选生成(任务21, 件一;格式规格 §3.4):
 * 只算不写——读本卷已定稿章的章摘要全文、账本已收/进行中线索、卷纲「卷末兑现」段,
 * 汇编为候选正文供作者确认;不发明散文,不设上限、不截断。
 * 章摘要不齐时如实报缺,不产候选、不落盘。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { entryChapterNo, queryLedger } from '../ledger'
import { parseDocument } from '../repo/frontmatter'
import { pad, paths } from '../repo/paths'

export type VolumeSummaryCandidate =
  | {
      readonly ok: true
      readonly 卷: number
      readonly 候选: string
      readonly 章摘要来源: readonly string[]
      readonly 线索条数: number
      /** 无法判定发生时点的线索条目名（F21-1）:呈报而非静默当作卷内事实。 */
      readonly 线索边界不明: readonly string[]
    }
  | {
      readonly ok: false
      readonly reason: string
      readonly 缺章摘要: readonly number[]
      /** 账本缺失/解析失败(F21-2):操作性失败,薄入口以非零退出码呈报;缺章摘要等如实报缺不设此标记。 */
      readonly 账本失败?: true
    }

function readText(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf-8')
  } catch {
    return null
  }
}

function bodyOnly(text: string): string {
  const r = parseDocument(text)
  return (r.ok ? r.data.body : text).trim()
}

function stripSummaryHeading(text: string): string {
  return bodyOnly(text).replace(/^#\s*章摘要\s*\n+/, '').trim()
}

function extractSection(body: string, title: string): string | null {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const head = new RegExp(`^##\\s+${escaped}(?:\\s*[〔(].+?[〕)])?\\s*$`)
  const start = lines.findIndex((line) => head.test(line.trim()))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i]!.trim())) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join('\n').trim()
}

/**
 * 汇编本卷卷摘要候选(纯函数,零写盘)。
 * 任一已定稿章缺章摘要即整体报缺:候选必须是完整卷的汇编,不允许半卷成文。
 */
export function computeVolumeSummaryCandidate(bookRoot: string, 卷: number): VolumeSummaryCandidate {
  const 卷NN = pad(卷)
  const 定稿目录 = path.join(bookRoot, `定稿/卷${卷NN}`)
  let files: string[] = []
  try {
    files = fs.readdirSync(定稿目录).filter((f) => /^\d{4}-.+\.md$/.test(f)).sort()
  } catch {
    files = []
  }
  const chapters = files
    .map((f) => /(\d{4})-(.+)\.md$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ 章: Number(m[1]), 章名: m[2]! }))
  if (chapters.length === 0) {
    return { ok: false, reason: `卷${卷NN} 无定稿章，无法生成卷摘要候选`, 缺章摘要: [] }
  }

  const 缺章摘要: number[] = []
  const sections: string[] = []
  const 章摘要来源: string[] = []
  for (const c of chapters) {
    const rel = paths.章摘要(卷, c.章, c.章名)
    const text = readText(bookRoot, rel)
    if (text === null) {
      缺章摘要.push(c.章)
      continue
    }
    const content = stripSummaryHeading(text)
    if (content === '' || content === '（无摘要沉淀）') {
      缺章摘要.push(c.章)
      continue
    }
    章摘要来源.push(rel)
    sections.push(`### 第${String(c.章).padStart(4, '0')}章 ${c.章名}\n\n${content}`)
  }
  if (缺章摘要.length > 0) {
    return { ok: false, reason: `卷${卷NN} 章摘要不齐（缺第 ${缺章摘要.join('、')} 章），如实报缺，不产候选不落盘`, 缺章摘要 }
  }

  // 事实边界(F21-1/F21-2):限界＝目标卷有效定稿章键的最大章号(全书连续);
  // queryLedger 的 章上限 在折叠当前态之前按发生章过滤——后卷新增与后卷更新均不回流;
  // 账本缺失/解析失败(含部分可读)不产候选,不伪装成「无线索」。
  const 卷末章号 = Math.max(...chapters.map((c) => c.章))
  const ledger = queryLedger(bookRoot, { 分类: '线索', 章上限: 卷末章号 })
  if (!ledger.ok) {
    const kindText = ledger.kind === 'missing' ? '缺失' : '解析失败'
    return { ok: false, reason: `账本${kindText}：${ledger.reason}，不产候选不落盘`, 缺章摘要: [], 账本失败: true }
  }
  const 命中 = ledger.entries.filter((e) => ['已收', '已埋', '已示'].includes(e.字段['状态'] ?? ''))
  const 边界不明 = 命中.filter((e) => entryChapterNo(e) === null).map((e) => e.名称)
  const 卷内线索 = 命中.filter((e) => entryChapterNo(e) !== null)
  const 线索段Parts: string[] = []
  if (卷内线索.length === 0 && 边界不明.length === 0) {
    线索段Parts.push('（无已收或进行中线索）')
  } else {
    if (卷内线索.length > 0) {
      线索段Parts.push(卷内线索.map((e) => `- ${e.名称}〔${e.字段['状态'] ?? ''}〕${e.正文 === '' ? '' : `：${e.正文}`}`).join('\n'))
    }
    if (边界不明.length > 0) {
      线索段Parts.push(`（边界不明，发生时点无法判定，未计入卷内事实：${边界不明.join('、')}）`)
    }
  }
  const 线索段 = 线索段Parts.join('\n')

  const 卷纲文 = readText(bookRoot, paths.卷纲(卷))
  const 卷末兑现 = 卷纲文 === null ? null : extractSection(bodyOnly(卷纲文), '卷末兑现')

  const 候选 = [
    '# 卷摘要',
    '',
    '## 章摘要汇编',
    '',
    sections.join('\n\n'),
    '',
    '## 线索收束',
    '',
    线索段,
    '',
    '## 卷末兑现核对（卷纲原文）',
    '',
    卷末兑现 ?? '（卷纲无「卷末兑现」段）',
    '',
  ].join('\n')
  return { ok: true, 卷, 候选, 章摘要来源, 线索条数: 卷内线索.length, 线索边界不明: 边界不明 }
}
