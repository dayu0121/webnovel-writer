/**
 * 书仓多文件事务清单与恢复。
 *
 * 单文件 rename 仍是读者看到完整内容的边界；manifest 让进程在多个
 * rename 之间退出后可以把已经记录的目标恢复到批次开始前的状态。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { removeSync } from './remove'
import { renameSync } from './rename'
import { currentBookProvenance, RUNTIME_DIR, TRANSACTION_DIR, withBookLock } from './lock'
import { canonicalizePath, isInsidePath } from '../gate/canonical'

export interface OperationProvenance {
  readonly operationId?: string
  readonly sessionId?: string
  readonly agentId?: string
  readonly toolName?: string
  readonly callId?: string
  readonly targets?: readonly string[]
}

export interface TransactionOptions {
  readonly provenance?: OperationProvenance
}

interface ManifestEntry {
  readonly relPath: string
  readonly tmpRel: string
  readonly backupRel: string
  readonly contentHash: string
  readonly originalHash: string | null
  readonly hadOriginal: boolean
  readonly backupRecorded: boolean
  readonly applied: boolean
}

interface TransactionManifest {
  readonly schemaVersion: 1
  readonly id: string
  readonly createdAt: string
  readonly phase: 'staged' | 'backed-up' | 'applying' | 'committed'
  readonly entries: readonly ManifestEntry[]
  readonly provenance?: OperationProvenance
}

function safeRel(relPath: string): string {
  if (path.isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) throw new Error(`事务路径必须是书仓相对路径:${relPath}`)
  const segments = relPath.split(/[\\/]/)
  if (segments.includes('..') || relPath.includes(':') || relPath.includes('\0') || relPath === '' || relPath === '.') throw new Error(`事务路径非法:${relPath}`)
  return path.posix.normalize(segments.join('/'))
}

function inside(root: string, rel: string): string {
  const abs = path.resolve(root, rel)
  if (!isInsidePath(root, abs)) throw new Error(`事务路径逃逸书仓:${rel}`)
  return abs
}

function manifestPath(root: string, id: string): string {
  return path.join(root, TRANSACTION_DIR, id, 'manifest.json')
}

function writeManifest(file: string, value: TransactionManifest): void {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf-8', flag: 'wx' })
    renameSync(tmp, file)
  } catch (err) {
    try { removeSync(tmp) } catch { /* best effort */ }
    throw err
  }
}

function updateManifest(root: string, manifest: TransactionManifest, patch: Partial<TransactionManifest>): TransactionManifest {
  const next = { ...manifest, ...patch } as TransactionManifest
  writeManifest(manifestPath(root, manifest.id), next)
  return next
}

function parseManifest(root: string, file: string): TransactionManifest {
  let raw: unknown
  try { raw = JSON.parse(fs.readFileSync(file, 'utf-8')) } catch (err) {
    throw new Error(`事务清单解析失败:${file}:${String(err)}`)
  }
  if (raw === null || typeof raw !== 'object') throw new Error(`事务清单格式非法:${file}`)
  const o = raw as Record<string, unknown>
  if (o.schemaVersion !== 1 || typeof o.id !== 'string' || !Array.isArray(o.entries)) {
    throw new Error(`事务清单版本或 entries 非法:${file}`)
  }
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(o.id) || path.basename(path.dirname(file)) !== o.id) {
    throw new Error(`事务清单 id 非法:${file}`)
  }
  const entries: ManifestEntry[] = []
  for (const item of o.entries) {
    if (item === null || typeof item !== 'object') throw new Error(`事务清单条目非法:${file}`)
    const e = item as Record<string, unknown>
    if (typeof e.relPath !== 'string' || typeof e.tmpRel !== 'string' || typeof e.backupRel !== 'string') {
      throw new Error(`事务清单路径字段非法:${file}`)
    }
    const expectedBackup = `${TRANSACTION_DIR}/${o.id}/backups/`
    const normalizedRel = safeRel(e.relPath)
    const normalizedTmp = safeRel(e.tmpRel)
    if (typeof e.hadOriginal !== 'boolean' || typeof e.backupRecorded !== 'boolean'
      || typeof e.applied !== 'boolean' || typeof e.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(e.contentHash)
      || (e.hadOriginal ? typeof e.originalHash !== 'string' || !/^[a-f0-9]{64}$/.test(e.originalHash) : e.originalHash !== null)) {
      throw new Error(`事务清单恢复字段非法:${file}`)
    }
    if (!e.backupRel.startsWith(expectedBackup)
      || path.posix.dirname(normalizedTmp) !== path.posix.dirname(normalizedRel)
      || !path.posix.basename(normalizedTmp).startsWith(`.webnovel-txn-${o.id}-`)) {
      throw new Error(`事务清单临时/备份路径越界:${file}`)
    }
    entries.push({
      relPath: normalizedRel,
      tmpRel: normalizedTmp,
      backupRel: safeRel(e.backupRel),
      contentHash: typeof e.contentHash === 'string' ? e.contentHash : '',
      originalHash: e.hadOriginal ? e.originalHash as string : null,
      hadOriginal: e.hadOriginal === true,
      backupRecorded: e.backupRecorded === true,
      applied: e.applied === true,
    })
  }
  const phase = o.phase
  if (phase !== 'staged' && phase !== 'backed-up' && phase !== 'applying' && phase !== 'committed') {
    throw new Error(`事务阶段非法:${file}`)
  }
  return {
    schemaVersion: 1,
    id: o.id as string,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
    phase,
    entries,
    provenance: o.provenance !== null && typeof o.provenance === 'object' ? o.provenance as OperationProvenance : undefined,
  }
}

function planRestore(root: string, entry: ManifestEntry): (() => void) | undefined {
  if (!entry.backupRecorded) return undefined
  const target = inside(root, entry.relPath)
  let original: Buffer | undefined
  if (entry.hadOriginal) {
    const backup = inside(root, entry.backupRel)
    if (!fs.existsSync(backup) || !fs.lstatSync(backup).isFile()) throw new Error(`事务备份缺失或非法:${entry.relPath}`)
    original = fs.readFileSync(backup)
    if (createHash('sha256').update(original).digest('hex') !== entry.originalHash) throw new Error(`事务备份校验失败:${entry.relPath}`)
  }
  let current: string | null = null
  try {
    if (!fs.lstatSync(target).isFile()) throw new Error(`事务恢复目标不是普通文件:${entry.relPath}`)
    current = createHash('sha256').update(fs.readFileSync(target)).digest('hex')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (current === entry.originalHash) return undefined
  if (current !== entry.contentHash) throw new Error(`事务恢复冲突，目标已被另行修改，备份已保留:${entry.relPath}`)
  return () => {
    if (original !== undefined) {
      const temp = inside(root, `${entry.tmpRel}.restore`)
      removeSync(temp)
      fs.writeFileSync(temp, original, { flag: 'wx' })
      renameSync(temp, target)
    } else {
      fs.unlinkSync(target)
    }
  }
}

function cleanupTransaction(root: string, id: string, entries: readonly ManifestEntry[] = []): void {
  for (const entry of entries) {
    removeSync(inside(root, entry.tmpRel))
    removeSync(inside(root, `${entry.tmpRel}.restore`))
  }
  const dir = path.join(root, TRANSACTION_DIR, id)
  const done = `${dir}.done`
  renameSync(dir, done)
  try { removeSync(done) } catch { /* A settled .done directory is cleanup-only on restart. */ }
}

function rollbackTransaction(root: string, manifest: TransactionManifest): void {
  // Validate the complete recovery before modifying any file.
  const actions = [...manifest.entries].reverse().map((entry) => planRestore(root, entry))
  for (const action of actions) action?.()
  cleanupTransaction(root, manifest.id, manifest.entries)
}

/** 恢复书仓内所有未完成批次；调用方必须已持有书仓锁。 */
export function recoverTransactions(bookRoot: string): void {
  withBookLock(bookRoot, () => recoverLocked(canonicalizePath(bookRoot)))
}

function recoverLocked(root: string): void {
  const dir = path.join(root, TRANSACTION_DIR)
  if (!fs.existsSync(dir)) return
  inside(root, TRANSACTION_DIR)
  const names = fs.readdirSync(dir)
  for (const id of names) {
    const txDir = path.join(dir, id)
    if (/^[A-Za-z0-9_-]+\.(done|preparing)$/.test(id)) {
      try { removeSync(txDir) } catch { /* Settled or not yet published. */ }
      continue
    }
    let stat: fs.Stats
    stat = fs.lstatSync(txDir)
    if (!stat.isDirectory()) throw new Error(`事务目录非法:${txDir}`)
    const file = path.join(txDir, 'manifest.json')
    if (!fs.existsSync(file)) throw new Error(`事务清单缺失:${file}`)
    const manifest = parseManifest(root, file)
    if (manifest.phase === 'committed') cleanupTransaction(root, manifest.id, manifest.entries)
    else rollbackTransaction(root, manifest)
  }
}

/** 创建、执行并在成功后提交一个多文件事务。 */
export function runTransaction(
  bookRoot: string,
  ops: readonly { readonly relPath: string; readonly content: string }[],
  options: TransactionOptions = {},
): void {
  withBookLock(bookRoot, () => {
    const root = canonicalizePath(bookRoot)
    recoverLocked(root)
    runLocked(root, ops, options)
  }, { ...options.provenance, targets: ops.map((op) => op.relPath) })
}

function runLocked(root: string, ops: readonly { readonly relPath: string; readonly content: string }[], options: TransactionOptions): void {
  if (ops.length === 0) return
  const id = `${Date.now().toString(36)}-${process.pid}-${randomBytes(5).toString('hex')}`
  const normalized = ops.map((op) => ({ relPath: safeRel(op.relPath), content: op.content }))
  for (const op of normalized) {
    const first = op.relPath.split('/')[0]?.toLowerCase()
    if (first === RUNTIME_DIR || first === '.git') throw new Error(`事务目标为保留路径:${op.relPath}`)
    inside(root, op.relPath)
  }
  if (new Set(normalized.map((op) => op.relPath)).size !== normalized.length) {
    throw new Error('事务目标路径重复')
  }
  const txRoot = path.join(root, TRANSACTION_DIR, id)
  inside(root, TRANSACTION_DIR)
  const preparing = `${txRoot}.preparing`
  fs.mkdirSync(path.join(preparing, 'backups'), { recursive: true })
  let entries: ManifestEntry[] = normalized.map((op, index) => {
    const relPath = op.relPath
    const dest = inside(root, relPath)
    const tmp = path.join(path.dirname(dest), `.webnovel-txn-${id}-${index}.tmp`)
    return {
      relPath,
      tmpRel: path.relative(root, tmp).split(path.sep).join('/'),
      backupRel: path.join(TRANSACTION_DIR, id, 'backups', `${index}.bak`).split(path.sep).join('/'),
      contentHash: createHash('sha256').update(op.content, 'utf-8').digest('hex'),
      originalHash: null,
      hadOriginal: false,
      backupRecorded: false,
      applied: false,
    }
  })
  let manifest: TransactionManifest = {
    schemaVersion: 1,
    id,
    createdAt: new Date().toISOString(),
    phase: 'staged',
    entries,
    provenance: options.provenance ?? currentBookProvenance(root),
  }
  writeManifest(path.join(preparing, 'manifest.json'), manifest)
  renameSync(preparing, txRoot)
  try {
    for (let i = 0; i < normalized.length; i += 1) {
      const dest = inside(root, entries[i]!.relPath)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(inside(root, entries[i]!.tmpRel), normalized[i]!.content, { encoding: 'utf-8', flag: 'wx' })
    }
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]!
      const dest = inside(root, entry.relPath)
      const exists = fs.existsSync(dest)
      if (exists && !fs.lstatSync(dest).isFile()) throw new Error(`事务目标不是普通文件:${entry.relPath}`)
      if (exists) fs.copyFileSync(dest, inside(root, entry.backupRel))
      const originalHash = exists ? createHash('sha256').update(fs.readFileSync(inside(root, entry.backupRel))).digest('hex') : null
      entries = entries.map((candidate, index) => index === i
        ? { ...candidate, hadOriginal: exists, backupRecorded: true, originalHash }
        : candidate)
      manifest = updateManifest(root, manifest, { phase: i === entries.length - 1 ? 'backed-up' : 'staged', entries })
    }
    manifest = updateManifest(root, manifest, { phase: 'applying', entries })
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]!
      entries = entries.map((candidate, index) => index === i ? { ...candidate, applied: true } : candidate)
      manifest = updateManifest(root, manifest, { entries })
      renameSync(inside(root, entry.tmpRel), inside(root, entry.relPath))
    }
    manifest = updateManifest(root, manifest, { phase: 'committed', entries })
    cleanupTransaction(root, id, entries)
  } catch (err) {
    if (manifest.phase === 'committed') return
    try { rollbackTransaction(root, manifest) } catch (rollbackErr) {
      throw new Error(`事务写入失败且恢复失败:${String(err)};${String(rollbackErr)}`)
    }
    throw new Error(`事务写入失败(已恢复):${String(err)}`)
  }
}

/** 让脚手架/诊断代码知道运行时目录属于本插件。 */
export function runtimeIgnoreLine(): string {
  return `${RUNTIME_DIR}/`
}
