/**
 * 卷摘要候选脚本的 CLI 逻辑（任务21, 件一；R21：只算不写，薄入口经 lib 调用）。
 *
 * 读本卷已定稿章的章摘要全文、账本已收/进行中线索、卷纲「卷末兑现」段，汇编候选；
 * 章摘要不齐时如实报缺（exit 0＝检查完成，报缺非异常）。argv 进、退出码出，顶层零副作用。
 */

import { computeVolumeSummaryCandidate } from '@webnovel/core'

function argValue(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

export function volumeSummaryCli(argv: readonly string[]): number {
  const book = argValue(argv, 'book')?.trim()
  const 卷 = Number(argValue(argv, '卷'))
  if (!book) {
    console.error('前置参数错误：必须传 --book 书仓路径')
    return 1
  }
  if (!Number.isSafeInteger(卷) || 卷 < 1) {
    console.error('前置参数错误：必须传 --卷 正整数（如 --卷 1）')
    return 1
  }
  try {
    const result = computeVolumeSummaryCandidate(book, 卷)
    // 统一 JSON 输出（候选在 候选 字段）;账本缺失/解析失败属操作性失败,exit 1 呈报(F21-2);
    // 如实报缺(缺章摘要/无定稿)与成功保持 exit 0(检查完成)
    console.log(JSON.stringify(result, null, 2))
    return !result.ok && result.账本失败 === true ? 1 : 0
  } catch (err) {
    console.error(`卷摘要候选生成异常：${err instanceof Error ? err.message : String(err)}`)
    return 2
  }
}
