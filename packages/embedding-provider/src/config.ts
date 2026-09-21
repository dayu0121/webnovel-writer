import z from '@deepseek-ai/schemastery'

export const SETTINGS_NAMESPACE = 'webnovel-embeddings'
export const DEFAULT_CREDENTIAL = 'WEBNOVEL_EMBEDDING_API_KEY'

export interface EmbeddingSettings {
  enabled?: boolean
  protocol?: 'openai-compatible' | 'gemini-native'
  baseURL?: string
  model?: string
  dimensions?: number
  apiKeyEnv?: string
  batchSize?: number
  timeoutMs?: number
  maxRetries?: number
  sendDimensions?: boolean
  documentPrefix?: string
  queryPrefix?: string
  geminiTaskMode?: 'native' | 'instruction'
}

export const Config: z<EmbeddingSettings> = z.object({
  enabled: z.boolean().default(false).description('启用语义检索；后台索引向所配置服务发送已启用书仓的定稿片段，检索时发送查询'),
  protocol: z.union(['openai-compatible', 'gemini-native']).default('openai-compatible').description('嵌入 API 协议'),
  baseURL: z.string().description('API 基础地址'),
  model: z.string().description('向量模型名称'),
  dimensions: z.number().step(1).min(1).max(65_536).description('向量维度，启用前必填；用于请求和响应校验'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_CREDENTIAL),
  batchSize: z.number().step(1).min(1).max(128).default(32),
  timeoutMs: z.number().step(1).min(100).max(120_000).default(30_000),
  maxRetries: z.number().step(1).min(0).max(3).default(2),
  sendDimensions: z.boolean().default(true).description('将配置维度发送给 API；固定维度接口可关闭，响应仍严格校验'),
  documentPrefix: z.string().default(''),
  queryPrefix: z.string().default(''),
  geminiTaskMode: z.union(['native', 'instruction']).default('native'),
})

export interface ResolvedEmbeddingSettings extends Required<Omit<EmbeddingSettings, 'enabled'>> {}

export function resolveSettings(input: EmbeddingSettings): ResolvedEmbeddingSettings | undefined {
  if (!input.enabled) return undefined
  if (!input.baseURL?.trim() || !input.model?.trim()) throw new Error('启用前请填写 API 地址和向量模型')
  let url: URL
  try { url = new URL(input.baseURL) } catch { throw new Error('嵌入 API 地址无效') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('嵌入 API 地址须为不含密钥、查询参数或片段的 HTTP(S) 地址')
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('外部嵌入服务须使用 HTTPS，本机服务可使用 HTTP')
  }
  const integer = (value: number | undefined, fallback: number, min: number, max: number, label: string) => {
    const resolved = value ?? fallback
    if (!Number.isInteger(resolved) || resolved < min || resolved > max) throw new Error(`${label}须为 ${min}–${max} 的整数`)
    return resolved
  }
  const dimensions = integer(input.dimensions, 0, 1, 65_536, '向量维度')
  const protocol = input.protocol ?? 'openai-compatible'
  if (protocol !== 'openai-compatible' && protocol !== 'gemini-native') throw new Error('不支持的嵌入 API 协议')
  const model = protocol === 'gemini-native' ? input.model.trim().replace(/^models\//, '') : input.model.trim()
  if (model.length > 200 || /[\r\n\0]/.test(model) || (protocol === 'gemini-native' && !/^[A-Za-z0-9._-]+$/.test(model))) {
    throw new Error('向量模型名称无效')
  }
  const apiKeyEnv = input.apiKeyEnv ?? DEFAULT_CREDENTIAL
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) throw new Error('凭据引用名称无效')
  if ((input.documentPrefix?.length ?? 0) > 4096 || (input.queryPrefix?.length ?? 0) > 4096) throw new Error('嵌入指令前缀过长')
  if (input.geminiTaskMode !== undefined && input.geminiTaskMode !== 'native' && input.geminiTaskMode !== 'instruction') throw new Error('Gemini 角色配置无效')
  return {
    protocol, baseURL: url.href.replace(/\/+$/, ''), model, dimensions, apiKeyEnv,
    batchSize: integer(input.batchSize, 32, 1, 128, '批量大小'),
    timeoutMs: integer(input.timeoutMs, 30_000, 100, 120_000, '请求超时'),
    maxRetries: integer(input.maxRetries, 2, 0, 3, '重试次数'),
    sendDimensions: input.sendDimensions ?? true,
    documentPrefix: input.documentPrefix ?? '', queryPrefix: input.queryPrefix ?? '',
    geminiTaskMode: input.geminiTaskMode ?? 'native',
  }
}
