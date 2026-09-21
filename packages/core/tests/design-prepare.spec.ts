import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  contractTemplate, parseDocument, prepareContract, prepareEntry, preparePlanTimeline,
  prepareRecentWindow, prepareSkeleton, prepareVolumeLayout, prepareVolumeOutline,
  serializeDocument, updateSkeleton, updateVolumeLayout, writeContract,
} from '../src'
import { removeSync } from '../src/repo/remove'

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-prepare-')) })
afterEach(() => { removeSync(root) })
const put = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}

describe('单文件设计准备', () => {
  it('所有准备函数只生成完整文件，不创建目录或写盘', () => {
    const ops = [
      prepareContract(root), prepareSkeleton(root, '# 骨架'), prepareVolumeLayout(root, '# 分卷'),
      prepareVolumeOutline(1, '# 卷纲'), preparePlanTimeline(1, '# 时间线'),
      prepareRecentWindow(1, [{ 名称: '开篇', 状态: '可进入' }]),
      prepareEntry('人物档案', '主角', { 类型: '人物', 性质: '计划', 状态: '已确认', 来源: '对谈' }),
    ]
    expect(new Set(ops.map(op => op.relPath)).size).toBe(7)
    expect(ops.every(op => op.content.endsWith('\n'))).toBe(true)
    expect(fs.readdirSync(root)).toEqual([])
  })

  it('契约合并保留书id、扩展字段与未修改分部，同步写入复用同一内容', () => {
    const before = contractTemplate({
      '题材与读者定位': { state: '暂定', body: '旧定位' },
      '叙事方式与文风基调': { state: '已确认', body: '保留文风正文' },
    }, { 书id: 'test-book', 自定义: ['保留'] })
    put('作品契约/契约.md', before)
    const parts = { '题材与读者定位': { state: '已确认', body: '新定位' } } as const
    const op = prepareContract(root, parts)
    expect(fs.readFileSync(path.join(root, op.relPath), 'utf8')).toBe(before)
    expect(op.content).toContain('保留文风正文')
    expect(op.content).toContain('新定位')
    expect(parseDocument(op.content)).toMatchObject({ ok: true, data: { fields: { 书id: 'test-book', 自定义: ['保留'] } } })
    writeContract(root, parts)
    expect(fs.readFileSync(path.join(root, op.relPath), 'utf8')).toBe(op.content)
  })

  it.each([
    ['故事骨架', prepareSkeleton, updateSkeleton],
    ['分卷布局', prepareVolumeLayout, updateVolumeLayout],
  ] as const)('%s 保留字段、内容变化升版、原样重跑不再升版', (name, prepare, write) => {
    const rel = `大纲/${name}.md`
    const before = serializeDocument({ 版本: 3, 父版本: 2, 状态: '已确认', 自定义: '保留' }, '# 旧正文')
    put(rel, before)
    const op = prepare(root, '# 新正文\r\n')
    expect(fs.readFileSync(path.join(root, rel), 'utf8')).toBe(before)
    expect(parseDocument(op.content)).toMatchObject({ ok: true, data: { fields: { 版本: 4, 父版本: 3, 自定义: '保留' } } })
    expect(write(root, '# 新正文\n')).toEqual(op.result)
    expect(fs.readFileSync(path.join(root, rel), 'utf8')).toBe(op.content)
    const replay = prepare(root, '# 新正文\n\n')
    expect(replay.content).toBe(op.content)
    expect(replay.result.版本).toBe(4)
  })

  it.each([
    ['作品契约/契约.md', () => prepareContract(root)],
    ['大纲/故事骨架.md', () => prepareSkeleton(root, '新正文')],
    ['大纲/分卷布局.md', () => prepareVolumeLayout(root, '新正文')],
  ] as const)('%s 解析失败或不可读时拒绝覆盖', (rel, prepare) => {
    const invalid = '---\n书id: [未闭合\n---\n原正文\n'
    put(rel, invalid)
    expect(prepare).toThrow(/解析失败/)
    expect(fs.readFileSync(path.join(root, rel), 'utf8')).toBe(invalid)
    fs.unlinkSync(path.join(root, rel))
    fs.mkdirSync(path.join(root, rel))
    expect(prepare).toThrow()
    expect(fs.statSync(path.join(root, rel)).isDirectory()).toBe(true)
  })
})
