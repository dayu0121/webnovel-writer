/**
 * 最小导出脚本的 CLI 逻辑（任务 13：导出到作者选定目录，写盘经原生文件工具）。
 *
 * 纯算零写盘：computeExport 与 inspectExportTarget 都不落任何文件；脚本把合集与来源
 * 清单全文（精确写盘载荷）打到 stdout 供主 Agent 预览，并附目标目录只读检查结果。
 * 实际写盘由主 Agent 向作者确认后完成（目标通常在书仓围栏外，清单最后落盘）。
 * argv 进、退出码出，模块顶层零副作用。
 */

import { computeExport, inspectExportTarget, verifyExportTarget, type ExportScope } from '@webnovel/core'

function argValue(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

function optionalPositiveInt(argv: readonly string[], name: string): number | undefined | null {
  const raw = argValue(argv, name)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) return null
  return value
}

export function exportCli(argv: readonly string[]): number {
  const allowed = new Set(['--book', '--目标', '--卷', '--起章', '--止章', '--校验'])
  const seen = new Set<string>()
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!
    const value = argv[i + 1]
    if (!allowed.has(flag) || seen.has(flag) || value === undefined || !value.trim() || value.startsWith('--')) {
      console.error(`前置参数错误：未知或重复选项，或选项缺值：${flag}`)
      return 1
    }
    seen.add(flag)
  }
  const book = argValue(argv, 'book')?.trim()
  const target = argValue(argv, '目标')?.trim()
  const verification = argValue(argv, '校验')
  if (verification !== undefined && (verification !== 'true' || !target)) {
    console.error('前置参数错误：校验须传 --校验 true 和 --目标 目录')
    return 1
  }
  if (!book) {
    console.error('前置参数错误：必须传 --book 书仓路径')
    return 1
  }
  const scope: { -readonly [K in keyof ExportScope]: ExportScope[K] } = {}
  for (const name of ['卷', '起章', '止章'] as const) {
    const value = optionalPositiveInt(argv, name)
    if (value === null) {
      console.error(`前置参数错误：--${name} 必须是正整数`)
      return 1
    }
    if (value !== undefined) scope[name] = value
  }
  try {
    const c = computeExport(book, scope)
    const names = c.ok ? [c.合集文件, c.清单文件] : []
    const inspected = target ? inspectExportTarget(book, target, names) : null
    const verified = verification === 'true' && target ? verifyExportTarget(book, target, c) : null
    const ok = c.ok && (verified !== null ? verified.ok : inspected === null || inspected.ok)
    console.log(JSON.stringify({
      ok,
      gaps: c.gaps,
      书名: c.书名,
      范围: c.范围,
      章数: c.章列表.length,
      合计字数: c.合计字数,
      合集文件: c.合集文件,
      清单文件: c.清单文件,
      合集哈希: c.合集哈希,
      章列表: c.章列表.map(({ 正文: _正文, ...entry }) => entry),
      目标: inspected,
      校验: verified,
      文件: ok && verified === null ? [{ 名称: c.合集文件, content: c.合集 }, { 名称: c.清单文件, content: c.清单 }] : [],
    }, null, 2))
    if (!c.ok) {
      console.error(`最小导出未完成：${c.gaps.join('；')}`)
      return 1
    }
    if (verified !== null) {
      if (!verified.ok) console.error(`导出校验失败：${verified.problems.join('；')}`)
      return verified.ok ? 0 : 1
    }
    if (inspected !== null && !inspected.ok) {
      console.error(`导出目标不可用：${[...inspected.problems, ...(inspected.冲突.length ? [`已有同名文件，不覆盖，请另选新目录：${inspected.冲突.join('、')}`] : [])].join('；')}`)
      return 1
    }
    return 0
  } catch (err) {
    console.error(`最小导出异常：${err instanceof Error ? err.message : String(err)}`)
    return 2
  }
}
