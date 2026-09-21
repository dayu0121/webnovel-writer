import type { ComponentType, ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

export interface SessionList {
  readonly current?: string
  readonly byId: Record<string, { readonly cwd?: string; readonly blank?: boolean }>
}
export type UseSessions = <T>(selector: (state: SessionList) => T) => T
export type RenderSlot = (name: string, owner: object, options?: object) => ReactNode
export interface NativeEntry {
  readonly component: ComponentType<WorkspaceProps>
  readonly store?: unknown
  readonly locale?: string
  readonly inject?: (...args: never[]) => unknown
}
export interface WorkspaceProps {
  readonly wide: boolean
  readonly expandSidebar: () => void
  readonly renderSlot: RenderSlot
  readonly useSessions: UseSessions
}

export interface ClientHost {
  slots: {
    inject(name: string, callback: () => (() => void) | void): unknown
    register<P>(options: { name: string; id?: string; key?: string; label?: string; priority?: number; order?: number; children?: Record<string, { kind: string; scope: string }>; store?: unknown; locale?: string; inject?: (...args: never[]) => unknown }, component: ComponentType<P>): () => void
    entries(name: string): readonly NativeEntry[]
    subscribe(name: string, listener: () => void): () => void
  }
  sidebarRight: Context['sidebarRight']
  sidebarRightTabs: Context['sidebarRightTabs']
  sessions: {
    open(id: string): void
    scope(id: string): object | undefined
    list: { getSnapshot(): SessionList; subscribe(listener: () => void): () => void }
  }
  conversation: { input: { for(scope: object): { state: { getSnapshot(): { draft: string } }; setDraft(text: string): void } } }
  effect(callback: () => (() => void), label?: string): unknown
  inject(names: readonly string[], callback: (context: ClientHost) => unknown): unknown
  get(name: string): unknown
}

export interface NativeOpenService {
  openWorkspacePath(request: { path: string }, signal?: AbortSignal): Promise<unknown>
}
