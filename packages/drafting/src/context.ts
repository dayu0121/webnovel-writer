/**
 * 草稿干净上下文(插件规格 §5):写稿只收确认细纲 + 材料包,不含审核/讨论。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  hardConstraintCore,
  parseOutline,
  paths,
  type ChapterKey,
} from '@webnovel/core'
import { loadMaterialPackage } from '@webnovel/core'

export interface DraftContext {
  readonly 细纲: string
  readonly 材料段: Readonly<Record<string, string>>
  readonly 硬约束: readonly string[]
}

function readText(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf-8')
  } catch {
    return null
  }
}

export function loadDraftContext(bookRoot: string, key: Pick<ChapterKey, '卷' | '章' | '章名'>): DraftContext {
  const 细纲Rel = paths.确认细纲(key.卷, key.章, key.章名)
  const 细纲 = readText(bookRoot, 细纲Rel) ?? ''
  const parsed = 细纲 === '' ? null : parseOutline(细纲)
  const 硬约束 = parsed === null
    ? []
    : parsed.constraints.filter((c) => c.mark === '硬').map((c) => hardConstraintCore(c.line)).filter((s) => s !== '')

  const materials = loadMaterialPackage(bookRoot, key)
  const 材料段: Record<string, string> = { ...materials.段 }
  const 清单 = materials.清单
  if (清单 !== null) 材料段['材料清单'] = 清单

  return { 细纲, 材料段, 硬约束 }
}
