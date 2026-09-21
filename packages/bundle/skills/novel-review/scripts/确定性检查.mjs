/**
 * 确定性检查脚本——薄入口（R21／裁决 A1，design.md「脚本产物形态」）。
 *
 * 运行能力与插件运行时同属一份 `lib/index.js`：本文件不内联任何依赖，
 * 只按自身位置（<插件根>/skills/novel-review/scripts/）上溯三级动态引 lib，
 * 调其中的 `runChecksCli`。调用方式（SKILL.md）：
 *   node <resourceBase>/scripts/确定性检查.mjs --book <bookRoot> --卷 <卷> --章 <章> --章名 <章名>
 * 退出码：0 成功；1 参数/书仓/运行拒绝；2 运行异常；3 无法加载插件运行库。
 */
const libUrl = new URL('../../../lib/index.js', import.meta.url)
try {
  const { runChecksCli } = await import(libUrl)
  process.exitCode = runChecksCli(process.argv.slice(2))
} catch (err) {
  console.error(`无法加载插件运行库 lib/index.js（${libUrl.href}）：${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 3
}
