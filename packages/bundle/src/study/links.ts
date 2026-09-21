import type { FileRef } from './types'

export interface StudyLink { readonly sessionId: string; readonly ref: FileRef }

export function studyLink(origin: string, sessionId: string, ref: FileRef): string {
  const url = new URL('/', origin)
  url.searchParams.set('webnovel', JSON.stringify({ sessionId, ref }))
  return url.href
}

export function parseStudyLink(href: string, origin: string): StudyLink | undefined {
  try {
    const url = new URL(href, origin)
    if (url.origin !== new URL(origin).origin || url.pathname !== '/') return
    const raw: unknown = JSON.parse(url.searchParams.get('webnovel') ?? 'null')
    if (!raw || typeof raw !== 'object') return
    const input = raw as Record<string, unknown>
    if (typeof input['sessionId'] !== 'string' || !input['sessionId'] || !input['ref'] || typeof input['ref'] !== 'object') return
    const ref = input['ref'] as Record<string, unknown>
    if (typeof ref['space'] !== 'string' || typeof ref['path'] !== 'string' || !(ref['space'] === 'shared' || ref['space'].startsWith('book:'))) return
    return { sessionId: input['sessionId'], ref: { space: ref['space'], path: ref['path'] } }
  } catch { return }
}
