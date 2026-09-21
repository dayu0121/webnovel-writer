/** Canonical book-level coordination for synchronous and asynchronous writes. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { canonicalizePath } from '../gate/canonical'

export const RUNTIME_DIR = '.webnovel'
export const TRANSACTION_DIR = `${RUNTIME_DIR}/transactions`
export const OPERATION_DIR = `${RUNTIME_DIR}/operations`

export interface BookLockOptions {
  readonly operationId?: string
  readonly sessionId?: string
  readonly agentId?: string
  readonly toolName?: string
  readonly callId?: string
  readonly targets?: readonly string[]
}

interface HeldLock {
  provenance: BookLockOptions
  auditEnabled: boolean
  readonly targets: Set<string>
}

const held = new Map<string, HeldLock>()
const asyncHeld = new Map<string, HeldLock>()
const asyncOwner = new AsyncLocalStorage<ReadonlyMap<string, HeldLock>>()
function keyOf(root: string): string {
  const canonical = canonicalizePath(root)
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

function hasProvenance(options: BookLockOptions): boolean {
  return Object.entries(options).some(([key, value]) => key !== 'targets' && value !== undefined)
}

function mergeOptions(state: HeldLock, options: BookLockOptions): void {
  state.auditEnabled ||= hasProvenance(options)
  state.provenance = { ...options, ...state.provenance }
  for (const target of options.targets ?? []) state.targets.add(target)
}

export function currentBookProvenance(root: string): BookLockOptions | undefined {
  const state = ownedState(keyOf(root))
  return state?.auditEnabled ? { ...state.provenance, targets: [...state.targets] } : undefined
}

export function updateOperationTargets(root: string, provenance: BookLockOptions | undefined, targets: readonly string[]): void {
  const state = ownedState(keyOf(root))
  if (state !== undefined) mergeOptions(state, { ...provenance, targets })
}

function ensureRuntimeIgnored(root: string): void {
  try {
    const dotGit = path.join(root, '.git')
    let dir = dotGit
    if (fs.statSync(dotGit).isFile()) {
      const pointer = /^\s*gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf-8'))?.[1]
      if (!pointer) return
      dir = path.resolve(root, pointer)
    }
    const common = path.join(dir, 'commondir')
    if (fs.existsSync(common)) dir = path.resolve(dir, fs.readFileSync(common, 'utf-8').trim())
    const exclude = path.join(dir, 'info', 'exclude')
    const text = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf-8') : ''
    if (text.split(/\r?\n/).includes(`/${RUNTIME_DIR}/`)) return
    fs.mkdirSync(path.dirname(exclude), { recursive: true })
    fs.appendFileSync(exclude, `${text.endsWith('\n') || text === '' ? '' : '\n'}/${RUNTIME_DIR}/\n`, 'utf-8')
  } catch { /* Ignore configuration is diagnostic, not a write precondition. */ }
}

function ownerIsDead(lock: string): boolean {
  try {
    const owner: unknown = JSON.parse(fs.readFileSync(lock, 'utf-8'))
    if (owner === null || typeof owner !== 'object' || !('pid' in owner)) return false
    const pid = owner.pid
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
    try { process.kill(pid, 0) } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH'
    }
  } catch { /* Unknown ownership must fail closed. */ }
  return false
}

function releaseOwned(file: string, owner: string): void {
  try {
    if (fs.readFileSync(file, 'utf-8') === owner) fs.unlinkSync(file)
  } catch { /* Preserve the operation result; an orphan lock will be diagnosed. */ }
}

function acquire(root: string, provenance: BookLockOptions): () => void {
  const runtime = path.join(root, RUNTIME_DIR)
  if (fs.existsSync(runtime) && fs.lstatSync(runtime).isSymbolicLink()) throw new Error('书仓运行目录不得为符号链接')
  fs.mkdirSync(runtime, { recursive: true })
  const owner = JSON.stringify({ ...provenance, pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() })
  const guard = path.join(runtime, 'acquire.lock')
  const lock = path.join(runtime, 'book.lock')
  // This short guard prevents two stale-lock reclaimers from deleting a new
  // owner's lock. An interrupted guard remains for explicit inspection.
  try { fs.writeFileSync(guard, owner, { flag: 'wx', mode: 0o600 }) } catch (error) {
    if (fs.existsSync(guard)) throw new Error('书仓锁获取中或锁获取曾中断，请检查 acquire.lock')
    throw error
  }
  try {
    if (fs.existsSync(lock)) {
      if (!ownerIsDead(lock)) throw new Error(`书仓写入锁定中:${root}`)
      fs.unlinkSync(lock)
    }
    fs.writeFileSync(lock, owner, { flag: 'wx', mode: 0o600 })
  } finally {
    releaseOwned(guard, owner)
  }
  return () => releaseOwned(lock, owner)
}

function audit(root: string, state: HeldLock, startedAt: string, status: 'running' | 'completed' | 'failed', error?: unknown): void {
  const id = state.provenance.operationId!
  const name = /^[A-Za-z0-9._-]{1,120}$/.test(id) ? id : createHash('sha256').update(id).digest('hex')
  const file = path.join(root, OPERATION_DIR, `${name}.json`)
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(temp, JSON.stringify({
      schemaVersion: 1, ...state.provenance, targets: [...state.targets],
      status, startedAt, updatedAt: new Date().toISOString(),
      ...(error === undefined ? {} : { error: String(error) }),
    }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    fs.renameSync(temp, file)
  } catch { /* Audit failures must not turn a completed write into a failure. */ }
  finally { try { fs.unlinkSync(temp) } catch { /* Already renamed or never created. */ } }
}

export function withBookLock<T>(bookRoot: string, operation: () => T, options: BookLockOptions = {}): T {
  const root = canonicalizePath(bookRoot)
  const key = keyOf(root)
  const existing = ownedState(key)
  if (existing !== undefined) {
    mergeOptions(existing, options)
    return operation()
  }
  const provenance = { ...options, operationId: options.operationId ?? `op-${randomUUID()}` }
  const release = acquire(root, provenance)
  const state: HeldLock = { provenance, auditEnabled: hasProvenance(options), targets: new Set(options.targets) }
  held.set(key, state)
  const startedAt = new Date().toISOString()
  let failed: unknown
  try {
    ensureRuntimeIgnored(root)
    if (state.auditEnabled) audit(root, state, startedAt, 'running')
    const result = operation()
    if (result !== null && typeof result === 'object') {
      if ('then' in result && typeof result.then === 'function') throw new Error('书仓写入临界区必须同步，作者问答须在获取锁之前完成')
      if ('ok' in result && result.ok === false) failed = 'reason' in result ? result.reason : 'operation returned ok:false'
    }
    return result
  } catch (error) {
    failed = error
    throw error
  } finally {
    if (state.auditEnabled) audit(root, state, startedAt, failed === undefined ? 'completed' : 'failed', failed)
    held.delete(key)
    release()
  }
}

function ownedState(key: string): HeldLock | undefined {
  const active = asyncHeld.get(key)
  if (active !== undefined) {
    if (asyncOwner.getStore()?.get(key) !== active) throw new Error(`书仓写入锁定中:${key}`)
    return active
  }
  return held.get(key)
}

/** Native filesystem dispatch may await; only this async chain may reenter its lock. */
export async function withBookLockAsync<T>(bookRoot: string, operation: () => Promise<T>, options: BookLockOptions = {}): Promise<T> {
  const root = canonicalizePath(bookRoot)
  const key = keyOf(root)
  const existing = ownedState(key)
  if (existing !== undefined) {
    if (held.has(key)) throw new Error('同步书仓锁内不得启动异步写入')
    mergeOptions(existing, options)
    return operation()
  }
  const provenance = { ...options, operationId: options.operationId ?? `op-${randomUUID()}` }
  const release = acquire(root, provenance)
  const state: HeldLock = { provenance, auditEnabled: hasProvenance(options), targets: new Set(options.targets) }
  asyncHeld.set(key, state)
  const owners = new Map(asyncOwner.getStore())
  owners.set(key, state)
  const startedAt = new Date().toISOString()
  let failed: unknown
  try {
    ensureRuntimeIgnored(root)
    if (state.auditEnabled) audit(root, state, startedAt, 'running')
    const result = await asyncOwner.run(owners, operation)
    if (result !== null && typeof result === 'object' && 'ok' in result && result.ok === false) {
      failed = 'reason' in result ? result.reason : 'operation returned ok:false'
    }
    return result
  } catch (error) {
    failed = error
    throw error
  } finally {
    if (state.auditEnabled) audit(root, state, startedAt, failed === undefined ? 'completed' : 'failed', failed)
    asyncHeld.delete(key)
    release()
  }
}
