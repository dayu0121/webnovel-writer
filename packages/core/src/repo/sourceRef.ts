/**
 * 来源引用语法(格式规格 §7.2,简化继承 v7 协议)。
 *
 * 四种合法形态:
 *   来源:<同仓路径>@<版本标识>
 *   来源:作者自定义
 *   来源:对谈共创
 *   来源:知识库/<库>/<条目路径>@<版本>   ← 只允许引用;正文仅可进草稿区材料包切片
 */

export type SourceRef =
  | { readonly kind: '仓内'; readonly path: string; readonly version: string }
  | { readonly kind: '作者自定义' }
  | { readonly kind: '对谈共创' }
  | { readonly kind: '知识库'; readonly library: string; readonly entry: string; readonly version: string }

/** 解析一行来源引用;不合法返回 null(调用方决定报错等级)。 */
export function parseSourceRef(line: string): SourceRef | null {
  const t = line.trim()
  if (t === '来源:作者自定义' || t === '来源：作者自定义') return { kind: '作者自定义' }
  if (t === '来源:对谈共创' || t === '来源：对谈共创') return { kind: '对谈共创' }
  const m = /^(?:来源|來源)[:：]\s*(.+)$/.exec(t)
  if (!m) return null
  const value = m[1]!.trim()
  if (value.startsWith('知识库/')) {
    // 知识库/<库>/<条目路径>@<版本>
    const km = /^知识库\/([^/@]+)\/(.+)@([^/@]+)$/.exec(value)
    if (!km) return null
    return { kind: '知识库', library: km[1]!, entry: km[2]!, version: km[3]! }
  }
  // 同仓路径@版本(路径含正斜杠;禁止 .. 与盘符)
  const pm = /^(.+?)@([^/@]+)$/.exec(value)
  if (!pm) return null
  const p = pm[1]!
  if (p.includes('..') || /^[a-zA-Z]:/.test(p) || p.startsWith('/')) return null
  return { kind: '仓内', path: p, version: pm[2]! }
}

/** 知识库引用的文件面约束(格式规格 §1):真源区只允许引用,不允许复制正文。 */
export function isKnowledgeRef(ref: SourceRef): ref is Extract<SourceRef, { kind: '知识库' }> {
  return ref.kind === '知识库'
}
