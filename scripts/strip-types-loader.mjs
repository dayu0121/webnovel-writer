/**
 * Node 类型剥离直跑源码的解析钩子:仓内源码按 tsc/vite 习惯用无扩展名相对导入,
 * Node ESM 要求显式扩展名——这里对相对导入补试 `.ts`(benchmark-impact 用)。
 */
import path from 'node:path'

export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && path.extname(specifier) === '') {
    try {
      return await next(`${specifier}.ts`, context)
    } catch {
      // 目录入口(../provenance → provenance/index.ts)或确实不存在:交给默认解析
      try {
        return await next(`${specifier}/index.ts`, context)
      } catch {
        // 交给默认解析报出原始错误
      }
    }
  }
  return next(specifier, context)
}
