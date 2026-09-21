import type { 来源标注 } from '../provenance'

/** Neutral producer contract; providers do not receive book paths or filesystem access. */
export interface EmbeddingInput {
  readonly text: string
  readonly title?: string
}

export interface EmbeddingProvider {
  readonly metadata: {
    readonly provider: string
    readonly model: string
    readonly dimensions?: number
    readonly revision: string
    /** Maximum inputs accepted by one non-retrying batch request. */
    readonly batchSize?: number
  }
  embed(inputs: readonly EmbeddingInput[], role: 'document' | 'query', signal?: AbortSignal): Promise<readonly (readonly number[])[]>
  /** One transport attempt; the background coordinator owns its retry budget. */
  embedBatch?(inputs: readonly EmbeddingInput[], role: 'document' | 'query', signal?: AbortSignal): Promise<readonly (readonly number[])[]>
}

export interface SearchIssue {
  readonly path: string
  readonly code: 'invalid-document' | 'read-error' | 'unsafe-path'
  readonly message: string
}

export interface SearchChunk {
  readonly id: string
  readonly path: string
  readonly start: number
  readonly end: number
  readonly startLine: number
  readonly endLine: number
  readonly text: string
  readonly scene?: { readonly id: string; readonly startLine: number; readonly endLine: number }
}

export interface SearchDocument {
  readonly path: string
  readonly absolutePath: string
  readonly hash: string
  readonly version: string | number
  readonly volume: number
  readonly chapter: number
  readonly title: string
  readonly chunks: readonly SearchChunk[]
  readonly prose: string
  readonly bodyHash: string
  readonly sceneStatus?: 'ready' | 'fallback'
  readonly sceneReason?: string
}

export interface SearchSnapshot {
  readonly documents: readonly SearchDocument[]
  readonly issues: readonly SearchIssue[]
  readonly fingerprint: string
}

export interface FinalizedSearchHit {
  readonly relativePath: string
  readonly absolutePath: string
  readonly volume: number
  readonly chapter: number
  readonly title: string
  readonly startLine: number
  readonly endLine: number
  readonly snippet: string
  readonly version: string | number
  readonly hash: string
  readonly matchedBy: readonly ('keyword' | 'semantic')[]
  readonly 来源标注: 来源标注
  readonly scene?: SearchChunk['scene']
}

export type FinalizedSearchResult = {
  readonly ok: true
  readonly mode: 'hybrid' | 'keyword'
  readonly status: 'matches' | 'no-matches' | 'no-finalized' | 'partial'
  readonly query: string
  readonly hits: readonly FinalizedSearchHit[]
  readonly limited: boolean
  readonly issues: readonly SearchIssue[]
  readonly degraded?: string
  readonly reranking?: { readonly applied: boolean; readonly model?: string; readonly candidates: number; readonly reason?: string }
  readonly index: {
    readonly state: 'created' | 'ready' | 'rebuilt'
    readonly chapters: number
    readonly chunks: number
    readonly embedded: number
    readonly reused: number
    readonly ready?: boolean
    readonly missing?: number
    readonly phase?: string
  }
  readonly message: string
} | { readonly ok: false; readonly code: string; readonly reason: string }

export class SearchError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'SearchError' }
}

export interface SceneProvider {
  readonly metadata: { readonly provider: string; readonly model: string; readonly revision: string; readonly concurrency?: number }
  /** One attempt; returns one-based final paragraph numbers, covering every paragraph. */
  segment(paragraphs: readonly string[], signal?: AbortSignal): Promise<readonly number[]>
}

export interface RerankingProvider {
  readonly metadata: {
    readonly provider: string
    readonly model: string
    readonly revision: string
    readonly candidates?: number
    /** Waiting budget shared with the search caller; milliseconds. */
    readonly timeoutMs?: number
  }
  /** Scores align with every input, regardless of the wire response order. */
  rerank(query: string, inputs: readonly EmbeddingInput[], signal?: AbortSignal): Promise<readonly number[]>
}
