import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { DEFAULT_CREDENTIAL, resolveSettings, type EmbeddingSettings } from './config'
import { EmbeddingError, HttpEmbeddingProvider } from './http'

/** Connection owns authentication, origin checks, request bounds and client cancellation. */
export function attachDiscovery(ctx: Context): void {
  ctx.inject(['connection'], scope => {
    const clients = new Set<HttpEmbeddingProvider>()
    scope.effect(() => () => Promise.allSettled([...clients].map(client => client.close())), 'webnovel embeddings: discovery requests')
    scope.connection.fetch.register({
      path: '/api/webnovel/embeddings', methods: ['POST'], requestBody: 'buffered',
      fetch: async request => {
        let client: HttpEmbeddingProvider | undefined
        try {
          const text = await request.text()
          if (text.length > 32_768) throw new EmbeddingError('invalid-input', '配置请求过大')
          const value: unknown = JSON.parse(text)
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EmbeddingError('invalid-input', '配置请求格式不正确')
          const input = value as Record<string, unknown>
          if (input.action !== 'models' && input.action !== 'dimensions') throw new EmbeddingError('invalid-input', '未知配置操作')
          if (typeof input.baseURL !== 'string' || typeof input.protocol !== 'string') throw new EmbeddingError('invalid-input', '请先填写接口地址和协议')
          if (input.action === 'dimensions' && (typeof input.model !== 'string' || !input.model.trim())) throw new EmbeddingError('invalid-input', '请先选择或填写向量模型')
          const config = resolveSettings({
            enabled: true, protocol: input.protocol as EmbeddingSettings['protocol'], baseURL: input.baseURL,
            model: typeof input.model === 'string' && input.model ? input.model : 'discovery',
            dimensions: 1, apiKeyEnv: typeof input.apiKeyEnv === 'string' ? input.apiKeyEnv : DEFAULT_CREDENTIAL,
            sendDimensions: false, maxRetries: 1,
          })!
          const key = typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : undefined
          if (key && !/^[\x21-\x7e]+$/.test(key)) throw new EmbeddingError('invalid-input', 'API Key 格式无效')
          client = new HttpEmbeddingProvider(config, async () => {
            try { return key ?? (await ctx.credentials.resolve(credentialRef(config.apiKeyEnv)))?.value }
            catch { throw new EmbeddingError('credential-error', '无法读取 API 凭据，请检查 DSH 凭据设置') }
          })
          clients.add(client)
          const result = input.action === 'models'
            ? await client.listModels(request.signal)
            : { dimensions: await client.probeDimensions(request.signal) }
          return Response.json({ ok: true, value: result }, { headers: { 'cache-control': 'no-store' } })
        } catch (error) {
          const message = error instanceof SyntaxError ? '配置请求不是有效 JSON' : error instanceof Error ? error.message : '接口查询失败'
          return Response.json({ ok: false, error: message }, { status: 400, headers: { 'cache-control': 'no-store' } })
        } finally { if (client) { clients.delete(client); await client.close() } }
      },
    })
  })
}
