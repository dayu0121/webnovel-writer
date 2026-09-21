import { readFileSync, writeFileSync } from 'node:fs'
import { MODEL_DIMENSIONS } from '../src/model-dimensions.ts'

const target = new URL('../MODEL_DIMENSIONS.md', import.meta.url)
const expected = [
  '# 常用向量模型维度表', '',
  '由 `src/model-dimensions.ts` 生成；更新后运行 `pnpm --filter @webnovel/embedding-provider docs:dimensions`。', '',
  '排行榜参考：[MTEB](https://huggingface.co/spaces/mteb/leaderboard)。逐项使用官方模型卡、接口说明或固定版本的 MTEB 元数据复核；不按排名自动替换条目。', '',
  '这些是模型的标准输出宽度与常用值，不保证每个托管服务都接受维度参数。服务返回的信息优先；手动填写和实测仍可使用。响应始终校验宽度，不在本地截断。', '',
  '| 模型 | 默认维度 | 常用维度 | 模型范围 | 维度参数 | 核对日期 | 来源 |',
  '| --- | ---: | --- | --- | --- | --- | --- |',
  ...MODEL_DIMENSIONS.map(m => `| ${m.id} | ${m.defaultDimension} | ${m.options.join(' / ')} | ${m.kind === 'fixed' ? '标准固定输出' : m.range ? `${m.range[0]}–${m.range[1]}` : '支持缩短，见来源'} | ${{ supported: '接口支持', 'service-dependent': '取决于托管服务', omit: '默认不传' }[m.requestDimensions]} | ${m.source.checkedOn} | [${m.source.label}](${m.source.url}) |`), '',
  '维护约定：', '',
  '- 每项记录标准名称、明确别名、默认维度、常用维度、已核实范围、参数策略、来源和核对日期。',
  '- 名称匹配忽略大小写；不猜未知后缀、量化版本、微调模型或第三方重命名。',
  '- 不用 hidden_size、输出 token 数或排名推断向量维度。MTEB 的 embed_dim 有专门定义；缩短范围由模型卡补充。',
  '- 开源模型标准维度默认不传参数，选择其他维度才发送，可在高级设置覆盖。',
  '- 此表不代表专用协议和角色参数均受支持；插件目前支持 OpenAI 兼容与 Gemini 原生文本嵌入。',
  '- 更新条目后跑包测试和构建；构建检查文档一致性。填写设置时不抓取排行榜。', '',
].join('\n')
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== expected) throw new Error('MODEL_DIMENSIONS.md is stale; run docs:dimensions')
} else writeFileSync(target, expected)
