import { createHash } from 'node:crypto'

export function shortStoryHash(value: string): string {
  return createHash('sha256').update(value.replace(/\r\n/g, '\n'), 'utf8').digest('hex')
}

export function shortStoryJsonHash(value: unknown): string {
  return shortStoryHash(JSON.stringify(value))
}

export function normalizeShortStoryProse(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\s+$/u, '').trim()
}

export function countShortStoryChars(value: string): number {
  return [...normalizeShortStoryProse(value)].length
}
