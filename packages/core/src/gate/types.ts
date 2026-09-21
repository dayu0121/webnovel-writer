/**
 * dsh tools/pre-execute 最小本地类型(不依赖 @deepseek-ai/dsh-tools)。
 * 表面与 dsh 0.1.1-rc.2 对齐:allow / deny / ask。
 */

export type PreToolDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deny'; readonly reason: string }
  | { readonly kind: 'ask'; readonly reason?: string }

/** 门禁只需工具名与参数;其余 ToolExecution 字段由宿主持有。 */
export interface ToolCall {
  readonly name: string
  readonly arguments: unknown
}

export type FileAccessDecision =
  | { readonly allow: true; readonly zone: '草稿区'; readonly relPath: string }
  | { readonly allow: false; readonly reason: string; readonly zone?: string; readonly relPath?: string }
