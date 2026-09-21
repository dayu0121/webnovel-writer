/**
 * 卷摘要候选脚本——薄入口（任务21, 件一／R21／裁决 A1）。
 *
 * 运行能力与插件运行时同属一份 `lib/index.js`：本文件不内联任何依赖，只按自身位置
 * （<插件根>/skills/novel-settle/scripts/）上溯三级动态引 lib，调其中的 `volumeSummaryCli`。
 * 只算不写：纯算零写盘；调用方式（SKILL.md）：
 *   node <resourceBase>/scripts/卷摘要候选.mjs --book <bookRoot> --卷 <卷>
 * 退出码：0 成功（含如实报缺）；1 参数缺失；2 运行异常；3 无法加载插件运行库。
 */
const libUrl = new URL('../../../lib/index.js', import.meta.url)
try {
  const { volumeSummaryCli } = await import(libUrl)
  process.exitCode = volumeSummaryCli(process.argv.slice(2))
} catch (err) {
  console.error(`无法加载插件运行库 lib/index.js（${libUrl.href}）：${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 3
}
