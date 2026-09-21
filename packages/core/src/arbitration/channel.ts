/**
 * 作者裁决通道包装:ask + interpret。单元测试注入假 askFn,不依赖直播 dsh。
 */

import type { IrreversibleKind } from './kinds'
import { buildAskRequest, interpretAnswer, type AskRequest, type AskResponse } from './ask'
import type { ArbitrationPayload } from './ask'
import type { 裁决决定 } from './record'

/**
 * 与 dsh `ctx.userQuestions.ask()` 同形。宿主直接把该方法传进来即可。
 *
 * `agent` 由调用方透传:dsh 靠它判定调用者是否活体运行时根,缺省则跳过该校验。
 * 非活体或被他人托管的 agent 会抛 `CALLER_NOT_LIVE` / `DELEGATED_CALLER`,
 * 本层不吞,原样上抛。
 */
export type AskFn = (request: AskRequest) => Promise<AskResponse>

/** 透传给 dsh 的调用者上下文。 */
export interface AskContext {
  readonly agent?: AskRequest['agent']
  readonly signal?: AbortSignal
}

export type AuthorDecision =
  | { readonly ok: true; readonly 决定: 裁决决定; readonly kind: IrreversibleKind }
  | { readonly ok: false; readonly reason: string; readonly kind: IrreversibleKind }

export async function askAuthor(
  askFn: AskFn,
  kind: IrreversibleKind,
  payload: ArbitrationPayload,
  askCtx?: AskContext,
): Promise<AuthorDecision> {
  const request = { ...buildAskRequest(kind, payload), ...askCtx }
  const signal = request.signal
  const cancelled: AuthorDecision = { ok: false, reason: '作者裁决已取消（ASK_ABORTED）', kind }
  if (signal?.aborted) return cancelled
  let onAbort: (() => void) | undefined
  try {
    // 答复器可能迟到或未响应取消；调用结束与写入许可不能依赖它主动拒绝。
    const cancellation = signal === undefined ? undefined : new Promise<undefined>((resolve) => {
      onAbort = () => { resolve(undefined) }
      signal.addEventListener('abort', onAbort, { once: true })
    })
    const pending = askFn(request)
    const response = cancellation === undefined ? await pending : await Promise.race([pending, cancellation])
    if (signal?.aborted || response === undefined) return cancelled
    const answer = response.answers.find((a) => a.id === kind) ?? response.answers[0]
    const interpreted = interpretAnswer(kind, answer)
    if (!interpreted.ok) return { ok: false, reason: interpreted.reason, kind }
    return { ok: true, 决定: interpreted.决定, kind }
  } finally {
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort)
  }
}
