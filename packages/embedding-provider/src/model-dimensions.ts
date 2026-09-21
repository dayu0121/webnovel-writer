/** Reviewed references, not a claim that every hosting API supports dimension selection. */
export interface ModelDimensionPreset {
  readonly id: string
  readonly aliases: readonly string[]
  readonly defaultDimension: number
  readonly options: readonly number[]
  readonly kind: 'fixed' | 'shortenable'
  readonly range?: readonly [number, number]
  readonly requestDimensions: 'supported' | 'service-dependent' | 'omit'
  readonly source: { readonly url: string; readonly label: string; readonly checkedOn: string }
}

const CHECKED_ON = '2026-09-12'
const MTEB = 'https://github.com/embeddings-benchmark/mteb/blob/4e24e0cf4fce71839bf3d792f40c2eac47ea92d6/mteb/models/model_implementations/'
const hf = (id: string) => ({ url: `https://huggingface.co/${id}`, label: '官方模型卡', checkedOn: CHECKED_ON })
const mteb = (file: string) => ({ url: `${MTEB}${file}.py`, label: 'MTEB 模型元数据', checkedOn: CHECKED_ON })
const api = (url: string) => ({ url, label: '官方接口文档', checkedOn: CHECKED_ON })

export const MODEL_DIMENSIONS: readonly ModelDimensionPreset[] = [
  {
    id: 'text-embedding-3-small', aliases: ['openai/text-embedding-3-small'],
    defaultDimension: 1536, options: [1536, 1024, 768, 512, 256], kind: 'shortenable', requestDimensions: 'supported',
    source: api('https://developers.openai.com/api/docs/guides/embeddings'),
  },
  {
    id: 'text-embedding-3-large', aliases: ['openai/text-embedding-3-large'],
    defaultDimension: 3072, options: [3072, 1536, 1024, 768, 512, 256], kind: 'shortenable', requestDimensions: 'supported',
    source: api('https://developers.openai.com/api/docs/guides/embeddings'),
  },
  {
    id: 'text-embedding-ada-002', aliases: ['openai/text-embedding-ada-002'],
    defaultDimension: 1536, options: [1536], kind: 'fixed', requestDimensions: 'omit', source: mteb('openai_models'),
  },
  {
    id: 'gemini-embedding-001', aliases: ['google/gemini-embedding-001'],
    defaultDimension: 3072, options: [3072, 1536, 768], kind: 'shortenable', requestDimensions: 'supported',
    source: api('https://ai.google.dev/gemini-api/docs/embeddings'),
  },
  {
    id: 'gemini-embedding-2', aliases: ['google/gemini-embedding-2'],
    defaultDimension: 3072, options: [3072, 1536, 768], kind: 'shortenable', range: [128, 3072], requestDimensions: 'supported',
    source: api('https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2'),
  },
  {
    id: 'Qwen/Qwen3-Embedding-0.6B', aliases: ['Qwen3-Embedding-0.6B'],
    defaultDimension: 1024, options: [1024, 768, 512, 256, 128, 64, 32], kind: 'shortenable', range: [32, 1024],
    requestDimensions: 'service-dependent', source: hf('Qwen/Qwen3-Embedding-0.6B'),
  },
  {
    id: 'Qwen/Qwen3-Embedding-4B', aliases: ['Qwen3-Embedding-4B'],
    defaultDimension: 2560, options: [2560, 2048, 1536, 1024, 768, 512, 256, 128, 64, 32], kind: 'shortenable', range: [32, 2560],
    requestDimensions: 'service-dependent', source: hf('Qwen/Qwen3-Embedding-4B'),
  },
  {
    id: 'Qwen/Qwen3-Embedding-8B', aliases: ['Qwen3-Embedding-8B'],
    defaultDimension: 4096, options: [4096, 3072, 2048, 1536, 1024, 768, 512, 256, 128, 64, 32], kind: 'shortenable', range: [32, 4096],
    requestDimensions: 'service-dependent', source: hf('Qwen/Qwen3-Embedding-8B'),
  },
  {
    id: 'BAAI/bge-m3', aliases: ['bge-m3'], defaultDimension: 1024, options: [1024], kind: 'fixed',
    requestDimensions: 'omit', source: hf('BAAI/bge-m3'),
  },
  {
    id: 'BAAI/bge-large-zh-v1.5', aliases: ['bge-large-zh-v1.5'], defaultDimension: 1024, options: [1024], kind: 'fixed',
    requestDimensions: 'omit', source: hf('BAAI/bge-large-zh-v1.5'),
  },
  {
    id: 'BAAI/bge-base-zh-v1.5', aliases: ['bge-base-zh-v1.5'], defaultDimension: 768, options: [768], kind: 'fixed',
    requestDimensions: 'omit', source: hf('BAAI/bge-base-zh-v1.5'),
  },
  {
    id: 'intfloat/multilingual-e5-large', aliases: ['multilingual-e5-large'], defaultDimension: 1024, options: [1024], kind: 'fixed',
    requestDimensions: 'omit', source: mteb('e5_models'),
  },
  {
    id: 'intfloat/multilingual-e5-large-instruct', aliases: ['multilingual-e5-large-instruct'], defaultDimension: 1024, options: [1024], kind: 'fixed',
    requestDimensions: 'omit', source: mteb('e5_instruct'),
  },
  {
    id: 'Alibaba-NLP/gte-multilingual-base', aliases: ['gte-multilingual-base'],
    defaultDimension: 768, options: [768, 512, 256, 128], kind: 'shortenable', range: [128, 768],
    requestDimensions: 'service-dependent', source: hf('Alibaba-NLP/gte-multilingual-base'),
  },
  {
    id: 'Alibaba-NLP/gte-Qwen2-1.5B-instruct', aliases: ['gte-Qwen2-1.5B-instruct'], defaultDimension: 1536, options: [1536], kind: 'fixed',
    requestDimensions: 'omit', source: hf('Alibaba-NLP/gte-Qwen2-1.5B-instruct'),
  },
  {
    id: 'Alibaba-NLP/gte-Qwen2-7B-instruct', aliases: ['gte-Qwen2-7B-instruct'], defaultDimension: 3584, options: [3584], kind: 'fixed',
    requestDimensions: 'omit', source: hf('Alibaba-NLP/gte-Qwen2-7B-instruct'),
  },
  {
    id: 'jinaai/jina-embeddings-v3', aliases: ['jina-embeddings-v3'],
    defaultDimension: 1024, options: [1024, 768, 512, 256, 128, 64, 32], kind: 'shortenable',
    requestDimensions: 'service-dependent', source: hf('jinaai/jina-embeddings-v3'),
  },
  {
    id: 'nomic-ai/nomic-embed-text-v1.5', aliases: ['nomic-embed-text-v1.5'],
    defaultDimension: 768, options: [768, 512, 256, 128, 64], kind: 'shortenable',
    requestDimensions: 'service-dependent', source: hf('nomic-ai/nomic-embed-text-v1.5'),
  },
]
