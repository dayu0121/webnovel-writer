import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { resolveInsideBook, type FileOp } from '@webnovel/core'
import type { PreToolExec } from './gates'
import type { ToolExecContext } from './novel-tools'

export type NativeWrite = (root: string, op: FileOp, exec?: ToolExecContext) => Promise<void>

/** One exact nested dispatch, scoped to this plugin's dependency lifetime. */
export function createNativeWriteBridge(runtime: Pick<ToolRuntime, 'execute'>) {
  const pending = new Map<string, { parent: symbol; agent: unknown; file: string; content: string }>()
  let disposed = false
  return {
    allows(exec: PreToolExec): boolean {
      if (disposed || exec.name !== 'write' || exec.callId === undefined) return false
      const grant = pending.get(exec.callId)
      const args = exec.arguments as Record<string, unknown> | undefined
      return grant !== undefined && exec.parent === grant.parent && exec.agent === grant.agent
        && args?.['file_path'] === grant.file && args?.['content'] === grant.content
    },
    dispose() { disposed = true; pending.clear() },
    async write(root: string, op: FileOp, exec?: ToolExecContext): Promise<void> {
      if (disposed || exec?.agent === undefined || exec.token === undefined || exec.signal === undefined) {
        throw new Error('原生写入上下文不可用，拒绝无版本保护的写入')
      }
      exec.signal.throwIfAborted()
      const target = resolveInsideBook(root, op.relPath)
      if (!target.ok) throw new Error('原生写入目标不在书仓内')
      const file = path.resolve(root, target.relPath)
      const callId = brandString<ToolCallId>(`webnovel-write-${randomUUID()}`)
      pending.set(callId, { parent: exec.token, agent: exec.agent, file, content: op.content })
      try {
        const result = await runtime.execute({
          callId, rootCallId: brandString<ToolCallId>(exec.rootCallId ?? exec.callId ?? callId),
          parent: exec.token, agent: exec.agent as Parameters<ToolRuntime['execute']>[0]['agent'],
          signal: exec.signal, name: 'write', arguments: { file_path: file, content: op.content },
        })
        for (const context of result.additionalContexts ?? []) exec.deferContext?.(context)
        if (result.isError) throw new Error(result.error.message)
        if (result.concludesTurn) exec.concludeTurn?.()
      } finally {
        pending.delete(callId)
      }
    },
  }
}
