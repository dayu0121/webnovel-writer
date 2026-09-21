import * as fs from 'node:fs'
import * as path from 'node:path'

/** Explicit synthetic settlement records for the isolated UI book only. */
export function seedGraphFixture(book) {
  const put = (relative, value) => {
    const file = path.join(book, relative)
    if (fs.existsSync(file)) return
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, value)
  }
  put('世界书/人物档案/林舟.md', '---\n名称: 林舟\n类型: 人物\n性质: 事实\n状态: 已成事实\n来源: 第2章\n起始章: 2\n披露章: 2\n---\n在渡口等候旧友。')
  put('世界书/人物档案/沈青.md', '---\n名称: 沈青\n类型: 人物\n性质: 事实\n状态: 已成事实\n来源: 第3章\n起始章: 3\n披露章: 3\n---\n带来远方的信件。')
  put('世界书/人物关系/渡口盟约.md', '---\n名称: 渡口盟约\n类型: 人物关系\n性质: 事实\n状态: 已成事实\n来源: 第3章\n起始章: 3\n失效章: 6\n披露章: 3\n关系双方: [林舟, 沈青]\n关系: 盟友\n---\n验收用记录：两人在渡口订立盟约，第6章结束。')
  put('账本/线索.md', '# 线索\n\n## 旧信的去向\n类型: 线索\n状态: 已埋\n来源: 第3章\n### 正文\n[[林舟]] 收到一封旧信。\n\n## 旧信的去向\n类型: 线索\n状态: 已收\n来源: 第6章\n### 正文\n[[沈青]] 说明了旧信的去向。')
  put('账本/时间线.md', '# 时间线\n\n## 渡口相遇\n来源: 第3章\n### 正文\n[[林舟]] 在渡口遇见 [[沈青]]。\n\n## 旧信揭晓\n来源: 第6章\n### 正文\n[[沈青]] 说明信件来历，[[林舟]] 得知真相。')
}
