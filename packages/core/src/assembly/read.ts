import { canonicalizePath } from '../gate/canonical'
import { paths } from '../repo/paths'
import { MACHINE_SCHEMA_VERSION, parseMachineJson } from '../repo/schema'
import { 材料包十段, sectionFileName, type MaterialSectionRecord, type SupplementRecord } from './sections'
import { materialHash, readMaterialFile, readSupplementSource } from './source'

export function supplementFile(id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) throw new Error('补充编号须为1–64位字母、数字、短横线或下划线')
  return `补充/${id}.md`
}

export interface ParsedMaterialManifest {
  readonly raw: Record<string, unknown>
  readonly sections: MaterialSectionRecord[]
  readonly extended: boolean
}

export function parseMaterialManifest(text: string): ParsedMaterialManifest {
  const parsed = parseMachineJson(text, MACHINE_SCHEMA_VERSION)
  if (!parsed.ok) throw new Error(`材料清单无效：${parsed.detail}`)
  const protocol = parsed.data['补充协议']
  const rows = parsed.data['段']
  if (protocol === undefined && !(Array.isArray(rows) && rows.some(row => row && typeof row === 'object' && row['类型'] === '补充'))) {
    return { raw: parsed.data, sections: [], extended: false }
  }
  if (!Array.isArray(rows)) throw new Error('材料清单缺少段列表')
  if (protocol !== undefined && protocol !== 1) throw new Error('未知补充材料协议')
  const ids = new Set<string>()
  const names = new Set<string>()
  const sections: MaterialSectionRecord[] = []
  for (const value of rows) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('材料段格式无效')
    const row = value as Record<string, unknown>
    if (typeof row['段'] !== 'string' || !Array.isArray(row['来源']) || !row['来源'].every(source => typeof source === 'string')
      || typeof row['版本'] !== 'string' || typeof row['选用原因'] !== 'string'
      || !['完整', '残缺', '空', '旧格式'].includes(String(row['完整性']))
      || (row['字数'] !== undefined && (!Number.isSafeInteger(row['字数']) || Number(row['字数']) < 0))) throw new Error('材料段字段无效')
    if (row['类型'] === '补充') {
      const source = row['来源快照'] as Record<string, unknown> | undefined
      if (protocol !== 1 || typeof row['编号'] !== 'string' || ids.has(row['编号']) || row['文件'] !== supplementFile(row['编号'])
        || !['原文', '建议'].includes(String(row['性质'])) || !/^[a-f0-9]{64}$/.test(String(row['内容哈希']))
        || !Number.isSafeInteger(row['适用章上限']) || Number(row['适用章上限']) < 1
        || !source || !['本书', '书房'].includes(String(source['域'])) || typeof source['路径'] !== 'string'
        || !/^[a-f0-9]{64}$/.test(String(source['读取哈希'])) || !Number.isSafeInteger(source['起行']) || Number(source['起行']) < 1
        || row['版本'] !== source['读取哈希'] || !Number.isSafeInteger(row['字数'])
        || !Number.isSafeInteger(source['终行']) || Number(source['终行']) < Number(source['起行'])) throw new Error('补充材料字段、编号或路径无效')
      ids.add(row['编号'])
    } else {
      if (row['类型'] !== undefined || !(材料包十段 as readonly string[]).includes(row['段']) || names.has(row['段'])) throw new Error(`未知或重复基础材料段：${row['段']}`)
      names.add(row['段'])
    }
    sections.push(value as MaterialSectionRecord)
  }
  return { raw: parsed.data, sections, extended: protocol === 1 }
}

export function isSupplement(section: MaterialSectionRecord): section is SupplementRecord {
  return '类型' in section && section.类型 === '补充'
}

export interface LoadedMaterialPackage {
  readonly 段: Readonly<Record<string, string>>
  readonly 补充: readonly SupplementRecord[]
  readonly 问题: readonly string[]
  readonly 清单: string | null
  readonly 清单哈希: string
  /** Legacy packages keep their exact old review identity. Extended packages include read proofs. */
  readonly 审读材料标识: string | null
}

export function readMaterialManifestText(root: string, dir: string): string | null {
  try { return readMaterialFile(canonicalizePath(root), `${dir}/材料清单.json`).text }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}

/** Shared by drafting, recovery and review; never discovers unregistered supplement files. */
export function loadMaterialPackage(bookRoot: string, key: { 卷: number; 章: number; 章名: string }): LoadedMaterialPackage {
  const root = canonicalizePath(bookRoot)
  const dir = paths.材料包目录(key.卷, key.章名)
  const 段: Record<string, string> = {}
  const 问题: string[] = []
  const proofs: unknown[] = []
  let 清单: string | null = null
  let parsed: ParsedMaterialManifest | undefined
  let extended = false
  try {
    清单 = readMaterialManifestText(root, dir)
    if (清单 !== null) {
      extended = /"补充协议"|"类型"\s*:\s*"补充"/.test(清单)
      parsed = parseMaterialManifest(清单)
    }
  } catch (error) { 问题.push(error instanceof Error ? error.message : '材料清单读取失败') }
  const supplements = parsed?.sections.filter(isSupplement) ?? []
  // Old packages may predate a manifest; retain the original ten-file read behavior.
  const baseNames = parsed?.extended ? parsed.sections.filter(section => !isSupplement(section)).map(section => section.段) : 材料包十段
  if (parsed?.extended && baseNames.length !== 材料包十段.length) 问题.push('基础材料段清单不完整')
  for (const name of baseNames) {
    const index = (材料包十段 as readonly string[]).indexOf(name)
    const file = sectionFileName(index, 材料包十段[index]!)
    try {
      const read = readMaterialFile(root, `${dir}/${file}`)
      段[name] = read.text
      proofs.push({ file, hash: read.hash })
    } catch (error) {
      if (parsed?.extended || (error as NodeJS.ErrnoException).code !== 'ENOENT') 问题.push(`基础材料不可读：${file}`)
      proofs.push({ file, missing: true })
    }
  }
  for (const item of supplements) {
    let snapshot: { text: string; hash: string }
    try { snapshot = readMaterialFile(root, `${dir}/${item.文件}`) }
    catch { 问题.push(`补充附件不可读：${item.编号}`); proofs.push({ id: item.编号, missing: true }); continue }
    proofs.push({ id: item.编号, hash: snapshot.hash })
    if (snapshot.hash !== item.内容哈希 || Array.from(snapshot.text).length !== item.字数) { 问题.push(`补充附件哈希不匹配或字数不一致：${item.编号}`); continue }
    let stale = false
    try {
      if (item.适用章上限 !== key.章) throw new Error('章节不匹配')
      const current = readSupplementSource(root, item.来源快照, key.章)
      proofs.push({ id: item.编号, source: current.sourceHash })
      stale = current.sourceHash !== item.来源快照.读取哈希
    } catch { stale = true; proofs.push({ id: item.编号, sourceUnreadable: true }) }
    if (stale) 问题.push(`补充来源已过期或不可读，保留旧摘录并需重读：${item.编号}`)
    段[`补充/${item.编号}：${item.段}`] = [
      `【补充${stale ? '·已过期' : ''}】${item.段}（${item.性质}；不是自动确认的事实）`,
      `选用理由：${item.选用原因}`,
      `来源：${item.来源快照.域}/${item.来源快照.路径}:${item.来源快照.起行}-${item.来源快照.终行}；读取哈希：${item.来源快照.读取哈希}`,
      snapshot.text,
    ].join('\n')
  }
  if (问题.length > 0) 段['材料读取警告'] = 问题.join('\n')
  const identity = extended ? JSON.stringify({ 版本: 'supplements-v1', 清单, proofs, 问题 }) : 清单
  return { 段, 补充: supplements, 问题, 清单, 清单哈希: 清单 === null ? '' : materialHash(清单), 审读材料标识: identity }
}

/** Keep legacy status scans cheap; only extended packages require attachment/source proofs. */
export function materialReviewIdentity(bookRoot: string, key: { 卷: number; 章: number; 章名: string }, manifest: string | null) {
  if (manifest === null) return { 标识: null, 问题: [] as readonly string[] }
  const parsed = parseMachineJson(manifest, MACHINE_SCHEMA_VERSION)
  if (parsed.ok && parsed.data['补充协议'] === undefined
    && !(Array.isArray(parsed.data['段']) && parsed.data['段'].some(row => row && typeof row === 'object' && row['类型'] === '补充'))) {
    return { 标识: manifest, 问题: [] as readonly string[] }
  }
  const loaded = loadMaterialPackage(bookRoot, key)
  return { 标识: loaded.审读材料标识, 问题: loaded.问题 }
}
