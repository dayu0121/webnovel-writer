/**
 * 影响分析脚本的 CLI 逻辑（R21：novel_analyze_impact 只算，整个出去做技能脚本）。
 *
 * 本模块经 bundle 入口导出，各技能 scripts 目录下的薄入口动态引 lib 调用。
 * 只读不写：analyzeImpact 是纯读反向闭包；argv 进、退出码出，模块顶层零副作用。
 */

import { analyzeImpact } from '@webnovel/core'

function argValue(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

export function analyzeImpactCli(argv: readonly string[]): number {
  const book = argValue(argv, 'book')?.trim()
  const 变更路径 = argValue(argv, '变更路径')?.trim()
  if (!book) {
    console.error('前置参数错误：必须传 --book 书仓路径')
    return 1
  }
  if (!变更路径) {
    console.error('前置参数错误：必须传 --变更路径 书仓内相对路径')
    return 1
  }
  try {
    const report = analyzeImpact(book, 变更路径, {
      最大跳数: argValue(argv, '最大跳数') === undefined ? undefined : Number(argValue(argv, '最大跳数')),
      止于: argValue(argv, '止于已定稿') === undefined ? undefined : argValue(argv, '止于已定稿') === 'false' ? null : '已定稿',
    })
    console.log(JSON.stringify(report, null, 2))
    return 0
  } catch (err) {
    console.error(`影响分析异常：${err instanceof Error ? err.message : String(err)}`)
    return 2
  }
}
