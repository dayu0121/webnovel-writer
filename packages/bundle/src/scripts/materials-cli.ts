/**
 * 材料备料脚本的 CLI 逻辑（R21 切割：novel_assemble_materials 的「算」出去，「写」留工具）。
 *
 * 纯算零写盘：computeMaterials 不落任何文件；脚本把十段全文（精确写盘载荷）打到
 * stdout 供主 Agent 读包判断。写盘经常驻工具 novel_assemble_materials（写入器内重算，
 * 待写内容不过模型上下文）。argv 进、退出码出，模块顶层零副作用。
 */

import { computeMaterials } from '@webnovel/core'

function argValue(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

export function materialsCli(argv: readonly string[]): number {
  const book = argValue(argv, 'book')?.trim()
  const 卷 = Number(argValue(argv, '卷'))
  const 章 = Number(argValue(argv, '章'))
  const 章名 = argValue(argv, '章名')?.trim()
  if (!book) {
    console.error('前置参数错误：必须传 --book 书仓路径')
    return 1
  }
  if (!Number.isInteger(卷) || 卷 <= 0) {
    console.error('前置参数错误：--卷 必须是正整数')
    return 1
  }
  if (!Number.isInteger(章) || 章 <= 0) {
    console.error('前置参数错误：--章 必须是正整数')
    return 1
  }
  if (!章名) {
    console.error('前置参数错误：必须传 --章名')
    return 1
  }
  try {
    const c = computeMaterials(book, { 卷, 章, 章名 })
    console.log(JSON.stringify({
      ok: c.ok,
      状态: c.状态,
      dir: c.dir,
      gaps: c.gaps,
      合计字数: c.合计字数 ?? 0,
      段: c.段 ?? [],
      文件: (c.文件 ?? []).map((f) => ({ relPath: f.relPath, content: f.content })),
    }, null, 2))
    if (!c.ok) {
      console.error(`材料备料未完成：${c.gaps.join('；')}`)
      return 1
    }
    return 0
  } catch (err) {
    console.error(`材料备料异常：${err instanceof Error ? err.message : String(err)}`)
    return 2
  }
}
