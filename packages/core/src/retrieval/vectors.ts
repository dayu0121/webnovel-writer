import { SearchError } from './types'

export const MAX_VECTOR_DIMENSIONS = 65_536

/** Validate arbitrary providers too, not just our HTTP implementation. */
export function normalizedVector(value: unknown, dimensions?: number): Float32Array {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_VECTOR_DIMENSIONS
    || (dimensions !== undefined && value.length !== dimensions)) {
    throw new SearchError('invalid-embedding', '嵌入向量维数不匹配')
  }
  let maximum = 0
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item)) throw new SearchError('invalid-embedding', '嵌入向量包含无效数值')
    maximum = Math.max(maximum, Math.abs(item))
  }
  if (maximum === 0) throw new SearchError('invalid-embedding', '嵌入向量不能全为零')
  const scaledNorm = Math.sqrt(value.reduce((sum: number, item: number) => sum + (item / maximum) ** 2, 0))
  return Float32Array.from(value, (item: number) => (item / maximum) / scaledNorm)
}

export function vectorBytes(vector: Float32Array): Buffer {
  const bytes = Buffer.alloc(vector.length * 4)
  vector.forEach((value, index) => bytes.writeFloatLE(value, index * 4))
  return bytes
}

export function readVector(bytes: unknown, dimensions: number): Float32Array | undefined {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== dimensions * 4) return undefined
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  try { return normalizedVector(Array.from({ length: dimensions }, (_, index) => buffer.readFloatLE(index * 4)), dimensions) }
  catch { return undefined }
}

export function cosine(left: Float32Array, right: Float32Array): number {
  let sum = 0
  for (let index = 0; index < left.length; index++) sum += left[index]! * right[index]!
  return sum
}

export function fuseRanks(keyword: readonly string[], semantic: readonly string[]): Array<{ id: string; matchedBy: ('keyword' | 'semantic')[]; score: number }> {
  const candidates = new Map<string, { id: string; matchedBy: ('keyword' | 'semantic')[]; score: number }>()
  for (const [kind, ids] of [['keyword', keyword], ['semantic', semantic]] as const) {
    for (const [index, id] of [...new Set(ids)].entries()) {
      const candidate = candidates.get(id) ?? { id, matchedBy: [], score: 0 }
      candidate.matchedBy.push(kind)
      candidate.score += 1 / (60 + index + 1)
      candidates.set(id, candidate)
    }
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score)
}
