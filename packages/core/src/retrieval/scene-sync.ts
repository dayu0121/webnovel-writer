import { withBookLockAsync } from '../repo/lock'
import { readIndexState, writeIndexState, type IndexSyncState } from './state'
import { currentSceneRecord, proseParagraphs, readSceneRecords, SCENE_RULE_VERSION, validateSceneEnds, writeSceneRecords, type SceneRecord } from './scenes'
import { assertSourceSettled, digest, readFinalizedBytes, scanFinalized } from './source'
import { SearchError, type SceneProvider, type SearchDocument } from './types'
import { indexAbortable, indexFailure, retryDelayMs, type IndexRetryPolicy } from './retry'
import type { IndexClock } from './sync'

interface SceneSyncOptions {
  getProvider(): SceneProvider | undefined
  check(): void
  signal?: AbortSignal
  clock: IndexClock
  policy: IndexRetryPolicy
  progress(state: IndexSyncState): void
}

/** Called within the book's index lease; every completed chapter is a separate checkpoint. */
export async function syncSceneBoundaries(root: string, options: SceneSyncOptions): Promise<void> {
  let queue = Promise.resolve()
  const locked = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(() => withBookLockAsync(root, operation))
    queue = next.then(() => {}, () => {})
    return next
  }
  const provider = options.getProvider()
  if (!provider) return
  const controller = new AbortController()
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
  const check = () => {
    signal.throwIfAborted()
    options.check()
    if (options.getProvider() !== provider) throw new SearchError('provider-changed', '场景模型配置已变化')
  }
  const snapshot = await locked(async () => { check(); return scanFinalized(root, signal) })
  const documents = snapshot.documents.filter(doc => proseParagraphs(doc.prose).length > 0)
  const groups = new Map<string, SearchDocument[]>()
  const stats = { total: documents.length, completed: 0, generated: 0, reused: 0, fallback: 0, model: provider.metadata.model, warning: undefined as string | undefined }
  for (const doc of documents) {
    if (doc.sceneStatus) {
      stats.completed++
      if (doc.sceneStatus === 'ready') stats.reused++
      else { stats.fallback++; stats.warning = '第' + doc.chapter + '章：' + (doc.sceneReason ?? '场景识别未完成，已回退段落分块') }
    } else groups.set(doc.bodyHash, [...groups.get(doc.bodyHash) ?? [], doc])
  }
  const update = async (patch: Partial<IndexSyncState> = {}) => locked(async () => {
    check()
    const next = { ...readIndexState(root), ...patch, scenes: { ...stats }, updatedAt: options.clock.now() }
    writeIndexState(root, next)
    options.progress(next)
  })
  await update({ phase: 'scenes' })
  const pending = [...groups.values()]
  let cursor = 0
  const worker = async () => {
    while (cursor < pending.length) {
      check()
      const group = pending[cursor++]!
      const doc = group[0]!
      const paragraphs = proseParagraphs(doc.prose)
      const started = options.clock.now()
      let record: SceneRecord
      for (let attempt = 0; ; attempt++) {
        check()
        await update({ phase: 'scenes', retryAt: undefined, attempt })
        try {
          const ends = validateSceneEnds(await indexAbortable(provider.segment(paragraphs.map(p => p.text), signal), signal), paragraphs.length)
          record = { rule: SCENE_RULE_VERSION, paragraphs: paragraphs.length, ends, model: provider.metadata.provider + '/' + provider.metadata.model, status: 'ready' }
          break
        } catch (error) {
          check()
          const failure = indexFailure(error)
          const delay = retryDelayMs(attempt + 1, options.policy, failure.retryAfterMs, options.clock.random)
          if (failure.retryable && attempt < options.policy.maxRetries && options.clock.now() - started + delay < options.policy.budgetMs) {
            stats.warning = failure.message
            await update({ phase: 'retrying', retryAt: options.clock.now() + delay, attempt: attempt + 1 })
            await options.clock.sleep(delay, signal)
            continue
          }
          record = { rule: SCENE_RULE_VERSION, paragraphs: paragraphs.length, ends: [], model: provider.metadata.provider + '/' + provider.metadata.model,
            status: 'fallback', reason: '场景识别失败，已使用段落分块：' + failure.message }
          break
        }
      }
      await locked(async () => {
        check()
        assertSourceSettled(root)
        for (const source of group) {
          if (digest(await readFinalizedBytes(root, source.path, signal)) !== source.hash) throw new SearchError('source-changed', '定稿在场景识别期间已变化')
        }
        check()
        const records = readSceneRecords(root)
        const previous = currentSceneRecord(records, doc.bodyHash, paragraphs.length)
        if (!previous) {
          records[doc.bodyHash] = record
          writeSceneRecords(root, records)
        }
        const saved = previous ?? record
        stats.completed += group.length
        if (saved.status === 'ready') { if (previous) stats.reused += group.length; else stats.generated += group.length }
        else { stats.fallback += group.length; stats.warning = '第' + doc.chapter + '章：' + saved.reason }
        const next: IndexSyncState = { ...readIndexState(root), phase: 'scenes', scenes: { ...stats }, retryAt: undefined, updatedAt: options.clock.now() }
        writeIndexState(root, next)
        options.progress(next)
      })
    }
  }
  const requested = provider.metadata.concurrency ?? 2
  const workers = Array.from({ length: Math.min(pending.length, Number.isInteger(requested) ? Math.max(1, Math.min(requested, 8)) : 2) }, worker)
  try {
    await Promise.all(workers)
    if (!stats.fallback) stats.warning = undefined
    await update({ retryAt: undefined, attempt: 0 })
  }
  catch (error) { controller.abort(); await Promise.allSettled(workers); throw error }
}

/** Explicit user operation; ordinary vector rebuilds never call this. */
export async function forgetSceneBoundaries(root: string, chapter?: number): Promise<void> {
  if (chapter !== undefined && (!Number.isSafeInteger(chapter) || chapter < 1)) throw new SearchError('invalid-query', '重新识别的章号须为正整数')
  await withBookLockAsync(root, async () => {
    const records = readSceneRecords(root)
    const snapshot = await scanFinalized(root)
    const selected = chapter === undefined ? snapshot.documents : snapshot.documents.filter(doc => doc.chapter === chapter)
    if (chapter !== undefined && !selected.length) throw new SearchError('invalid-query', '找不到指定定稿章节')
    const state = readIndexState(root)
    // Invalidate other-process work before clearing boundaries. A crash leaves a resumable pause.
    writeIndexState(root, { ...state, generation: state.generation + 1, paused: true, phase: 'paused', updatedAt: Date.now() })
    if (chapter === undefined) writeSceneRecords(root, {})
    else {
      for (const doc of selected) delete records[doc.bodyHash]
      writeSceneRecords(root, records)
    }
  })
}
