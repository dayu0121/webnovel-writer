/**
 * 定稿备包脚本——薄入口（R21／裁决 A1）。
 *
 * 运行能力与插件运行时同属一份 `lib/index.js`：本文件不内联任何依赖，只按自身位置
 * （<插件根>/skills/novel-settle/scripts/）上溯三级动态引 lib，调其中的 `packCli`。
 * 只算不写：纯算零写盘；调用方式（SKILL.md）：
 *   node <resourceBase>/scripts/定稿备包.mjs --book <bookRoot> --卷 <卷> --章 <章> --章名 <章名>
 * 退出码：0 成功；1 参数缺失；2 运行异常；3 无法加载插件运行库。
 */
const libUrl = new URL('../../../lib/index.js', import.meta.url)
try {
  const { packCli } = await import(libUrl)
  process.exitCode = packCli(process.argv.slice(2))
} catch (err) {
  console.error(`无法加载插件运行库 lib/index.js（${libUrl.href}）：${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 3
}
