/** Shared by the browser settings, HTTP provider, and defensive search deadline. */
export const MIN_RERANK_TIMEOUT_MS = 100
export const DEFAULT_RERANK_TIMEOUT_MS = 30_000
export const MAX_RERANK_TIMEOUT_MS = 120_000

/** Older or malformed provider metadata retains a finite default deadline. */
export function rerankTimeoutMs(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= MIN_RERANK_TIMEOUT_MS && value <= MAX_RERANK_TIMEOUT_MS ? value : DEFAULT_RERANK_TIMEOUT_MS
}
