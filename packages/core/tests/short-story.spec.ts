import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawnSync } from 'node:child_process'
import {
  applyShortStoryRevision,
  computeShortStoryExport,
  confirmShortStoryPlan,
  createShortStory,
  deriveShortStoryState,
  ingestShortStoryReview,
  prepareShortStoryDelivery,
  settleShortStory,
  shortStoryPaths,
  shortStoryReviewIdentity,
  writeShortStoryDraft,
  writeShortStoryPlan,
  writeShortStoryExport,
} from '../src/index'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放 */ }
  }
})

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'short-story-'))
  roots.push(root)
  return root
}

function git(root: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  expect(result.status, result.stderr || result.stdout).toBe(0)
  return String(result.stdout).trim()
}

function must<T extends { ok: true }>(result: T | { ok: false; reason: string }): T {
  if (!result.ok) throw new Error(result.reason)
  return result
}

const card = [
  '# 作品卡',
  '',
  '## 核心钩子',
  '深夜电梯停在不存在的二十三楼，门外站着一个三年前失踪的人。',
  '',
  '## 主角欲望',
  '她只想活着走出电梯，并把公司加班记录交给警方。',
  '',
  '## 核心冲突',
  '失踪者要求她删除当晚监控，消防系统却开始倒计时。',
  '',
  '## 结局方向',
  '她公开证据并救出被困者，不以巧合解决冲突。',
].join('\n')

const blueprint = [
  '# 故事蓝图',
  '',
  '## 开篇钩子',
  '电梯在二十三楼停住，门外出现失踪者的声音。',
  '',
  '## 升级节点',
  '主角发现监控被删；保安拒绝断电；消防倒计时开始。',
  '',
  '## 关键转折',
  '失踪者并非活人，而是公司违规实验留下的诱导影像。',
  '',
  '## 高潮',
  '主角在直播中公开证据并手动恢复供电。',
  '',
  '## 结局',
  '救援完成，主角保留证据并离开公司。',
].join('\n')

function readyPlan(root: string) {
  const created = must(createShortStory({
    workspaceRoot: root,
    title: '不存在的二十三楼',
    storyId: 's-test',
    target: { profile: 'ultra-short', minChars: 8000, idealChars: 12000, maxChars: 24900, counting: 'codepoint' },
      }))
  const plan = must(writeShortStoryPlan(created.storyRoot, { storyId: 's-test', card, blueprint }))
  must(confirmShortStoryPlan(created.storyRoot, { storyId: 's-test', cardHash: plan.cardHash, blueprintHash: plan.blueprintHash }))
  return created.storyRoot
}

function reviewedDraft(storyRoot: string, body = '电梯门开了一条缝。\n\n她握紧手机，先按下紧急通话键。') {
  const draft = must(writeShortStoryDraft(storyRoot, {
    storyId: 's-test',
    body,
    role: '待审稿',
    module: '写稿',
  }))
  const identity = must(shortStoryReviewIdentity(storyRoot, 's-test'))
  for (const module of ['结构与因果', '人物与情绪', '连续性与交付']) {
    must(ingestShortStoryReview(storyRoot, {
      storyId: 's-test',
      module,
      findings: [],
      expectedFingerprint: identity.fingerprint,
    }))
  }
  return { draft, identity }
}

describe('短故事原生故事仓', () => {
  it('创建独立 Git 故事仓并冻结 short-story-v1 身份', () => {
    const root = workspace()
    const created = must(createShortStory({
      workspaceRoot: root,
      title: '不存在的二十三楼',
      storyId: 's-test',
      target: { profile: 'ultra-short', minChars: 8000, idealChars: 12000, maxChars: 24900, counting: 'codepoint' },
          }))

    const manifest = JSON.parse(fs.readFileSync(path.join(created.storyRoot, shortStoryPaths.manifest()), 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({ schemaVersion: 1, kind: 'short-story', formatVersion: 1, storyId: 's-test', title: '不存在的二十三楼' })
    expect(fs.existsSync(path.join(created.storyRoot, shortStoryPaths.card()))).toBe(true)
    expect(fs.existsSync(path.join(created.storyRoot, shortStoryPaths.blueprint()))).toBe(true)
    expect(git(created.storyRoot, 'log', '-1', '--format=%s')).toBe('story: 建故事')
  })

  it('作者确认绑定作品卡和蓝图 hash 后才进入可写', () => {
    const root = workspace()
    const storyRoot = readyPlan(root)
    const state = must(deriveShortStoryState(storyRoot, 's-test'))
    expect(state.建议).toBe('可写')
    expect(state.事实.计划已确认).toBe(true)

    fs.writeFileSync(path.join(storyRoot, shortStoryPaths.card()), '被外部改写')
    const stale = deriveShortStoryState(storyRoot, 's-test')
    expect(stale.ok).toBe(false)
    expect(stale.ok === false ? stale.reason : '').toContain('计划哈希')
  })

  it('整篇待审稿必须完成全部登记模块才能进入定稿候选', () => {
    const root = workspace()
    const storyRoot = readyPlan(root)
    must(writeShortStoryDraft(storyRoot, { storyId: 's-test', body: '正文', role: '待审稿', module: '写稿' }))
    expect(must(deriveShortStoryState(storyRoot, 's-test')).建议).toBe('待审')

    const identity = must(shortStoryReviewIdentity(storyRoot, 's-test'))
    must(ingestShortStoryReview(storyRoot, { storyId: 's-test', module: '结构与因果', findings: [], expectedFingerprint: identity.fingerprint }))
    must(ingestShortStoryReview(storyRoot, { storyId: 's-test', module: '人物与情绪', findings: [], expectedFingerprint: identity.fingerprint }))
    expect(must(deriveShortStoryState(storyRoot, 's-test')).建议).toBe('待审')

    must(ingestShortStoryReview(storyRoot, { storyId: 's-test', module: '连续性与交付', findings: [], expectedFingerprint: identity.fingerprint }))
    const state = must(deriveShortStoryState(storyRoot, 's-test'))
    expect(state.建议).toBe('定稿候选')
    expect(state.事实.审读完成).toBe(true)
  })

  it('有发现项时保持修订态；新稿与处置同批后必须重审', () => {
    const root = workspace()
    const storyRoot = readyPlan(root)
    must(writeShortStoryDraft(storyRoot, { storyId: 's-test', body: '旧正文', role: '待审稿', module: '写稿' }))
    const first = must(shortStoryReviewIdentity(storyRoot, 's-test'))
    must(ingestShortStoryReview(storyRoot, {
      storyId: 's-test',
      module: '结构与因果',
      expectedFingerprint: first.fingerprint,
      findings: [{
        发现项编号: '结构-1',
        证据位置: '开头',
        问题说明: '主角没有采取行动。',
        修改建议: '让她主动按下紧急通话键。',
        影响范围: '开篇因果',
      }],
    }))
    must(ingestShortStoryReview(storyRoot, { storyId: 's-test', module: '人物与情绪', findings: [], expectedFingerprint: first.fingerprint }))
    must(ingestShortStoryReview(storyRoot, { storyId: 's-test', module: '连续性与交付', findings: [], expectedFingerprint: first.fingerprint }))
    expect(must(deriveShortStoryState(storyRoot, 's-test')).建议).toBe('修订中')

    const reviewHash = must(shortStoryReviewIdentity(storyRoot, 's-test')).reviewHash
    const revised = must(applyShortStoryRevision(storyRoot, {
      storyId: 's-test',
      expectedReviewHash: reviewHash,
      newBody: '她握紧手机，先按下紧急通话键。',
      dispositions: [{ 发现项编号: '结构-1', status: '已接受修改', note: '开篇已增加主动行动。' }],
    }))
    expect(revised.draftHash).not.toBe(first.draftHash)
    expect(must(deriveShortStoryState(storyRoot, 's-test')).建议).toBe('待审')
  })

  it('交付检查绑定当前审读证据，定稿与导出不含伪卷章', () => {
    const root = workspace()
    const storyRoot = readyPlan(root)
    const { identity } = reviewedDraft(storyRoot)
    const delivery = must(prepareShortStoryDelivery(storyRoot, 's-test'))
    expect(delivery.blockers).toEqual([])
    expect(must(deriveShortStoryState(storyRoot, 's-test')).建议).toBe('可交付')

    const reviewHash = must(shortStoryReviewIdentity(storyRoot, 's-test')).reviewHash
    const settled = must(settleShortStory(storyRoot, {
      storyId: 's-test',
      approval: {
        approved: true,
        decision: '作者确认故事正文、审读结果和交付检查。',
        draftHash: identity.draftHash,
        reviewHash,
        deliveryHash: delivery.deliveryHash,
      },
      summary: '不存在的二十三楼定稿',
    }))
    expect(fs.existsSync(path.join(storyRoot, shortStoryPaths.final(1)))).toBe(true)
    expect(git(storyRoot, 'log', '-1', '--format=%s')).toBe('story: 不存在的二十三楼定稿')
    expect(settled.alreadyCommitted).toBe(false)

    const exported = must(computeShortStoryExport(storyRoot, 's-test'))
    expect(exported.markdown).toContain('她握紧手机')
    expect(exported.markdown).not.toContain('卷01')
    expect(exported.markdown).not.toContain('第0001章')
    expect(exported.text).toContain('她握紧手机')
    expect(exported.files).toEqual([
      { name: '不存在的二十三楼-定稿.md', content: exported.markdown },
      { name: '不存在的二十三楼-定稿.txt', content: exported.text },
    ])
  })

  it('待审稿变化后旧审读与交付检查立即失效', () => {
    const root = workspace()
    const storyRoot = readyPlan(root)
    reviewedDraft(storyRoot)
    const delivery = must(prepareShortStoryDelivery(storyRoot, 's-test'))
    must(writeShortStoryDraft(storyRoot, { storyId: 's-test', body: '完全不同的新稿', role: '待审稿', module: '改稿' }))

    const identity = must(shortStoryReviewIdentity(storyRoot, 's-test'))
    const result = prepareShortStoryDelivery(storyRoot, 's-test')
    expect(result.ok).toBe(false)
    expect(result.ok === false ? result.reason : '').toContain('审读')
    expect(identity.draftHash).not.toBe(identity.fingerprint)

    const staleSettle = settleShortStory(storyRoot, {
      storyId: 's-test',
      approval: { approved: true, decision: '尝试使用旧批准', draftHash: 'old', reviewHash: 'old', deliveryHash: delivery.deliveryHash },
      summary: '不应入档',
    })
    expect(staleSettle.ok).toBe(false)
  })
  it('相同批准重跑只补提交，不生成第二份定稿', () => {
    const root = workspace()
    const storyRoot = readyPlan(root)
    const { identity } = reviewedDraft(storyRoot)
    const delivery = must(prepareShortStoryDelivery(storyRoot, 's-test'))
    const reviewHash = must(shortStoryReviewIdentity(storyRoot, 's-test')).reviewHash
    const input = {
      storyId: 's-test',
      approval: { approved: true, decision: '作者批准。', draftHash: identity.draftHash, reviewHash, deliveryHash: delivery.deliveryHash },
      summary: '幂等定稿',
    }
    const first = must(settleShortStory(storyRoot, input))
    const replay = must(settleShortStory(storyRoot, input))
    expect(replay.finalRelPath).toBe(first.finalRelPath)
    expect(replay.alreadyCommitted).toBe(true)
    expect(fs.existsSync(path.join(storyRoot, shortStoryPaths.final(2)))).toBe(false)
  })
  it('短故事导出可真实写盘、无伪卷章，重跑幂等且不覆盖冲突文件', () => {
    const root = workspace()
    const storyRoot = readyPlan(root)
    const { identity } = reviewedDraft(storyRoot)
    const delivery = must(prepareShortStoryDelivery(storyRoot, 's-test'))
    const reviewHash = must(shortStoryReviewIdentity(storyRoot, 's-test')).reviewHash
    must(settleShortStory(storyRoot, {
      storyId: 's-test',
      approval: { approved: true, decision: '作者批准。', draftHash: identity.draftHash, reviewHash, deliveryHash: delivery.deliveryHash },
      summary: '导出测试定稿',
    }))
    const target = path.join(root, '交付文件')
    const preview = must(computeShortStoryExport(storyRoot, 's-test'))
    expect(writeShortStoryExport(storyRoot, 's-test', target, 'stale-final-hash').ok).toBe(false)
    const written = must(writeShortStoryExport(storyRoot, 's-test', target, preview.finalHash))
    expect(written.files.map(file => file.name)).toEqual(['不存在的二十三楼-定稿.md', '不存在的二十三楼-定稿.txt'])
    expect(fs.readFileSync(path.join(target, '不存在的二十三楼-定稿.md'), 'utf8')).not.toContain('第0001章')
    expect(must(writeShortStoryExport(storyRoot, 's-test', target, preview.finalHash)).changed).toBe(false)
    fs.writeFileSync(path.join(target, '不存在的二十三楼-定稿.md'), '冲突内容', 'utf8')
    expect(writeShortStoryExport(storyRoot, 's-test', target, preview.finalHash).ok).toBe(false)
  })
})
