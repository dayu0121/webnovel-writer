import { createHash } from 'node:crypto'
import type { EmbeddingInput, EmbeddingProvider } from '@webnovel/core'
import type { ResolvedEmbeddingSettings } from './config'
import type { EmbeddingModelOption } from './models'

export class EmbeddingError extends Error {
  constructor(readonly code: string, message: string, readonly httpStatus?: number, readonly retryAfterMs?: number) { super(message); this.name = 'EmbeddingError' }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined
  const trimmed = value.trim()
  const milliseconds = /^\d+(?:\.\d+)?$/.test(trimmed) ? Number(trimmed) * 1000 : Date.parse(trimmed) - now
  return Number.isFinite(milliseconds) ? Math.max(0, Math.ceil(milliseconds)) : undefined
}

const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
    if (signal.aborted) abort()
  })
}

export class HttpEmbeddingProvider implements EmbeddingProvider {
  readonly metadata: EmbeddingProvider['metadata']
  readonly config: ResolvedEmbeddingSettings
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()

  constructor(config: ResolvedEmbeddingSettings, private readonly key: () => Promise<string | undefined>) {
    this.config = Object.freeze({ ...config })
    this.metadata = Object.freeze({
      provider: config.protocol, model: config.model, dimensions: config.dimensions, batchSize: config.batchSize,
      revision: createHash('sha256').update(JSON.stringify([
        'embedding-protocol-v1', config.protocol, config.baseURL, config.model, config.dimensions,
        config.documentPrefix, config.queryPrefix, config.geminiTaskMode, config.sendDimensions,
      ])).digest('hex'),
    })
  }

  async close(): Promise<void> {
    this.lifetime.abort(new EmbeddingError('provider-changed', '嵌入提供方已停用或配置已变更'))
    await Promise.allSettled([...this.pending])
  }

  embed(inputs: readonly EmbeddingInput[], role: 'document' | 'query', signal?: AbortSignal): Promise<readonly (readonly number[])[]> {
    const combined = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])])
    return this.track(this.run(inputs, role, combined))
  }

  embedBatch(inputs: readonly EmbeddingInput[], role: 'document' | 'query', signal?: AbortSignal): Promise<readonly (readonly number[])[]> {
    const combined = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])])
    if (inputs.length > this.config.batchSize) return Promise.reject(new EmbeddingError('invalid-input', '单次嵌入批量超过提供方配置'))
    return this.track(this.run(inputs, role, combined, 0))
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation)
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation))
    return operation
  }

  probeDimensions(signal?: AbortSignal): Promise<number> {
    const combined = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])])
    return this.track((async () => {
      const response = await this.request([{ text: 'Embedding dimension check.' }], 'query', combined, true)
      return this.parse(response, 1, null)[0]!.length
    })())
  }

  listModels(signal?: AbortSignal): Promise<{ models: EmbeddingModelOption[]; limited: boolean }> {
    const combined = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])])
    return this.track((async () => {
      const models = new Map<string, EmbeddingModelOption>()
      const cursors = new Set<string>()
      let cursor: string | undefined
      for (let page = 0; page < 20; page++) {
        const url = new URL(this.config.baseURL.replace(/\/embeddings$/, '') + '/models')
        if (this.config.protocol === 'gemini-native') {
          url.searchParams.set('pageSize', '1000')
          if (cursor) url.searchParams.set('pageToken', cursor)
        }
        const data = object(await this.send(url.href, 'GET', undefined, this.config.protocol === 'gemini-native' ? 'x-goog-api-key' : 'Authorization', combined))
        const raw = data?.data ?? data?.models
        const rows = Array.isArray(raw) ? raw : object(raw) ? Object.entries(raw as Record<string, unknown>).map(([id, value]) => ({ ...object(value), id })) : undefined
        if (!rows) throw new EmbeddingError('invalid-response', '服务未返回可识别的模型列表，可手动填写模型')
        for (const entry of rows) {
          const row = object(entry)
          if (!row) continue
          const methods = row.supportedGenerationMethods
          if (this.config.protocol === 'gemini-native' && Array.isArray(methods) && !methods.some(method => method === 'embedContent' || method === 'batchEmbedContents')) continue
          const name = row.displayName ?? row.name
          const rawId = row.id ?? row.name
          if (typeof rawId !== 'string' || !rawId || rawId.length > 200) continue
          const id = this.config.protocol === 'gemini-native' ? rawId.replace(/^models\//, '') : rawId
          const validDimension = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65_536
          const declared = row.supported_dimensions ?? row.supportedDimensions ?? row.embedding_dimensions
          const dimensions = Array.isArray(declared) && declared.length <= 64 && declared.every(validDimension) ? [...new Set(declared)] : undefined
          const defaultValue = row.default_dimension ?? row.embedding_dimension ?? row.dimensions
          models.set(id, { id, ...(typeof name === 'string' ? { name } : {}), ...(dimensions?.length ? { dimensions } : {}), ...(validDimension(defaultValue) ? { defaultDimension: defaultValue } : {}) })
          if (models.size >= 5000) return { models: [...models.values()], limited: true }
        }
        const next = data?.nextPageToken
        if (this.config.protocol !== 'gemini-native' || !next) return { models: [...models.values()], limited: data?.has_more === true }
        if (typeof next !== 'string' || next.length > 2048 || cursors.has(next)) throw new EmbeddingError('invalid-response', '模型列表分页游标无效或重复')
        cursors.add(next); cursor = next
      }
      return { models: [...models.values()], limited: true }
    })())
  }

  private async run(inputs: readonly EmbeddingInput[], role: 'document' | 'query', signal: AbortSignal, maxRetries = this.config.maxRetries): Promise<number[][]> {
    signal.throwIfAborted()
    if (role !== 'document' && role !== 'query') throw new EmbeddingError('invalid-input', '嵌入角色无效')
    if (inputs.some(input => typeof input.text !== 'string' || !input.text.trim() || input.text.length > 32_000)) {
      throw new EmbeddingError('invalid-input', '嵌入输入须为非空且长度受支持的文本；未过滤或截断输入')
    }
    const result: number[][] = []
    for (let offset = 0; offset < inputs.length; offset += this.config.batchSize) {
      signal.throwIfAborted()
      const batch = inputs.slice(offset, offset + this.config.batchSize)
      const response = await this.request(batch, role, signal, false, maxRetries)
      result.push(...this.parse(response, batch.length))
    }
    signal.throwIfAborted()
    return result
  }

  private payload(inputs: readonly EmbeddingInput[], role: 'document' | 'query', omitDimensions: boolean): { endpoint: string; body: unknown; keyHeader: string } {
    const c = this.config
    const prefix = role === 'document' ? c.documentPrefix : c.queryPrefix
    const nativeTasks = c.protocol === 'gemini-native' && c.geminiTaskMode === 'native'
    const text = (input: EmbeddingInput) => [prefix, ...(!nativeTasks && role === 'document' && input.title ? [input.title] : []), input.text].filter(Boolean).join('\n')
    if (c.protocol === 'openai-compatible') return {
      endpoint: c.baseURL.endsWith('/embeddings') ? c.baseURL : `${c.baseURL}/embeddings`, keyHeader: 'Authorization',
      body: { model: c.model, input: inputs.map(text), encoding_format: 'float', ...(c.sendDimensions && !omitDimensions ? { dimensions: c.dimensions } : {}) },
    }
    return {
      endpoint: `${c.baseURL}/models/${encodeURIComponent(c.model)}:batchEmbedContents`, keyHeader: 'x-goog-api-key',
      body: { requests: inputs.map(input => ({
        model: `models/${c.model}`, content: { parts: [{ text: text(input) }] },
        embedContentConfig: {
          autoTruncate: false,
          ...(c.sendDimensions && !omitDimensions ? { outputDimensionality: c.dimensions } : {}),
          ...(nativeTasks ? { taskType: role === 'document' ? 'RETRIEVAL_DOCUMENT' : 'RETRIEVAL_QUERY' } : {}),
          ...(nativeTasks && role === 'document' && input.title ? { title: input.title } : {}),
        },
      })) },
    }
  }

  private request(inputs: readonly EmbeddingInput[], role: 'document' | 'query', signal: AbortSignal, omitDimensions = false, maxRetries = this.config.maxRetries): Promise<unknown> {
    const payload = this.payload(inputs, role, omitDimensions)
    return this.send(payload.endpoint, 'POST', payload.body, payload.keyHeader, signal, maxRetries)
  }

  private async send(endpoint: string, method: 'GET' | 'POST', body: unknown, keyHeader: string, signal: AbortSignal, maxRetries = this.config.maxRetries): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted()
      let credential: string | undefined
      try { credential = await abortable(this.key(), signal) }
      catch { signal.throwIfAborted(); throw new EmbeddingError('credential-error', '无法读取嵌入凭据') }
      signal.throwIfAborted()
      if (!credential) throw new EmbeddingError('credential-missing', '嵌入 API Key 尚未配置')
      const timeout = AbortSignal.timeout(this.config.timeoutMs)
      const requestSignal = AbortSignal.any([signal, timeout])
      let response: Response
      try {
        response = await fetch(endpoint, {
          method, redirect: 'error', signal: requestSignal,
          headers: { 'content-type': 'application/json', [keyHeader]: keyHeader === 'Authorization' ? `Bearer ${credential}` : credential },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
      } catch {
        signal.throwIfAborted()
        if (attempt < maxRetries) { await this.retryDelay(attempt, signal); continue }
        throw new EmbeddingError(timeout.aborted ? 'timeout' : 'transport', timeout.aborted ? '嵌入请求超时' : '嵌入请求无法完成，请检查接口地址与网络')
      }
      if (!response.ok) {
        await response.body?.cancel()
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
        if ((response.status === 429 || [500, 502, 503, 504].includes(response.status)) && attempt < maxRetries && (retryAfterMs ?? 0) <= this.config.timeoutMs) {
          await this.retryDelay(attempt, signal, retryAfterMs)
          continue
        }
        throw new EmbeddingError('http-error', `嵌入服务返回 HTTP ${response.status}`, response.status, retryAfterMs)
      }
      try {
        const reader = response.body?.getReader()
        if (!reader) throw new Error('empty body')
        const parts: Uint8Array[] = []
        let length = 0
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            length += value.length
            if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('oversize response') }
            parts.push(value)
          }
        } finally { reader.releaseLock() }
        signal.throwIfAborted()
        return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown
      } catch {
        signal.throwIfAborted()
        if (timeout.aborted) {
          if (attempt < maxRetries) { await this.retryDelay(attempt, signal); continue }
          throw new EmbeddingError('timeout', '嵌入响应读取超时')
        }
        throw new EmbeddingError('invalid-response', '嵌入响应不是受支持的 JSON 或超过大小限制')
      }
    }
  }

  private retryDelay(attempt: number, signal: AbortSignal, minimumMs = 0): Promise<void> {
    const delay = Math.max(Number.isFinite(minimumMs) ? minimumMs : 0, 100 * 2 ** attempt)
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, delay)
      const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }

  private parse(response: unknown, count: number, expectedDimensions: number | null = this.config.dimensions): number[][] {
    const data = object(response)
    const rows = this.config.protocol === 'openai-compatible' ? data?.data : data?.embeddings
    if (!Array.isArray(rows) || rows.length !== count) throw new EmbeddingError('invalid-response', '嵌入响应数量与输入不一致')
    const result: number[][] = new Array(count)
    for (let position = 0; position < rows.length; position++) {
      const row = object(rows[position])
      const index = this.config.protocol === 'openai-compatible' ? row?.index : position
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= count || result[index] !== undefined) {
        throw new EmbeddingError('invalid-response', '嵌入响应索引重复或越界')
      }
      const vector: unknown = this.config.protocol === 'openai-compatible' ? row?.embedding : row?.values
      if (!Array.isArray(vector) || vector.length === 0 || vector.length > 65_536 || (expectedDimensions !== null && vector.length !== expectedDimensions)
        || vector.some(value => typeof value !== 'number' || !Number.isFinite(value)) || vector.every(value => value === 0)) {
        throw new EmbeddingError('invalid-response', '嵌入响应向量与配置维度不一致或包含无效数值')
      }
      result[index] = vector as number[]
    }
    return result
  }
}
