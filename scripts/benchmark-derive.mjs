import { performance } from 'node:perf_hooks'
// Node ≥22.6 类型剥离直接跑源码:不依赖构建产物,`pnpm build` 是纯类型门禁(dsh 同款:
// tsc 只做聚合类型检查,产物由打包器产出——见 08-22 本地集成踩坑记录 #12)。
import { deriveChapter } from '../packages/core/src/derive/derive.ts'

const facts = Array.from({ length: 200 }, (_, index) => ({
  key: { 卷: Math.floor(index / 50) + 1, 章: index + 1, 章名: `章节${index + 1}` },
  窗口就绪: true,
  候选细纲: false,
  确认细纲: index > 0,
  材料包状态: index % 11 === 0 ? '可写' : null,
  有草稿: false,
  唯一待审稿: false,
  有审核记录: false,
  审核完成: false,
  待定稿包完整: false,
  裁决: null,
  已定稿: false,
  需复核标记: [],
}))

const start = performance.now()
let checksum = 0
for (const fact of facts) checksum += deriveChapter(fact).row
const elapsed = performance.now() - start
console.log(JSON.stringify({ chapters: facts.length, elapsedMs: Number(elapsed.toFixed(3)), checksum }))
