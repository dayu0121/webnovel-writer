import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { confirmShortStoryPlan, createShortStory, writeShortStoryPlan } from '@webnovel/core'
import { StudyService } from '../src/study/service'
import { renderOverview } from '../src/status-context'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) { try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows cleanup */ } } })
function workspace(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-study-')); roots.push(root); return root }

const card = ['# 作品卡', '', '## 核心钩子', '不存在楼层出现。', '', '## 主角欲望', '活着离开。', '', '## 核心冲突', '证据与安全不可兼得。', '', '## 结局方向', '公开证据。'].join('\n')
const blueprint = ['# 故事蓝图', '', '## 开篇钩子', '电梯门开。', '', '## 升级节点', '断电。', '', '## 关键转折', '危险来自公司。', '', '## 高潮', '直播。', '', '## 结局', '获救。'].join('\n')

describe('短故事书房投影', () => {
  it('书架、目录树和只读真源识别 short-story-v1', () => {
    const workspaceRoot = workspace()
    const created = createShortStory({ workspaceRoot, title: '不存在的二十三楼', storyId: 's-test', target: { profile: 'ultra-short', minChars: 8000, idealChars: 12000, maxChars: 24900, counting: 'codepoint' },  })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const plan = writeShortStoryPlan(created.storyRoot, { storyId: 's-test', card, blueprint })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(confirmShortStoryPlan(created.storyRoot, { storyId: 's-test', cardHash: plan.cardHash, blueprintHash: plan.blueprintHash }).ok).toBe(true)

    expect(renderOverview(workspaceRoot)).toContain('番茄短故事《不存在的二十三楼》（故事 id：s-test；规则包 v1）')
    const service = new StudyService(workspaceRoot)
    const shelf = service.shelf()
    expect(shelf.books).toContainEqual({ id: 'story:s-test', kind: 'story', name: '不存在的二十三楼', platform: 'fanqie', platformProfile: 'fanqie-short-story', rulePack: expect.objectContaining({ id: 'fanqie-short-story', version: 1 }), progress: '可写 · 下一步：按已确认蓝图生成整篇待审稿。' })
    const tree = service.tree({ space: 'story:s-test', path: '' })
    expect(tree.map(entry => entry.name)).toEqual(expect.arrayContaining(['作品卡.md', '蓝图', '正文', '检查', '故事.json']))
    const document = service.read({ space: 'story:s-test', path: '作品卡.md' })
    expect(document.owner).toBe('不存在的二十三楼')
    expect(document.body).toContain('不存在楼层出现')
    expect(document.readOnly).toContain('短故事')
  })
})
