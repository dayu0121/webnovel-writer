/**
 * 装机(PRD §6.1 / plugin-spec §12 / §16「接线」)——工作范围注册 + 书房脚手架。
 *
 * 首次运行(workspaceRegistry 为空)时:选目录 → 校验 → 注册那一个 workspace →
 * 落 `书房/{构想,灵感池,作者记忆,知识库}` 四空目录(幂等)。
 *
 * 纯逻辑(校验/脚手架)与宿主接入分离:本文件校验与脚手架为纯函数可测,
 * `pickWorkspaceDirectory` 为判别式 switch(directoryPicker capability)。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

/** 书房子目录(PRD §9.1 术语表:构想草案/灵感池/作者记忆/知识库)。 */
export const STUDY_DIRS = ['构想', '灵感池', '作者记忆', '知识库'] as const

/** 目录校验结果(装机前对候选工作范围的检查,PRD §4.5 / plugin-spec §12)。 */
export type WorkspaceValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

/**
 * 校验候选目录可否作为工作范围:
 * - 存在、是目录;
 * - 不是 git 仓(避免与各书仓的 git -C 打架造嵌套仓);
 * - 不在任何已注册 workspace 之下 / 非他人 workspace 本身(resolveByPath 无主);
 * - 不在任何 git 仓内部(findProjectRoot 不能命中外层仓,否则 skill 路径跑位)。
 */
export function validateWorkspacePath(
  candidate: string,
  resolveByPath: (p: string) => unknown | undefined,
  isInsideAnyWorkspace: (p: string) => boolean,
): WorkspaceValidation {
  let stat: fs.Stats
  try {
    stat = fs.statSync(candidate)
  } catch {
    return { ok: false, reason: '目录不存在或不可访问' }
  }
  if (!stat.isDirectory()) return { ok: false, reason: '不是目录' }
  const real = fs.realpathSync(candidate)
  if (resolveByPath(real) !== undefined) return { ok: false, reason: '该目录已是注册的 workspace' }
  if (isInsideAnyWorkspace(real)) return { ok: false, reason: '该目录位于已注册 workspace 内部' }
  if (isGitRepo(real)) return { ok: false, reason: '工作范围本身不得是 git 仓(会与各书仓的 git -C 打架,造嵌套仓)' }
  if (insideGitRepo(real)) return { ok: false, reason: '工作范围不得落在别人的 git 仓内部(否则 findProjectRoot 命中外层仓)' }
  return { ok: true }
}

function isGitRepo(p: string): boolean {
  return fs.existsSync(path.join(p, '.git'))
}

/** 逐级向上找 .git(模拟 findProjectRoot 的 marker 检查;不要求是目录——stat 存在即可)。 */
function insideGitRepo(start: string): boolean {
  let cur = path.resolve(start)
  for (;;) {
    const marker = path.join(cur, '.git')
    try {
      fs.statSync(marker)
      return true
    } catch {
      // 继续向上
    }
    const parent = path.dirname(cur)
    if (parent === cur) return false
    cur = parent
  }
}

/**
 * 落书房脚手架(幂等):`<工作范围>/书房/{构想,灵感池,作者记忆,知识库}`。
 * 返回实际存在的子目录列表(已存在不重复建)。
 */
export function scaffoldStudy(workspaceRoot: string): readonly string[] {
  const studyRoot = path.join(workspaceRoot, '书房')
  fs.mkdirSync(studyRoot, { recursive: true })
  const created: string[] = []
  for (const dir of STUDY_DIRS) {
    const p = path.join(studyRoot, dir)
    fs.mkdirSync(p, { recursive: true })
    created.push(p)
  }
  return created
}

/** directoryPicker 判别式能力的最小类型(mirror dsh,防锁全量类型)。 */
export type DirectoryPickerCapabilityLike =
  | {
      readonly kind: 'native'
      readonly pick: (signal: AbortSignal) => Promise<string | null>
    }
  | {
      readonly kind: 'browse'
      readonly list: (p?: string, signal?: AbortSignal) => Promise<Readonly<{
        readonly path: string
        readonly entries: ReadonlyArray<{ readonly name: string; readonly path: string }>
      }>>
      readonly createDirectory: (p: string, name: string) => Promise<string>
    }

/**
 * 用 directoryPicker 选工作范围目录;后端未知时 hide affordance(返回 undefined)。
 * @returns 选定目录绝对路径;取消或不可用时 null/undefined。
 */
export async function pickWorkspaceDirectory(
  capability: DirectoryPickerCapabilityLike | undefined,
  signal: AbortSignal,
): Promise<string | null | undefined> {
  if (capability === undefined) return undefined
  if (capability.kind === 'native') {
    return capability.pick(signal)
  }
  // browse 后端:需要应用内浏览器 UI 驱动(一级列目录)选目录;首版最小化
  // 不自动选 home(防止未经作者选择就在家目录建 书房/),返回 undefined 待 UI 浏览。
  return undefined
}

// 原 StorageDomainLike / persistWorkspaceRoot / loadWorkspaceRoot 删除(2026-09-01,审计甲2)。
// 理由:workspaceRegistry「通过存储领域数据形式存储自己的记录」(dsh workspace.zh.md),
// storageDomain 与 sessionPersistence 是它的必需启动依赖 —— 工作范围路径它已经存了,
// 我们再存一份是重建宿主已给的东西(同 R10 自建 skill 发现、R16 自建书登记)。
// spec §12 那条「storageDomain 还要不要存工作范围路径」的未核项据此收口:不必存。
// 附带事实:persistWorkspaceRoot 从无调用方 → 该域从未被写 → loadWorkspaceRoot 恒返回
// undefined,故这三个符号是死码,删除功能中性。工作范围一律从 workspaceRegistry 取。
