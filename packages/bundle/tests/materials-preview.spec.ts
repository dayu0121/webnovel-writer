import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createNovelTools } from '../src/novel-tools'
import { nativeWriteStub } from './fixtures/native-write-stub'

/**
 * 真机缺陷回归（20章连写第1章前）：novel_assemble_materials 模式=预览在备料前置
 * 未就绪时返回 ok:false，但 材料清单哈希/合计字数/补充预览 三个可选键缺席——宿主
 * 工具边界拒绝 undefined 值，整个结果被报成内部错误「value is not lossless JSON」。
 * 修复：预览与保存失败分支一律回填空值，返回值必须无损 JSON 往返。
 */
function makeBook(): { ws: string; bookRoot: string } {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-preview-'))
  const bookRoot = path.join(ws, '探书')
  fs.mkdirSync(path.join(bookRoot, '作品契约'), { recursive: true })
  fs.writeFileSync(path.join(bookRoot, '作品契约', '契约.md'), '---\n书id: probe-preview\n---\n正文\n', 'utf-8')
  return { ws, bookRoot }
}

function lossless(value: unknown): boolean {
  try {
    return JSON.stringify(value) === JSON.stringify(JSON.parse(JSON.stringify(value)))
  } catch {
    return false
  }
}

describe('材料预览返回的无损 JSON 边界', () => {
  it('前置未就绪时预览返回 ok:false 且不含 undefined 值', async () => {
    const { ws, bookRoot } = makeBook()
    const tools = createNovelTools({ nativeWrite: nativeWriteStub, workspaceRoot: () => ws, bookRootOfBookId: () => bookRoot })
    const tool = tools.find((t) => t.name === 'novel_assemble_materials')!
    const preview = await tool.execute({ bookId: 'probe-preview', 卷: 1, 章: 1, 章名: '探章', 模式: '预览' }) as Record<string, unknown>
    expect(preview.ok).toBe(false)
    expect(String(preview.gaps)).toContain('细纲')
    expect(preview.材料清单哈希).toBe('')
    expect(preview.合计字数).toBe(0)
    expect(preview.补充预览).toEqual([])
    expect(lossless(preview), JSON.stringify(preview)).toBe(true)
    for (const value of Object.values(preview)) expect(value).not.toBeUndefined()
    const saved = await tool.execute({ bookId: 'probe-preview', 卷: 1, 章: 1, 章名: '探章' }) as Record<string, unknown>
    expect(saved.ok).toBe(false)
    expect(saved.材料清单哈希).toBe('')
    expect(lossless(saved), JSON.stringify(saved)).toBe(true)
    fs.rmSync(ws, { recursive: true, force: true, maxRetries: 5 })
  })
})
