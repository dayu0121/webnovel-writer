/**
 * 清单驱动定稿入档(格式规格 §11.2 / 不变量 2):原子写入＋单次 git 提交。
 * 健康检查失败则不写不提交;retcon: 走独立补偿入口。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { writeBatchAtomic, type FileOp } from '../repo/atomic'
import { MACHINE_SCHEMA_VERSION, parseMachineJson } from '../repo/schema'
import { checkGitHealth } from './health'
import { formatCommitMessage } from './message'
import { checkCommitPath } from './paths'
import { planSettlement, type SettlementApproval } from '../settlement'
import { commitWithIsolatedIndex, runGit } from './git'
import { updateOperationTargets, withBookLock } from '../repo/lock'
import { recoverTransactions, type OperationProvenance } from '../repo/transaction'

export interface ManifestEntry {
  readonly 源?: string
  readonly 目标: string
  readonly 内容?: string
  readonly sha256?: string
}

export interface ArchiveOptions {
  readonly bookRoot: string
  /** 待定稿包目录(相对书仓或绝对);用于读清单.json 与源文件。 */
  readonly packageDir?: string
  readonly files?: readonly ManifestEntry[]
  readonly summary: string
  readonly lines?: readonly string[]
  /** 包中存在非空沉淀候选时，必须提供作者批准。 */
  readonly settlement?: SettlementApproval
  /**
   * 归档自身产出的附加提交路径（拍板 1：如已标记「已消费」的近期窗口——标记由归档流程
   * 在调用前写入，这里只负责随 `ch:` 一并提交）。逐条过路径白名单。
   */
  readonly extraPaths?: readonly string[]
  readonly provenance?: OperationProvenance
}

export type ArchiveResult =
  | {
      readonly ok: true
      readonly message: string
      readonly dests: readonly string[]
      /** F7:本次调用检测到 HEAD 已含同说明同目标的提交(重试命中已完成),未重复提交。 */
      readonly alreadyCommitted?: boolean
    }
  | { readonly ok: false; readonly reason: string; /** F7:文件已落盘、待提交(commit/add 阶段失败)。 */ readonly written?: true }

function sha256Of(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

function resolvePackageDir(bookRoot: string, packageDir: string): string {
  return path.isAbsolute(packageDir) ? packageDir : path.join(bookRoot, packageDir)
}

function readManifest(packageAbs: string): { readonly ok: true; readonly files: readonly ManifestEntry[] } | { readonly ok: false; readonly reason: string } {
  const p = path.join(packageAbs, '清单.json')
  let text: string
  try {
    text = fs.readFileSync(p, 'utf-8')
  } catch {
    return { ok: false, reason: '待定稿包缺清单.json,拒绝入档' }
  }
  const parsed = parseMachineJson(text, MACHINE_SCHEMA_VERSION)
  if (!parsed.ok) return { ok: false, reason: `清单解析失败:${parsed.detail}` }
  const raw = parsed.data['文件']
  if (!Array.isArray(raw)) return { ok: false, reason: '清单缺「文件」数组,拒绝入档' }
  const files: ManifestEntry[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, reason: '清单文件项必须是对象' }
    }
    const o = item as Record<string, unknown>
    const 目标 = o['目标']
    if (typeof 目标 !== 'string' || 目标 === '') return { ok: false, reason: '清单文件项缺目标路径' }
    files.push({
      源: typeof o['源'] === 'string' ? o['源'] : undefined,
      目标,
      内容: typeof o['内容'] === 'string' ? o['内容'] : undefined,
      sha256: typeof o['sha256'] === 'string' ? o['sha256'] : undefined,
    })
  }
  return { ok: true, files }
}

function loadOps(
  bookRoot: string,
  packageAbs: string | null,
  files: readonly ManifestEntry[],
  allowOverwrite: boolean,
): { readonly ok: true; readonly ops: readonly FileOp[] } | { readonly ok: false; readonly reason: string } {
  const ops: FileOp[] = []
  for (const f of files) {
    const destCheck = checkCommitPath(bookRoot, f.目标)
    if (!destCheck.ok) return destCheck
    let content = f.内容
    if (content === undefined) {
      if (!f.源 || packageAbs === null) return { ok: false, reason: `清单项「${f.目标}」无源文件也无内容` }
      const srcAbs = path.join(packageAbs, f.源)
      try {
        content = fs.readFileSync(srcAbs, 'utf-8')
      } catch {
        return { ok: false, reason: `清单源文件不存在:${f.源}` }
      }
    }
    if (f.sha256 !== undefined && sha256Of(content) !== f.sha256) {
      return { ok: false, reason: `清单校验失败:「${f.目标}」sha256 不匹配` }
    }
    const destAbs = path.join(bookRoot, destCheck.relPath)
    if (!allowOverwrite && fs.existsSync(destAbs)) {
      // F7(2026-09-05):提交失败后文件已落盘,重试时目标存在。内容与本次待写完全一致
      // ＝上次失败尝试的遗留,放行(幂等重写);不同＝作者期间的新修改,仍按不变量 4 拒绝。
      let existing = ''
      try { existing = fs.readFileSync(destAbs, 'utf-8') } catch { /* 视为不存在 */ }
      if (existing !== content) {
        return { ok: false, reason: `定稿只增不改,目标已存在且内容不同(作者期间的新修改不覆盖):${destCheck.relPath}(不变量 4)` }
      }
    }
    ops.push({ relPath: destCheck.relPath, content })
  }
  if (ops.length === 0) return { ok: false, reason: '清单文件列表为空,拒绝入档' }
  return { ok: true, ops }
}

const 定稿章 = /^定稿\/卷(\d+)\/(\d{4})-(.+)\.md$/

function targetChapter(targets: readonly string[]): { readonly 卷: number; readonly 章: number; readonly 章名: string } | undefined {
  for (const target of targets) {
    const match = 定稿章.exec(target)
    if (match !== null) {
      return { 卷: Number(match[1]), 章: Number(match[2]), 章名: match[3] ?? '' }
    }
  }
  return undefined
}

/**
 * 章号全书连续(格式规格 §2.2):同一章号不得出现在两个卷下。
 *
 * 账本时间线的 `章号`、线索的 `埋设点`/`预期兑现区间` 都是书级字段、不带卷限定,
 * 章号跨卷重复会让这些字段永久歧义,因此在入档口 fail-closed。
 */
function chapterNumberConflict(bookRoot: string, targets: readonly string[]): string | null {
  const 定稿根 = path.join(bookRoot, '定稿')
  for (const target of targets) {
    const match = 定稿章.exec(target)
    if (match === null) continue
    const 卷目录 = `卷${match[1]}`
    const 章号 = match[2]!
    let 卷列表: string[]
    try {
      卷列表 = fs.readdirSync(定稿根)
    } catch {
      continue
    }
    for (const 其他卷 of 卷列表) {
      if (其他卷 === 卷目录 || !/^卷\d+$/.test(其他卷)) continue
      let 章文件: string[]
      try {
        章文件 = fs.readdirSync(path.join(定稿根, 其他卷))
      } catch {
        continue
      }
      const 撞号 = 章文件.find((name) => name.startsWith(`${章号}-`) && name.endsWith('.md'))
      if (撞号 !== undefined) {
        return `章号全书连续,${章号} 已被 定稿/${其他卷}/${撞号} 占用(格式规格 §2.2)`
      }
    }
  }
  return null
}

function archiveLocked(opts: ArchiveOptions, mode: 'ch' | 'retcon'): ArchiveResult {
  const packageAbs = opts.packageDir === undefined ? null : resolvePackageDir(opts.bookRoot, opts.packageDir)
  let files = opts.files
  if (files === undefined) {
    if (packageAbs === null) return { ok: false, reason: '未提供清单或待定稿包目录' }
    const man = readManifest(packageAbs)
    if (!man.ok) return man
    files = man.files
  }

  const loaded = loadOps(opts.bookRoot, packageAbs, files, mode === 'retcon')
  if (!loaded.ok) return loaded
  // 账本与本书记忆只有一条写入路径:沉淀服务。两种模式都不许清单从旁边的门进来,
  // 否则状态词表、计划来源、线索必填字段等校验被整体绕过(吃书亦然)。
  if (loaded.ops.some((op) => op.relPath.startsWith('账本/') || op.relPath.startsWith('本书记忆/'))) {
    return { ok: false, reason: '清单不得绕过沉淀服务直接写账本或本书记忆' }
  }

  let ops = [...loaded.ops]
  if (mode === 'ch') {
    const conflict = chapterNumberConflict(opts.bookRoot, ops.map((op) => op.relPath))
    if (conflict !== null) return { ok: false, reason: conflict }
  }
  if (packageAbs !== null) {
    // 正常定稿:追加新条目,且必须能从清单认出定稿章。
    // 吃书补偿:整条更正既有条目,章节由批准声明(可能不产生新定稿目标)。
    const chapter = mode === 'ch' ? targetChapter(ops.map((op) => op.relPath)) : opts.settlement?.章节
    if (mode === 'ch' && opts.settlement !== undefined && chapter === undefined) {
      return { ok: false, reason: '沉淀批准需要清单包含定稿章节目标' }
    }
    const settlement = planSettlement(
      opts.bookRoot,
      packageAbs,
      opts.settlement,
      chapter,
      mode === 'ch' ? '追加' : '更正',
    )
    if (!settlement.ok) return settlement
    ops = [...ops, ...settlement.ops]
  }
  const destinations = new Set<string>()
  for (const op of ops) {
    if (destinations.has(op.relPath)) return { ok: false, reason: `清单与沉淀目标重复:${op.relPath}` }
    destinations.add(op.relPath)
  }
  const extraDests: string[] = []
  for (const extra of opts.extraPaths ?? []) {
    const extraCheck = checkCommitPath(opts.bookRoot, extra)
    if (!extraCheck.ok) return extraCheck
    if (!destinations.has(extraCheck.relPath)) {
      destinations.add(extraCheck.relPath)
      extraDests.push(extraCheck.relPath)
    }
  }

  const health = checkGitHealth(opts.bookRoot)
  if (!health.ok) return health

  const message = formatCommitMessage({
    prefix: mode,
    summary: opts.summary,
    lines: opts.lines,
    kind: mode === 'retcon' ? '吃书补偿' : undefined,
  })
  const dests = [...ops.map((op) => op.relPath), ...extraDests]
  updateOperationTargets(opts.bookRoot, opts.provenance, dests)

  // F7(2026-09-05)幂等已完成检测:HEAD 说明与本次相同、且目标路径零未提交变更
  // ＝上次已成功提交(重试命中)。不重复提交、不重复生成事件。
  const headSubject = runGit(opts.bookRoot, ['log', '-1', '--format=%s'])
  const porcelain = runGit(opts.bookRoot, ['status', '--porcelain', '--', ...dests])
  if (headSubject.status === 0 && headSubject.stdout.trim() === message.trim() && porcelain.status === 0 && porcelain.stdout.trim() === '') {
    return { ok: true, message, dests, alreadyCommitted: true }
  }

  try {
    writeBatchAtomic(opts.bookRoot, ops, opts.provenance === undefined ? {} : { provenance: opts.provenance })
  } catch (err) {
    return { ok: false, reason: `原子写入失败:${String(err)}` }
  }

  const commit = commitWithIsolatedIndex(opts.bookRoot, dests, message)
  if (commit.noChanges) {
    return { ok: false, written: true, reason: `文件已写入但提交失败,未形成提交:${commit.stderr.trim() || '无实质变更'}` }
  }
  if (commit.status !== 0) {
    return { ok: false, written: true, reason: `文件已写入但提交失败,未形成提交:${commit.stderr.trim() || 'git commit 失败'}` }
  }
  return { ok: true, message, dests }
}

function archive(opts: ArchiveOptions, mode: 'ch' | 'retcon'): ArchiveResult {
  return withBookLock(opts.bookRoot, () => {
    recoverTransactions(opts.bookRoot)
    return archiveLocked(opts, mode)
  }, opts.provenance === undefined ? { targets: opts.extraPaths } : { ...opts.provenance, targets: opts.extraPaths })
}

/** 定稿入档默认通道:ch: 前缀,目标不得覆盖既有定稿。 */
export function archiveChapter(opts: ArchiveOptions): ArchiveResult {
  return archive(opts, 'ch')
}

/** 吃书补偿通道:retcon: 前缀(不变量 4)。 */
export function archiveRetcon(opts: ArchiveOptions): ArchiveResult {
  return archive(opts, 'retcon')
}
