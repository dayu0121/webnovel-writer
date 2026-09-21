import * as path from 'node:path'
import { canonicalizePath } from '../gate/canonical'
import { serializeMachineJson, MACHINE_SCHEMA_VERSION } from '../repo/schema'
import type { AssembleInput, ComputedMaterials } from './assemble'
import type { SupplementRecord, SupplementEdit } from './sections'
import { isSupplement, parseMaterialManifest, readMaterialManifestText, supplementFile } from './read'
import { materialHash, readMaterialFile, readSupplementSource } from './source'

export interface SupplementPreview {
  readonly 操作: SupplementEdit
  readonly 原文?: string
  readonly 字数?: number
}

/** Pure preparation. Existing snapshots survive rebuilding; only explicit edits replace them. */
export function appendSupplements(bookRoot: string, input: AssembleInput, base: ComputedMaterials): ComputedMaterials {
  if (!base.文件 || !base.段) return base
  const root = canonicalizePath(bookRoot)
  try {
    if (!Number.isSafeInteger(input.章) || input.章 < 1) throw new Error('材料目标章号必须为正整数')
    const previousText = readMaterialManifestText(root, base.dir)
    const previous = previousText === null ? undefined : parseMaterialManifest(previousText)
    const records = new Map((previous?.sections.filter(isSupplement) ?? []).map(item => [item.编号, item]))
    const bodies = new Map<string, string>()
    const edits = input.补充操作 ?? []
    const ids = new Set<string>()
    const previews: SupplementPreview[] = []
    for (const edit of edits) {
      if (!edit || typeof edit.编号 !== 'string') throw new Error('补充操作缺少编号')
      supplementFile(edit.编号)
      if (ids.has(edit.编号)) throw new Error(`补充编号重复：${edit.编号}`)
      ids.add(edit.编号)
      if (edit.操作 === '移除') {
        records.delete(edit.编号)
        previews.push({ 操作: edit })
        continue
      }
      if (edit.操作 !== '设置' || typeof edit.标题 !== 'string' || !edit.标题.trim()
        || typeof edit.理由 !== 'string' || !edit.理由.trim() || !['原文', '建议'].includes(edit.性质)) throw new Error(`补充操作字段无效：${edit.编号}`)
      const source = readSupplementSource(root, edit.来源, input.章)
      if (!input.仅预览 && source.sourceHash !== edit.来源.读取哈希) throw new Error(`补充来源未核对或已变化，请预览并核对原文：${edit.编号}`)
      const item: SupplementRecord = {
        类型: '补充', 编号: edit.编号, 段: edit.标题.trim(), 选用原因: edit.理由.trim(), 性质: edit.性质,
        来源: [`${source.source.域}/${source.source.路径}:${source.source.起行}-${source.source.终行}`],
        版本: source.sourceHash, 完整性: '完整', 字数: Array.from(source.text).length,
        文件: supplementFile(edit.编号), 内容哈希: materialHash(source.text), 来源快照: source.source, 适用章上限: input.章,
      }
      records.set(edit.编号, item)
      bodies.set(edit.编号, source.text)
      previews.push({ 操作: { ...edit, 来源: source.source }, 原文: source.text, 字数: item.字数 })
    }
    const warnings: string[] = []
    for (const item of records.values()) {
      if (bodies.has(item.编号)) continue
      const body = readMaterialFile(root, `${base.dir}/${item.文件}`)
      if (body.hash !== item.内容哈希 || Array.from(body.text).length !== item.字数) throw new Error(`补充附件已改变，先核对或显式重新设置：${item.编号}`)
      bodies.set(item.编号, body.text)
      try {
        if (item.适用章上限 !== input.章 || readSupplementSource(root, item.来源快照, input.章).sourceHash !== item.来源快照.读取哈希) throw new Error('source changed')
      } catch { warnings.push(`补充来源已过期或不可读，保留旧摘录并需重读：${item.编号}`) }
    }
    const supplements = [...records.values()]
    const sections = [...base.段.filter(item => !isSupplement(item)), ...supplements]
    const total = sections.reduce((sum, item) => sum + item.字数, 0)
    const 状态 = warnings.length > 0 ? '已过期' : base.状态
    const manifest = serializeMachineJson({ 状态, 合计字数: total, 段: sections, ...((previous?.extended || supplements.length > 0) ? { 补充协议: 1 } : {}) }, MACHINE_SCHEMA_VERSION)
    const files = base.文件.filter(file => path.posix.basename(file.relPath) !== '材料清单.json')
    for (const item of supplements) files.push({ relPath: `${base.dir}/${item.文件}`, content: bodies.get(item.编号)! })
    files.push({ relPath: `${base.dir}/材料清单.json`, content: manifest })
    return { ...base, ok: base.ok && warnings.length === 0, 状态, gaps: [...base.gaps, ...warnings], 合计字数: total, 段: sections,
      文件: files, 已有清单哈希: previousText === null ? '' : materialHash(previousText), 候选清单哈希: materialHash(manifest), 补充预览: previews }
  } catch (error) {
    return { ok: false, 状态: '有冲突', dir: base.dir, gaps: [error instanceof Error ? error.message : String(error)] }
  }
}
