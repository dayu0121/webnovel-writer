import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createNovelTools, type NovelToolsDeps } from '../src/novel-tools'
import { APPROVE_LABEL, type AskRequest } from '@webnovel/core'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) { try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows cleanup */ } } })
function workspace(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-tools-')); roots.push(root); return root }
const AGENT = { agent: { id: 'main', session: { append: () => {} } } }

const card = ['# 作品卡', '', '## 核心钩子', '不存在楼层出现。', '', '## 主角欲望', '活着离开。', '', '## 核心冲突', '证据与安全不可兼得。', '', '## 结局方向', '公开证据。'].join('\n')
const blueprint = ['# 故事蓝图', '', '## 开篇钩子', '电梯门开。', '', '## 升级节点', '断电，倒计时。', '', '## 关键转折', '危险来自公司系统。', '', '## 高潮', '直播公开证据。', '', '## 结局', '获救并保留证据。'].join('\n')

function setup() {
  const workspaceRoot = workspace()
  const storyRoots = new Map<string, string>()
  let seen: AskRequest | undefined
  const askFn: NonNullable<NovelToolsDeps['askFn']> = async (request) => {
    seen = request
    const id = request.questions[0]?.id
    if (typeof id !== 'string') throw new Error('ask 请求缺少 id')
    return { answers: [{ id, selected: [APPROVE_LABEL] }] }
  }
  const tools = createNovelTools({
    workspaceRoot: () => workspaceRoot,
    bookRootOfBookId: () => undefined,
    storyRootOfStoryId: id => storyRoots.get(id),
    askFn,
  })
  const call = async (name: string, args: Record<string, unknown>) => {
    const tool = tools.find(candidate => candidate.name === name)
    if (tool === undefined) throw new Error(`工具不存在:${name}`)
    return (await tool.execute(args, AGENT)) as Record<string, unknown> & { ok: boolean }
  }
  return { workspaceRoot, storyRoots, tools, call, seen: () => seen }
}

describe('短故事主 Agent 工具', () => {
  it('注册故事级工具并完成蓝图→整篇审读→hash 批准→定稿→导出', async () => {
    const { workspaceRoot, storyRoots, tools, call, seen } = setup()
    expect(tools.filter(tool => tool.name.startsWith('story_')).length).toBeGreaterThanOrEqual(10)

    const created = await call('story_create', {
      title: '不存在的二十三楼',
      target: { profile: 'ultra-short', minChars: 8000, idealChars: 12000, maxChars: 24900, counting: 'codepoint' },
          })
    expect(created.ok).toBe(true)
    expect(created).toMatchObject({ platform: 'fanqie', platformProfile: 'fanqie-short-story', rulePack: { id: 'fanqie-short-story', version: 1 } })
    const storyId = String(created.storyId)
    storyRoots.set(storyId, String(created.storyRoot))

    const selected = await call('story_select', { storyId })
    expect(selected.ok).toBe(true)
    expect(selected.title).toBe('不存在的二十三楼')
    expect(selected).toMatchObject({ platform: 'fanqie-short-story', rulePack: { id: 'fanqie-short-story', version: 1 } })

    const plan = await call('story_write_plan', { storyId, card, blueprint })
    expect(plan.ok).toBe(true)
    const confirmed = await call('story_confirm_plan', { storyId, cardHash: plan.cardHash, blueprintHash: plan.blueprintHash })
    expect(confirmed.ok).toBe(true)

    const status = await call('story_get_status', { storyId })
    expect(status.ok).toBe(true)
    expect(status.position).toBe('可写')
    expect(status.事实).toMatchObject({ 平台: 'fanqie', 规则包: { id: 'fanqie-short-story', version: 1 } })
    expect(status.事实).toMatchObject({ 平台: 'fanqie', 规则包: { id: 'fanqie-short-story', version: 1 } })

    const draft = await call('story_write_draft', { storyId, body: '电梯门开了一条缝。\n\n她握紧手机，先按下紧急通话键。', role: '待审稿', module: '写稿' })
    expect(draft.ok).toBe(true)
    const identity = await call('story_review_identity', { storyId })
    expect(identity.ok).toBe(true)

    for (const module of ['结构与因果', '人物与情绪', '连续性与交付']) {
      const review = await call('story_record_review', { storyId, module, findings: [], expectedFingerprint: identity.fingerprint })
      expect(review.ok).toBe(true)
    }
    const delivery = await call('story_prepare_delivery', { storyId })
    expect(delivery.ok).toBe(true)
    expect(delivery.规则包).toMatchObject({ id: 'fanqie-short-story', version: 1 })
    const current = await call('story_review_identity', { storyId })
    const settled = await call('story_settle', { storyId, draftHash: identity.draftHash, reviewHash: current.reviewHash, deliveryHash: delivery.deliveryHash, summary: '不存在的二十三楼定稿' })
    expect(settled.ok).toBe(true)
    expect(seen()?.questions[0]?.detail).toContain(String(identity.draftHash).slice(0, 12))
    expect(seen()?.questions[0]?.detail).toContain(String(current.reviewHash).slice(0, 12))

    const exported = await call('story_compute_export', { storyId })
    expect(exported.ok).toBe(true)
    expect(String(exported.markdown)).toContain('她握紧手机')
    expect(String(exported.markdown)).not.toContain('卷01')
    const targetDir = path.join(workspaceRoot, '交付文件')
    const written = await call('story_write_export', { storyId, targetDir, finalHash: exported.finalHash })
    expect(written.ok).toBe(true)
    expect(written.changed).toBe(true)
    expect(fs.readFileSync(path.join(targetDir, '不存在的二十三楼-定稿.md'), 'utf8')).not.toContain('第0001章')
    expect(seen()?.questions[0]?.id).toBe('导出交付文件')
    expect(fs.existsSync(path.join(workspaceRoot, '不存在的二十三楼', '正文', '定稿', 'r001.md'))).toBe(true)
  })

  it('story_create 拒绝非番茄规则包和其他平台', async () => {
    const { call } = setup()
    const target = { profile: 'ultra-short', minChars: 8000, idealChars: null, maxChars: 24900, counting: 'codepoint' }
    const generic = await call('story_create', { title: '错误规则包', target, rulePack: { id: 'generic-quality', version: 1, hash: '0'.repeat(64) } })
    expect(generic.ok).toBe(false)
    expect(String(generic.reason)).toContain('番茄短故事规则包')
    const other = await call('story_create', { title: '错误平台', target, platformProfile: 'other-platform' })
    expect(other.ok).toBe(false)
    expect(String(other.reason)).toContain('番茄平台 profile')
  })

  it('短故事工具不要求 bookId，未知 storyId 明确失败', async () => {
    const { call } = setup()
    const missing = await call('story_get_status', { storyId: 's-missing' })
    expect(missing.ok).toBe(false)
    expect(String(missing.reason)).toContain('故事')
  })

  it('按当前会话 Agent 解析短故事工作范围', async () => {
    const workspaceRoot = workspace()
    const sessionAgent = AGENT.agent
    let storyLookupAgent: unknown
    let workspaceAgent: unknown
    const tools = createNovelTools({
      workspaceRoot: agent => { workspaceAgent = agent; return workspaceRoot },
      bookRootOfBookId: () => undefined,
      storyRootOfStoryId: (_storyId, agent) => { storyLookupAgent = agent; return undefined },
    })
    const status = tools.find(tool => tool.name === 'story_get_status')!
    const result = await status.execute({ storyId: 's-context' }, AGENT)
    expect((result as { ok: boolean }).ok).toBe(false)
    expect(storyLookupAgent).toBe(sessionAgent)
    const create = tools.find(tool => tool.name === 'story_create')!
    const created = await create.execute({
      title: '会话范围故事',
      target: { profile: 'ultra-short', minChars: 8000, idealChars: 12000, maxChars: 24900, counting: 'codepoint' },
          }, AGENT)
    expect((created as { ok: boolean }).ok).toBe(true)
    expect(workspaceAgent).toBe(sessionAgent)
  })
})
