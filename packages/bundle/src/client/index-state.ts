/** UI selection only; indexing state and lifecycle belong to the host. */
export function createIndexSelection() {
  const selected = new Map<string, string>()
  const listeners = new Set<() => void>()
  return {
    get(sessionId: string): string | undefined { return selected.get(sessionId) },
    choose(sessionId: string, space: string) { selected.set(sessionId, space); for (const listener of listeners) listener() },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    dispose() { selected.clear(); listeners.clear() },
  }
}
export type IndexSelection = ReturnType<typeof createIndexSelection>

export interface IndexViewVersion { readonly generation: number; readonly updatedAt: number }
export function isNewerIndexView(current: IndexViewVersion | undefined, next: IndexViewVersion): boolean {
  return !current || next.generation > current.generation || next.generation === current.generation && next.updatedAt >= current.updatedAt
}
