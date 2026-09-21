import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { HttpEmbeddingProvider, parseRetryAfter } from '../src/http'
import { resolveSettings, type EmbeddingSettings } from '../src/config'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })

async function fixture(handler: (body: any, req: IncomingMessage, res: ServerResponse, call: number) => void) {
  let calls = 0
  const server = createServer((req, res) => {
    void (async () => {
      let text = ''
      for await (const part of req) text += part
      calls++
      handler(text ? JSON.parse(text) : undefined, req, res, calls)
    })().catch(() => res.destroy())
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, calls: () => calls }
}
const json = (response: ServerResponse, body: unknown) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(body)) }
function provider(url: string, options: EmbeddingSettings = {}, key: () => Promise<string | undefined> = async () => 'fixture-key') {
  const client = new HttpEmbeddingProvider(resolveSettings({ enabled: true, baseURL: url, model: 'fixture-model', dimensions: 3, maxRetries: 0, ...options })!, key)
  cleanups.push(() => client.close())
  return client
}
const texts = [{ text: 'alpha', title: '第1章' }, { text: 'beta', title: '第2章' }]

describe('外部嵌入协议（真实本地 HTTP）', () => {
  it('后台单批仅发起一次请求，保留 HTTP 状态及 Retry-After', async () => {
    const api = await fixture((_body, _req, res) => {
      res.statusCode = 429; res.setHeader('retry-after', '7'); json(res, { error: 'not echoed' })
    })
    await expect(provider(api.url, { maxRetries: 3 }).embedBatch([{ text: '批次' }], 'document')).rejects.toMatchObject({ code: 'http-error', httpStatus: 429, retryAfterMs: 7000 })
    expect(api.calls()).toBe(1)
    const now = Date.UTC(2026, 8, 12, 10, 0, 0)
    expect(parseRetryAfter('Sat, 12 Sep 2026 10:00:09 GMT', now)).toBe(9000)
    expect(parseRetryAfter('Sat, 12 Sep 2026 09:00:00 GMT', now)).toBe(0)
    expect(parseRetryAfter('invalid', now)).toBeUndefined()
  })
  it('获取模型列表保留维度元数据，不发送嵌入文本', async () => {
    const api = await fixture((body, req, res) => {
      expect(req.method).toBe('GET'); expect(req.url).toBe('/v1/models'); expect(body).toBeUndefined()
      expect(req.headers.authorization).toBe('Bearer fixture-key')
      json(res, { data: [{ id: 'custom-embedding', supported_dimensions: [3, 2, 3], default_dimension: 3 }, { id: 'invalid-metadata', dimensions: -1 }] })
    })
    expect(await provider(api.url + '/embeddings').listModels()).toEqual({ models: [{ id: 'custom-embedding', dimensions: [3, 2], defaultDimension: 3 }, { id: 'invalid-metadata' }], limited: false })
  })

  it('Gemini 模型列表分页并过滤聊天模型', async () => {
    const api = await fixture((_body, req, res, call) => {
      expect(req.headers['x-goog-api-key']).toBe('fixture-key')
      const url = new URL(req.url!, api.url)
      expect(url.searchParams.get('pageToken')).toBe(call === 1 ? null : 'page-two')
      json(res, call === 1 ? { models: [{ name: 'models/chat', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'page-two' } : { models: [{ name: 'models/embed', supportedGenerationMethods: ['embedContent'] }] })
    })
    expect((await provider(api.url, { protocol: 'gemini-native' }).listModels()).models.map(model => model.id)).toEqual(['embed'])
    expect(api.calls()).toBe(2)
  })

  it('拒绝重复分页游标，避免无限请求', async () => {
    const api = await fixture((_body, _req, res) => json(res, { models: [], nextPageToken: 'same' }))
    await expect(provider(api.url, { protocol: 'gemini-native' }).listModels()).rejects.toThrow('分页游标')
    expect(api.calls()).toBe(2)
  })

  it.each(['openai-compatible', 'gemini-native'] as const)('检测 %s 默认维度省略维度参数，只发送固定文本', async protocol => {
    const api = await fixture((body, _req, res) => {
      if (protocol === 'openai-compatible') {
        expect(body.dimensions).toBeUndefined(); expect(body.input).toEqual(['Embedding dimension check.'])
        json(res, { data: [{ index: 0, embedding: [1, 2, 3, 4] }] })
      } else {
        expect(body.requests).toHaveLength(1); expect(body.requests[0].embedContentConfig.outputDimensionality).toBeUndefined()
        json(res, { embeddings: [{ values: [1, 2, 3, 4] }] })
      }
    })
    expect(await provider(api.url, { protocol }).probeDimensions()).toBe(4)
    expect(api.calls()).toBe(1)
  })

  it('OpenAI 格式发送维度、恢复乱序索引、按调用读取轮换凭据', async () => {
    let key = 'first-key'
    const seen: any[] = []
    const api = await fixture((body, req, res) => {
      seen.push({ body, url: req.url, key: req.headers.authorization })
      json(res, { data: body.input.map((_text: string, index: number) => ({ index, embedding: [index + 1, 0, 1] })).reverse() })
    })
    const client = provider(api.url, {}, async () => key)
    expect(await client.embed(texts, 'document')).toEqual([[1, 0, 1], [2, 0, 1]])
    expect(seen[0]).toMatchObject({ url: '/v1/embeddings', key: 'Bearer first-key', body: { dimensions: 3, encoding_format: 'float', input: ['第1章\nalpha', '第2章\nbeta'] } })
    key = 'second-key'
    await client.embed([{ text: '查询' }], 'query')
    expect(seen[1].key).toBe('Bearer second-key')
    expect(seen[1].body.input).toEqual(['查询'])
  })

  it('Gemini 原生逐文本请求，设置新配置字段、角色与输出维度', async () => {
    const seen: any[] = []
    const api = await fixture((body, req, res) => {
      seen.push({ body, url: req.url, key: req.headers['x-goog-api-key'] })
      json(res, { embeddings: body.requests.map(() => ({ values: [1, 2, 3] })) })
    })
    const client = provider(api.url, { protocol: 'gemini-native', model: 'models/gemini-test' })
    expect(await client.embed(texts, 'document')).toHaveLength(2)
    expect(seen[0]).toMatchObject({ url: '/v1/models/gemini-test:batchEmbedContents', key: 'fixture-key' })
    expect(seen[0].body.requests[0]).toEqual({
      model: 'models/gemini-test', content: { parts: [{ text: 'alpha' }] },
      embedContentConfig: { autoTruncate: false, outputDimensionality: 3, taskType: 'RETRIEVAL_DOCUMENT', title: '第1章' },
    })
    await client.embed([{ text: '查找' }], 'query')
    expect(seen[1].body.requests[0].embedContentConfig).toEqual({ autoTruncate: false, outputDimensionality: 3, taskType: 'RETRIEVAL_QUERY' })
  })

  it('固定维度 API 可不传尺寸参数，仍严格校验；角色前缀影响缓存版本', async () => {
    const api = await fixture((body, _req, res) => {
      expect(body.dimensions).toBeUndefined()
      expect(body.input).toEqual(['查找指令\n查询'])
      json(res, { data: [{ index: 0, embedding: [1, 0, 0] }] })
    })
    const first = provider(api.url, { sendDimensions: false, queryPrefix: '查找指令' })
    await first.embed([{ text: '查询' }], 'query')
    expect(first.metadata.dimensions).toBe(3)
    const changed = provider(api.url, { sendDimensions: false, dimensions: 4, queryPrefix: '查找指令' })
    expect(changed.metadata.revision).not.toBe(first.metadata.revision)
    expect(provider(api.url, { sendDimensions: false, queryPrefix: '另一指令' }).metadata.revision).not.toBe(first.metadata.revision)
  })

  it.each([
    { data: [] },
    { data: [{ index: 1, embedding: [1, 2, 3] }] },
    { data: [{ index: 0, embedding: [1, 2] }] },
    { data: [{ index: 0, embedding: [0, 0, 0] }] },
    { data: [{ index: 0, embedding: [null, 0, 0] }] },
  ])('拒绝无效响应而不返回错配向量：%j', async value => {
    const api = await fixture((_body, _req, res) => json(res, value))
    await expect(provider(api.url).embed([{ text: '正文' }], 'document')).rejects.toMatchObject({ code: 'invalid-response' })
    expect(api.calls()).toBe(1)
  })

  it('重复批次索引拒绝，空输入不被过滤后发出', async () => {
    const api = await fixture((_body, _req, res) => json(res, { data: [{ index: 0, embedding: [1, 0, 0] }, { index: 0, embedding: [0, 1, 0] }] }))
    const client = provider(api.url)
    await expect(client.embed(texts, 'document')).rejects.toMatchObject({ code: 'invalid-response' })
    await expect(client.embed([{ text: '' }, { text: '正文' }], 'document')).rejects.toMatchObject({ code: 'invalid-input' })
    expect(api.calls()).toBe(1)
  })

  it('批量分组保留顺序，临时故障有界重试，鉴权错误不回显正文', async () => {
    const api = await fixture((body, _req, res, call) => {
      if (call === 1) { res.statusCode = 429; res.end('private-response'); return }
      json(res, { data: body.input.map((value: string, index: number) => ({ index, embedding: [Number(value), 1, 0] })) })
    })
    expect(await provider(api.url, { batchSize: 2, maxRetries: 1 }).embed([1, 2, 3].map(value => ({ text: String(value) })), 'query')).toEqual([[1, 1, 0], [2, 1, 0], [3, 1, 0]])
    expect(api.calls()).toBe(3)
    const denied = await fixture((_body, _req, res) => { res.statusCode = 401; res.end('fixture-key private manuscript') })
    await expect(provider(denied.url, { maxRetries: 3 }).embed(texts, 'document')).rejects.toThrow('HTTP 401')
    expect(denied.calls()).toBe(1)
  })

  it('预取消不请求；等待凭据和网络时取消/卸载均能结束', async () => {
    let requested!: () => void
    const observed = new Promise<void>(resolve => { requested = resolve })
    const api = await fixture(() => requested())
    const client = provider(api.url)
    const before = new AbortController(); before.abort(new Error('预取消'))
    await expect(client.embed(texts, 'document', before.signal)).rejects.toThrow('预取消')
    expect(api.calls()).toBe(0)
    const pending = client.embed(texts, 'document')
    await observed
    const rejection = expect(pending).rejects.toMatchObject({ code: 'provider-changed' })
    await client.close(); await rejection
    const waitingKey = provider(api.url, {}, () => new Promise(() => {}))
    const keyOperation = waitingKey.embed(texts, 'document')
    const keyRejection = expect(keyOperation).rejects.toMatchObject({ code: 'provider-changed' })
    await waitingKey.close(); await keyRejection
  })

  it('超时重试次数有界，重定向不转发凭据', async () => {
    const slow = await fixture(() => {})
    await expect(provider(slow.url, { timeoutMs: 100, maxRetries: 1 }).embed(texts, 'document')).rejects.toMatchObject({ code: 'timeout' })
    expect(slow.calls()).toBe(2)
    const target = await fixture((_body, _req, res) => json(res, {}))
    const redirect = await fixture((_body, _req, res) => { res.statusCode = 307; res.setHeader('location', target.url + '/embeddings'); res.end() })
    await expect(provider(redirect.url).embed(texts, 'document')).rejects.toMatchObject({ code: 'transport' })
    expect(target.calls()).toBe(0)
  })
})

describe('设置约束', () => {
  it('未启用可保留空配置；启用必须给维度，且端点不得携带密钥', () => {
    expect(resolveSettings({})).toBeUndefined()
    for (const dimensions of [undefined, 0, -1, 1.5, 65_537]) expect(() => resolveSettings({ enabled: true, baseURL: 'https://example.invalid/v1', model: 'test', dimensions })).toThrow(/维度/)
    expect(() => resolveSettings({ enabled: true, baseURL: 'https://name:secret@example.invalid', model: 'test', dimensions: 3 })).toThrow(/地址/)
  })
})
