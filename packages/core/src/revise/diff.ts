/**
 * 行级差异（M1 改稿全链 design §6）：`稿N.md` 永远是完整正文，diff 只在返回值。
 * 父版本 diff 与累计叠加共用本实现；重放（按序应用增/删）可得当前正文。
 * 算法失败不阻断写入——完整稿已落盘，diff 只是返回值的辅助信息。
 */

export interface DiffLine {
  readonly kind: '同' | '增' | '删'
  readonly text: string
}

/** 行级 LCS 差异。输入按 \n 切分（不按 \r 归一，保字节语义；空串 → 单空行）。 */
export function lineDiff(oldText: string, newText: string): readonly DiffLine[] {
  const a = oldText === '' ? [''] : oldText.split('\n')
  const b = newText === '' ? [''] : newText.split('\n')
  const n = a.length
  const m = b.length
  // DP 表：lcs[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: '同', text: a[i]! })
      i += 1
      j += 1
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: '删', text: a[i]! })
      i += 1
    } else {
      out.push({ kind: '增', text: b[j]! })
      j += 1
    }
  }
  while (i < n) { out.push({ kind: '删', text: a[i]! }); i += 1 }
  while (j < m) { out.push({ kind: '增', text: b[j]! }); j += 1 }
  return out
}

/** 把 oldText 按序应用增/删差异，重放出 newText（累计 diff 可重放性的实现依据）。 */
export function replayLines(oldText: string, diffs: readonly DiffLine[]): string {
  const a = oldText === '' ? [''] : oldText.split('\n')
  const out: string[] = []
  let i = 0
  for (const d of diffs) {
    if (d.kind === '同') {
      out.push(a[i] ?? d.text)
      i += 1
    } else if (d.kind === '增') {
      out.push(d.text)
    } else {
      i += 1
    }
  }
  return out.join('\n')
}
