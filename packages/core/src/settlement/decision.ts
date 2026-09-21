/**
 * 定稿裁决回写（3c 写入器统一，R21 写侧）：把作者裁决（批准／退回）记进待定稿包
 * `清单.json` 的 `裁决` 字段。校验→原子写：清单缺失或机器态解析失败即失败、不落盘；
 * 该文件是轮次工件不入档，git 提交由定稿入档（archiveChapter）统一执行。
 *
 * （原为 novel-tools.ts 工具层裸写，2026-09-05 收编进 core——工具层零裸写。）
 */

import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import type { ChapterKey } from '../derive/scan'
import { writeFileAtomic } from '../repo/atomic'
import { paths } from '../repo/paths'
import { MACHINE_SCHEMA_VERSION, parseMachineJson, serializeMachineJson } from '../repo/schema'
import { bookWriter } from '../repo/atomic'

function writeSettlementDecisionLocked(
  bookRoot: string,
  key: Pick<ChapterKey, '卷' | '章名'>,
  裁决: '已批准' | '已退回',
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const rel = nodePath.join(paths.待定稿包目录(key.卷, key.章名), '清单.json')
  let text: string
  try {
    text = fs.readFileSync(nodePath.join(bookRoot, rel), 'utf8')
  } catch {
    return { ok: false, reason: '待定稿包缺清单.json,无法回写裁决' }
  }
  const parsed = parseMachineJson(text, MACHINE_SCHEMA_VERSION)
  if (!parsed.ok) return { ok: false, reason: `清单解析失败:${parsed.detail}` }
  try {
    writeFileAtomic(bookRoot, rel, serializeMachineJson({ ...parsed.data, 裁决 }, MACHINE_SCHEMA_VERSION))
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: `清单裁决回写失败:${err instanceof Error ? err.message : String(err)}` }
  }
}

export const writeSettlementDecision = bookWriter(writeSettlementDecisionLocked)
