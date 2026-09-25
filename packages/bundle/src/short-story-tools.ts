import type { ToolOutputDefinition } from '@deepseek-ai/dsh-tools'
import {
  applyShortStoryRevision,
  askAuthor,
  computeShortStoryExport,
  confirmShortStoryPlan,
  createShortStory,
  deriveShortStoryState,
  ingestShortStoryReview,
  prepareShortStoryDelivery,
  readShortStoryManifest,
  settleShortStory,
  shortStoryReviewIdentity,
  writeShortStoryDraft,
  writeShortStoryPlan,
  writeShortStoryExport,
  type AskFn,
} from '@webnovel/core'
import type { AgentLike, NovelToolDefinition, ToolExecContext } from './novel-tools'

export interface ShortStoryToolsDeps {
  readonly workspaceRoot: (agent?: AgentLike) => string | undefined
  readonly storyRootOfStoryId?: (storyId: string, agent?: AgentLike) => string | undefined
  readonly askFn?: AskFn
}

const output: ToolOutputDefinition = {
  schema: {
    type: 'object',
    properties: {
      ok: { type: 'boolean', description: '是否成功' },
      reason: { type: 'string', description: '失败原因' },
    },
    required: ['ok'],
  },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

const targetSchema = {
  type: 'object',
  properties: {
    profile: { type: 'string', enum: ['ultra-short', 'mid-short', 'custom'] },
    minChars: { type: ['integer', 'null'], minimum: 0 },
    idealChars: { type: ['integer', 'null'], minimum: 0 },
    maxChars: { type: ['integer', 'null'], minimum: 0 },
    counting: { type: 'string', enum: ['codepoint'] },
  },
  required: ['profile', 'minChars', 'idealChars', 'maxChars', 'counting'],
} as const

export function createShortStoryTools(deps: ShortStoryToolsDeps): NovelToolDefinition[] {
  const rootOf = (args: Record<string, unknown>, context?: ToolExecContext) => {
    const storyId = String(args.storyId ?? '').trim()
    if (storyId === '') return { ok: false as const, reason: '未指定 storyId' }
    const storyRoot = deps.storyRootOfStoryId?.(storyId, context?.agent)
    if (storyRoot === undefined) return { ok: false as const, reason: `未能定位短故事:${storyId}` }
    return { ok: true as const, storyId, storyRoot }
  }
  const withRoot = <T>(args: Record<string, unknown>, context: ToolExecContext | undefined, run: (storyId: string, storyRoot: string) => T): T | { ok: false; reason: string } => {
    const root = rootOf(args, context)
    return root.ok ? run(root.storyId, root.storyRoot) : root
  }

  return [
    {
      name: 'story_create',
      description: '创建一篇番茄短故事原生故事仓(short-story-v1)，固定使用内置版本化番茄规则包、人工交付和 hash 绑定。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '短故事标题' },
          target: targetSchema,
          rulePack: { type: 'object', description: '兼容参数；省略即可，传入时必须是内置番茄规则包。' },
          platformProfile: { type: ['string', 'null'], description: '兼容参数；只能使用 fanqie-short-story。' },
        },
        required: ['title', 'target'],
      },
      output,
      execute: (args, context) => {
        const workspaceRoot = deps.workspaceRoot(context?.agent)
        if (workspaceRoot === undefined) return { ok: false, reason: '工作范围未就绪' }
        return createShortStory({
          workspaceRoot,
          title: String(args.title ?? ''),
          target: args.target as Parameters<typeof createShortStory>[0]['target'],
          rulePack: args.rulePack as Parameters<typeof createShortStory>[0]['rulePack'],
          platformProfile: args.platformProfile === undefined ? null : args.platformProfile as string | null,
        })
      },
    },
    {
      name: 'story_select',
      description: '选择当前会话正在写的短故事，返回故事身份、状态和下一步；不从聊天记忆猜测。',
      parameters: { type: 'object', properties: { storyId: { type: 'string' } }, required: ['storyId'] },
      output,
      execute: (args, context) => withRoot(args, context, (storyId, storyRoot) => {
        const manifest = readShortStoryManifest(storyRoot, storyId)
        const state = deriveShortStoryState(storyRoot, storyId)
        if (!state.ok) return { ok: false, reason: state.reason }
        return { ok: true, storyId, title: manifest.title, platform: manifest.platformProfile, rulePack: manifest.rulePack, position: state.建议, next: state.下一步 }
      }),
    },
    {
      name: 'story_get_status',
      description: '从短故事仓真实文件推导当前节点、审读/交付证据新鲜度和下一步。',
      parameters: { type: 'object', properties: { storyId: { type: 'string' } }, required: ['storyId'] },
      output,
      execute: (args, context) => withRoot(args, context, (storyId, storyRoot) => {
        const state = deriveShortStoryState(storyRoot, storyId)
        return state.ok ? { ...state, storyId, position: state.建议 } : state
      }),
    },
    {
      name: 'story_write_plan',
      description: '把作品卡和一页故事蓝图写入候选区，返回两份正文 hash；确认时必须原样带回。',
      parameters: { type: 'object', properties: { storyId: { type: 'string' }, card: { type: 'string' }, blueprint: { type: 'string' } }, required: ['storyId', 'card', 'blueprint'] },
      output,
      execute: (args, context) => withRoot(args, context, (storyId, storyRoot) => writeShortStoryPlan(storyRoot, { storyId, card: String(args.card ?? ''), blueprint: String(args.blueprint ?? '') })),
    },
    {
      name: 'story_confirm_plan',
      description: '作者确认故事卡与蓝图时调用；两份候选 hash 与当前文件不一致则拒绝。',
      parameters: { type: 'object', properties: { storyId: { type: 'string' }, cardHash: { type: 'string' }, blueprintHash: { type: 'string' } }, required: ['storyId', 'cardHash', 'blueprintHash'] },
      output,
      execute: (args, context) => withRoot(args, context, (storyId, storyRoot) => confirmShortStoryPlan(storyRoot, { storyId, cardHash: String(args.cardHash ?? ''), blueprintHash: String(args.blueprintHash ?? '') })),
    },
    {
      name: 'story_write_draft',
      description: '通过受信写入器保存整篇短故事草稿；角色为待审稿时，旧待审稿降级与新稿写入同一原子批次。',
      parameters: {
        type: 'object',
        properties: {
          storyId: { type: 'string' }, body: { type: 'string' },
          role: { type: 'string', enum: ['草稿', '待审稿'] },
          module: { type: 'string' },
          parentVersion: { type: 'integer', minimum: 1 },
          candidateFacts: { type: 'array', items: { type: 'string' } },
        },
        required: ['storyId', 'body', 'role', 'module'],
      },
      output,
      execute: (args, context) => withRoot(args, context, (storyId, storyRoot) => writeShortStoryDraft(storyRoot, {
        storyId,
        body: String(args.body ?? ''),
        role: args.role as '草稿' | '待审稿',
        module: String(args.module ?? ''),
        ...(args.parentVersion === undefined ? {} : { parentVersion: Number(args.parentVersion) }),
        ...(Array.isArray(args.candidateFacts) ? { candidateFacts: args.candidateFacts.map(String) } : {}),
      })),
    },
    {
      name: 'story_review_identity',
      description: '返回当前唯一待审稿、确认计划与审读记录 hash，以及本轮审读必须绑定的输入指纹。',
      parameters: { type: 'object', properties: { storyId: { type: 'string' } }, required: ['storyId'] },
      output,
      execute: (args, context) => withRoot(args, context, (storyId, storyRoot) => shortStoryReviewIdentity(storyRoot, storyId)),
    },
    {
      name: 'story_record_review',
      description: '逐模块回写全篇审读结果；必须携带当前审读输入指纹，空发现项也需回写完成。',
      parameters: {
        type: 'object',
        properties: {
          storyId: { type: 'string' },
          module: { type: 'string', enum: ['结构与因果', '人物与情绪', '连续性与交付'] },
          expectedFingerprint: { type: 'string' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                发现项编号: { type: 'string' }, 证据位置: { type: 'string' }, 问题说明: { type: 'string' },
                修改建议: { type: 'string' }, 影响范围: { type: 'string' },
              },
              required: ['发现项编号', '证据位置', '问题说明'],
            },
          },
        },
        required: ['storyId', 'module', 'expectedFingerprint', 'findings'],
      },
      output,
      execute: (args, context) => withRoot(args, context, (storyId, storyRoot) => ingestShortStoryReview(storyRoot, {
        storyId,
        module: args.module as '结构与因果' | '人物与情绪' | '连续性与交付',
        expectedFingerprint: String(args.expectedFingerprint ?? ''),
        findings: Array.isArray(args.findings) ? args.findings as never[] : [],
      })),
    },
    {
      name: 'story_apply_revision',
      description: '按发现项处置批量修订短故事；新稿、降级旧稿和处置回写同一原子批次，改文后必须重审。',
      parameters: {
        type: 'object',
        properties: {
          storyId: { type: 'string' }, expectedReviewHash: { type: 'string' }, newBody: { type: 'string' },
          dispositions: {
            type: 'array',
            items: {
              type: 'object',
              properties: { 发现项编号: { type: 'string' }, status: { type: 'string', enum: ['已解决', '已接受修改', '作者保留', '已驳回', '无法判断'] }, note: { type: 'string' } },
              required: ['发现项编号', 'status'],
            },
          },
        },
        required: ['storyId', 'expectedReviewHash', 'dispositions'],
      },
      output,
      execute: (args, context) => withRoot(args, context, (storyId, storyRoot) => applyShortStoryRevision(storyRoot, {
        storyId,
        expectedReviewHash: String(args.expectedReviewHash ?? ''),
        ...(args.newBody === undefined ? {} : { newBody: String(args.newBody) }),
        dispositions: Array.isArray(args.dispositions) ? args.dispositions as never[] : [],
      })),
    },
    {
      name: 'story_prepare_delivery',
      description: '按当前版本化番茄规则包运行交付检查，绑定正文、计划、审读和规则包 hash；不代替番茄后台投稿。',
      parameters: { type: 'object', properties: { storyId: { type: 'string' } }, required: ['storyId'] },
      output,
      execute: (args, context) => withRoot(args, context, (_storyId, storyRoot) => prepareShortStoryDelivery(storyRoot, String(args.storyId))),
    },
    {
      name: 'story_settle',
      description: '请求作者批准当前正文、审读记录和交付检查的精确 hash；批准后原子定稿并产生 story: 提交。',
      parameters: {
        type: 'object',
        properties: { storyId: { type: 'string' }, draftHash: { type: 'string' }, reviewHash: { type: 'string' }, deliveryHash: { type: 'string' }, summary: { type: 'string' } },
        required: ['storyId', 'draftHash', 'reviewHash', 'deliveryHash', 'summary'],
      },
      output,
      execute: async (args, context?: ToolExecContext) => {
        const root = rootOf(args, context)
        if (!root.ok) return root
        if (deps.askFn === undefined) return { ok: false, reason: '裁决通道未配置' }
        const draftHash = String(args.draftHash ?? '')
        const reviewHash = String(args.reviewHash ?? '')
        const deliveryHash = String(args.deliveryHash ?? '')
        const decision = await askAuthor(deps.askFn, '定稿入档', {
          范围: `短故事 ${root.storyId}`,
          摘要: `正文 ${draftHash.slice(0, 12)} · 审读 ${reviewHash.slice(0, 12)} · 交付 ${deliveryHash.slice(0, 12)}`,
          版本: `${draftHash.slice(0, 12)}/${reviewHash.slice(0, 12)}/${deliveryHash.slice(0, 12)}`,
        }, { agent: context?.agent, signal: context?.signal })
        if (!decision.ok || decision.决定 !== '已批准') return { ok: false, reason: `未获作者批准:${decision.ok ? decision.决定 : decision.reason}` }
        return settleShortStory(root.storyRoot, {
          storyId: root.storyId,
          approval: { approved: true, decision: `作者通过裁决 UI 批准（kind=${decision.kind}）`, draftHash, reviewHash, deliveryHash },
          summary: String(args.summary ?? '短故事定稿'),
        })
      },
    },
    {
      name: 'story_write_export',
      description: '经作者确认，把短故事定稿写成无伪卷章的 Markdown/TXT 交付文件；冲突拒绝覆盖，写后读回验哈希。',
      parameters: {
        type: 'object',
        properties: { storyId: { type: 'string' }, targetDir: { type: 'string', description: '绝对导出目录' }, finalHash: { type: 'string', description: 'story_compute_export 返回的定稿正文 hash' } },
        required: ['storyId', 'targetDir', 'finalHash'],
      },
      output,
      execute: async (args, context?: ToolExecContext) => {
        const root = rootOf(args, context)
        if (!root.ok) return root
        if (deps.askFn === undefined) return { ok: false, reason: '导出裁决通道未配置' }
        const computed = computeShortStoryExport(root.storyRoot, root.storyId)
        if (!computed.ok) return computed
        const finalHash = String(args.finalHash ?? '')
        if (finalHash !== computed.finalHash) return { ok: false, reason: '定稿 hash 与作者批准不一致' }
        const targetDir = String(args.targetDir ?? '')
        const decision = await askAuthor(deps.askFn, '导出交付文件', {
          范围: `短故事 ${root.storyId} → ${targetDir}`,
          摘要: `${computed.files.length} 个文件 · 定稿 ${computed.finalHash.slice(0, 12)}`,
          版本: computed.finalHash,
        }, { agent: context?.agent, signal: context?.signal })
        if (!decision.ok || decision.决定 !== '已批准') return { ok: false, reason: `未获作者批准:${decision.ok ? decision.决定 : decision.reason}` }
        return writeShortStoryExport(root.storyRoot, root.storyId, targetDir, finalHash)
      },
    },    {
      name: 'story_compute_export',
      description: '只读计算短故事无伪卷章的 Markdown/TXT 导出载荷；不落盘。',
      parameters: { type: 'object', properties: { storyId: { type: 'string' } }, required: ['storyId'] },
      output,
      execute: (args, context) => withRoot(args, context, (storyId, storyRoot) => computeShortStoryExport(storyRoot, storyId)),
    },
  ]
}
