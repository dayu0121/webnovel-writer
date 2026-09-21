/**
 * 规模 fixture 造仓器(供 assembly-scale 等测试复用):
 * N 章已定稿书——每章确认细纲/定稿章/章摘要,每章 6 条账本(故事线/人物弧线/承诺各 1、线索 3)、
 * 3 条时间线;近期章条目保持活跃态,远期条目已兑现/已收,保证切片有界。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { paths, seedMinDesign, serializeDocument } from '../../src/index'

function pad4(n: number): string {
  return String(n).padStart(4, '0')
}

function outlineBody(chapter: number): string {
  return [
    '# 章细纲', '', '## 定位段', '', '### 来源窗口项及拆并关系', `章${chapter}，单章承接上一章的城门盘问，不并其他窗口项。`, '',
    '### 章节功能', '', '- 〔硬〕开场点名主角现身', '- 〔硬〕守门老兵的盘问必须完成', '- 〔软〕铺出城门异响的余韵', '- 〔自由〕可带一两句市集白描', '',
    '### 视角与焦点', '主角限知视角，焦点落在盘问的攻防与城门的异样上，不越权写守军内部。', '',
    '### 时空锚定', '城门口，清晨', '',
    '### 起止边界', '从主角抵达城门开始，到发现异状收束；不写进城之后的事。', '',
    '### 故事线与承诺分配', '推进主线承诺：查明异响的来源；同时维持商队支线的既有节奏，不新增支线。', '',
    '### 信息边界', '只披露主角所见所闻；异响的真实来源本章不揭示，守军部署只写表象。', '',
    '### 情绪与节奏目标', '前段平缓铺陈市集，中段盘问渐紧，末段以异响收束留钩。', '',
    '### 前置条件核对结果', '已核对来源与窗口，前置设定均非留白；守门老兵人设已就绪。', '',
    '## 细纲段', '', '### 单元 1', '',
    '- 目标: 开场', '- 人物: 主角', '- 时空: 城门口', '- 行动/冲突: 盘问与发现', '- 信息披露: 异常线索', '- 状态变化: 从平静到警觉', '',
    '### 单元 2', '',
    '- 目标: 盘问', '- 人物: 主角、守门老兵', '- 时空: 城门内侧', '- 行动/冲突: 老兵盘查、主角应对', '- 信息披露: 通行文书', '- 状态变化: 由阻到放', '',
    '### 单元 3', '',
    '- 目标: 收束', '- 人物: 主角', '- 时空: 城门洞', '- 行动/冲突: 察觉异响', '- 信息披露: 异响细节', '- 状态变化: 警觉到行动', '',
  ].join('\n')
}

export function makeFixtureBook(root: string, chapters: number, opts?: { readonly 每卷章数?: number }): void {
  const perVolume = opts?.每卷章数 ?? 50
  seedMinDesign(root)
  // 主角条目写实(细纲来源引用点名 → 世界书切片为公共段)
  fs.mkdirSync(path.join(root, '世界书', '人物档案'), { recursive: true })
  fs.writeFileSync(path.join(root, '世界书', '人物档案', '主角.md'), serializeDocument({
    名称: '主角', 类型: '人物档案', 性质: '设定', 状态: '已确认',
  }, [
    '主角，随身带着半枚来历不明的铜符。', '性格：话少而准，先看后动；遇险时优先脱身而非硬拼。',
    '身手：市井摔扑与短刀，不擅长途奔袭。', '眼下目标：凭通行文书入城，查明城门异响。',
  ].join('\n')), 'utf-8')
  // 现实尺寸的契约(十段中的「暂定与警告」以契约两部与卷纲段为公共底)
  fs.writeFileSync(path.join(root, paths.契约()), serializeDocument({ 状态: '已确认' }, [
    '# 契约', '',
    '## 叙事方式与文风基调', '',
    '全篇以主角限知视角推进，句子短促，画面先行，不解释情绪。', '对话承担性格：主角话少而准，老兵话多而绕；盘问场面以短句往返为主，不做大段说明。', '场面描写控制在三句以内，把笔墨留给交锋与转折；市集白描只取声音与气味两个通道。', '章节收束一律落在未决动作上，不写总结性旁白。', '数字与名物保持前文一致：通行文书、铜符、守军番号都不得凭空更换。', '',
    '## 创作禁区与不可妥协项', '',
    '- 〔硬〕主角不得死亡', '- 〔硬〕异响的真实来源在卷末前不得揭示', '- 〔硬〕不使用现代词汇', '- 〔软〕守军编制细节不展开', '- 〔软〕不过度堆叠身份谜团', '',
  ].join('\n')), 'utf-8')
  const ledger: Record<string, string[]> = {
    故事线: ['# 故事线'],
    人物弧线: ['# 人物弧线'],
    承诺: ['# 承诺'],
    线索: ['# 线索'],
  }
  const timeline: string[] = ['# 时间线']
  const volumes = new Set<number>()
  for (let i = 1; i <= chapters; i += 1) {
    const 卷 = Math.floor((i - 1) / perVolume) + 1
    volumes.add(卷)
    const 章名 = `章${i}`
    const recent = i > chapters - 10
    const ensure = (rel: string): void => fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    ensure(paths.确认细纲(卷, i, 章名))
    ensure(paths.定稿章(卷, i, 章名))
    ensure(paths.章摘要(卷, i, 章名))
    fs.writeFileSync(
      path.join(root, paths.确认细纲(卷, i, 章名)),
      serializeDocument({ 状态: '已确认', 版本: 1, 来源引用: ['作品契约/契约.md@1', '世界书/人物档案/主角.md@1'] }, outlineBody(i)),
      'utf-8',
    )
    const finalBody = `第${i}章正文开头。\n\n${'剧情依细纲推进。'.repeat(60)}\n\n本章收束于城门，主角正要进城。\n`
    fs.writeFileSync(path.join(root, paths.定稿章(卷, i, 章名)), serializeDocument({ 状态: '已定稿', 版本: 1 }, finalBody), 'utf-8')
    fs.writeFileSync(
      path.join(root, paths.章摘要(卷, i, 章名)),
      `# 章摘要\n\n第${i}章摘要：主角在城门盘问中发现异状，线索推进。章末状态：主角在城门，正要进城，异响未解。\n`,
      'utf-8',
    )
    const activeMark = recent ? '进行中' : '已兑现'
    ledger['故事线'].push(`\n## 主线-${i}\n状态：${activeMark}\n计划来源：卷纲#${i}\n### 正文\n第${i}章主线推进。\n`)
    ledger['人物弧线'].push(`\n## 弧光-${i}\n状态：${activeMark}\n计划来源：卷纲#${i}\n### 正文\n第${i}章人物弧线推进。\n`)
    ledger['承诺'].push(`\n## 承诺-${i}\n状态：${activeMark}\n计划来源：卷纲#${i}\n### 正文\n第${i}章承诺推进。\n`)
    for (const n of [1, 2, 3]) {
      ledger['线索'].push(`\n## 线索-${i}-${n}\n状态：${recent ? '已埋' : '已收'}\n计划来源：卷纲#${i}\n埋设点：第${i}章\n预期兑现区间：第${i}-${i + 2}章\n### 正文\n第${i}章线索${n}埋设。\n`)
    }
    for (const n of [1, 2, 3]) {
      const hit = n === 1 && i % 50 === 0
      timeline.push(`\n## ${hit ? '城门异响' : `事件-${i}-${n}`}\n事件：${hit ? '城门口的异响' : `第${i}章事件${n}`}\n章号：第${pad4(i)}章\n### 正文\n${hit ? '城门口的异响被主角察觉。' : `第${i}章事件${n}的记录。`}\n`)
    }
  }
  for (const [kind, lines] of Object.entries(ledger)) {
    fs.mkdirSync(path.dirname(path.join(root, paths.账本(kind as '故事线'))), { recursive: true })
    fs.writeFileSync(path.join(root, paths.账本(kind as '故事线')), `${lines.join('\n')}\n`, 'utf-8')
  }
  fs.writeFileSync(path.join(root, paths.账本('时间线')), `${timeline.join('\n')}\n`, 'utf-8')
  for (const 卷 of volumes) {
    fs.writeFileSync(
      path.join(root, paths.卷摘要(卷)),
      `# 卷摘要\n\n第${String(卷).padStart(2, '0')}卷至今：主角以盘查立足，城门异响的线索逐步累积，商队支线与守军暗流并行。`,
      'utf-8',
    )
    fs.writeFileSync(
      path.join(root, paths.卷纲(卷)),
      [
        '# 卷纲', '',
        '## 叙事结构 〔已确认〕', '',
        `- 开卷三章立住城门盘查的日常与暗流（章${(卷 - 1) * perVolume + 1}起；本卷起始章节：${Array.from({ length: Math.min(2, chapters - (卷 - 1) * perVolume) }, (_, i) => `章${(卷 - 1) * perVolume + i + 1}`).join('、')}）`, '',
        '## 弧线 〔留白〕', '',
        '- 卷中以商队支线调剂节奏', '',
        '## 线索推进 〔留白〕', '',
        '- 卷末三章收束异响线索', '- 窗口项之间保持一天以内的连续时间', '- 商队接应点的具体位置〔暂定〕', '- 守军换岗的空档时刻〔暂定〕', '- 老兵的旧属番号〔留白〕', '',
        '## 卷末兑现 〔留白〕', '',
        `第${String(卷).padStart(2, '0')}卷推进主线至卷末高潮：城门异响牵出守军内情，主角在盘查与反盘查之间立足，兑现开卷立下的查明承诺。卷末留出跨卷钩子。`, '',
      ].join('\n'),
      'utf-8',
    )
  }
}
