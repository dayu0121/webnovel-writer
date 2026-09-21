import { CHUNK_VERSION, digest } from './source'
import type { EmbeddingInput, EmbeddingProvider, SearchDocument, SearchSnapshot } from './types'

export function embeddingRevision(provider: EmbeddingProvider | undefined): string | undefined {
  return provider && digest(JSON.stringify([
    provider.metadata.provider, provider.metadata.model, provider.metadata.dimensions, provider.metadata.revision, CHUNK_VERSION,
  ]))
}

export function embeddingInputKey(input: EmbeddingInput, revision: string): string {
  return digest(JSON.stringify(['document', revision, input.title ?? '', input.text]))
}

export interface IndexedEmbeddingInput {
  readonly key: string
  readonly input: EmbeddingInput
  readonly chunkIds: string[]
  readonly documents: Map<string, SearchDocument>
}

/** Locations may change while identical provider inputs continue to reuse one vector. */
export function snapshotInputs(snapshot: SearchSnapshot, revision: string): Map<string, IndexedEmbeddingInput> {
  const inputs = new Map<string, IndexedEmbeddingInput>()
  for (const document of snapshot.documents) for (const chunk of document.chunks) {
    const input = { text: chunk.text, title: document.title }
    const key = embeddingInputKey(input, revision)
    const entry: IndexedEmbeddingInput = inputs.get(key) ?? { key, input, chunkIds: [], documents: new Map() }
    entry.chunkIds.push(chunk.id)
    entry.documents.set(document.path, document)
    inputs.set(key, entry)
  }
  return inputs
}
