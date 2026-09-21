/**
 * 定稿备包脚本的 CLI 逻辑（R21 切割：novel_prepare_pack 的「算」出去，「写」留工具）。
 *
 * 纯算零写盘：computePack 不落任何文件（沉淀候选为空＝相应件为占位）；脚本把七件全文
 * （精确写盘载荷）打到 stdout 供主 Agent 逐件审阅。落盘经常驻工具 novel_prepare_pack
 * （写入器内重算＋逐段预校验，失败不落盘）。argv 进、退出码出，模块顶层零副作用。
 */

import { computePack } from '@webnovel/core'

function argValue(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

export function packCli(argv: readonly string[]): number {
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
    const c = computePack(book, { 卷, 章, 章名 })
    console.log(JSON.stringify({
      ok: c.ok,
      dir: c.dir,
      reason: c.reason,
      files: c.files ?? [],
      文件: (c.文件 ?? []).map((f) => ({ relPath: f.relPath, content: f.content })),
    }, null, 2))
    if (!c.ok) {
      console.error(`定稿备包未完成：${c.reason ?? '未知原因'}`)
      return 1
    }
    return 0
  } catch (err) {
    console.error(`定稿备包异常：${err instanceof Error ? err.message : String(err)}`)
    return 2
  }
}
