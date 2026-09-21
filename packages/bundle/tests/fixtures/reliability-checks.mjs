import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export async function checkReliability({ root, book, main, ctx, service, execute, git, check, report, withTurn }) {
  const core = await import(pathToFileURL(path.join(root, 'native-write-core.mjs')).href)
  const key = { 卷: 9, 章: 9001, 章名: '可靠性样本' }
  const args = { bookId: 'loader-book', ...key }
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(book, rel)), { recursive: true }); fs.writeFileSync(path.join(book, rel), text) }
  const read = rel => fs.readFileSync(path.join(book, rel), 'utf8')
  const call = async (name, arguments_) => {
    const result = await withTurn(main, () => execute(main, name, arguments_))
    assert.equal(result.isError, false, JSON.stringify(result))
    return result.value
  }
  await check('纯处置保留证据、拒绝旧记录并允许上游保留', async () => {
    const recordRel = '草稿区/审核/卷09-可靠性样本.json'
    put('草稿区/草稿/卷09-可靠性样本/稿1.md', core.serializeDocument({ 角色: '待审稿', 版本: 1 }, '中文待审稿。'))
    core.writeReviewRecord(book, key, {
      schemaVersion: 1, 完成: true, 审稿哈希: 'a'.repeat(64), 审读指纹: 'b'.repeat(64), 模块: { 设定核对: { 完成: true, 失败: false } },
      问题: Array.from({ length: 21 }, (_, i) => core.normalizeFinding({ 发现项编号: `reliable-${i}`, 模块名: '设定核对', 问题说明: `中文记录${i}`, 证据位置: `第${i}段`, 影响范围: i === 0 ? '世界书' : '正文', 处置状态: '待处理' })),
    })
    const before = JSON.parse(read(recordRel))
    const beforeHead = git('rev-parse', 'HEAD')
    const status = await call('novel_get_story_status', { bookId: 'loader-book' })
    const hash = status.chapters.find(chapter => chapter.key.章名 === key.章名).审核记录哈希
    assert.equal(hash, core.reviewRecordHashOf(read(recordRel)))
    const result = await call('novel_apply_revision_batch', { ...args, 审核记录哈希: hash, 处置: [{ 发现项编号: 'reliable-0', 处置: '作者保留', 改动说明: '本次不改上游' }] })
    assert.equal(result.ok, true)
    assert.equal(result.审核记录哈希, core.reviewRecordHashOf(read(recordRel)))
    const after = JSON.parse(read(recordRel))
    assert.equal(after.审稿哈希, before.审稿哈希)
    assert.equal(after.审读指纹, before.审读指纹)
    assert.deepEqual(after.问题.slice(1), before.问题.slice(1))
    assert.deepEqual(after.模块, before.模块)
    assert.equal(git('rev-parse', 'HEAD'), beforeHead)
    const saved = read(recordRel)
    const conflict = await call('novel_apply_revision', { ...args, 审核记录哈希: hash, 发现项编号: 'reliable-1', 处置: '已驳回' })
    assert.equal(conflict.ok, false)
    assert.match(conflict.reason, /已变化/)
    const halfPatch = await call('novel_apply_revision', { ...args, 发现项编号: 'reliable-1', 处置: '已解决', 补丁旧文: '中文' })
    assert.equal(halfPatch.ok, false)
    assert.match(halfPatch.reason, /成对/)
    assert.equal(read(recordRel), saved)
    report.dispositionReliability = { findings: 21, sourceUnchanged: true, fingerprintsPreserved: true, staleRejected: true, partialPatchRejected: true }
  })

  await check('当前宿主中文候选生成编辑确认与失败恢复', async () => {
    const candidate = '草稿区/章细纲/卷09-可靠性样本.md'
    put('大纲/卷规划/卷09/近期窗口.md', '# 近期窗口\n\n- 可靠性样本 〔已确认〕\n')
    const unit = i => `### 单元 ${i}\n${core.单元字段.map(field => `- ${field}: 中文第${i}项，“引号”、破折号——😀 é A1。`).join('\n')}`
    const body = `# 章细纲\n\n## 定位段\n${core.定位段小节.map(name => `### ${name}\n${name === '章节功能' ? '- 〔硬〕' : ''}主角抵达城门，核对前置。`).join('\n\n')}\n\n## 细纲段\n\n${Array.from({ length: 12 }, (_, i) => unit(i + 1)).join('\n\n')}\n`
    const createArgs = { bookId: 'loader-book', 卷: 9, 章名: key.章名, 正文: body, 来源引用: ['作品契约/契约.md@1'] }
    assert.equal((await call('novel_new_outline_draft', createArgs)).ok, true)
    const initial = read(candidate)
    assert.equal(core.parseDocument(initial).data.body.trim(), body.trim())
    const file_path = path.join(book, candidate)
    assert.equal((await execute(main, 'read', { file_path })).isError, false)
    const off = ctx.on('approval/request', async () => 'allowed-once')
    const editSizes = []
    let expected = initial
    try {
      for (let i = 1; i <= 5; i++) {
        const old_string = unit(i)
        const new_string = unit(i).replaceAll('核对', '复核').replaceAll('中文第', '中文修订第')
        const editArgs = { file_path, old_string, new_string }
        const edited = await withTurn(main, () => execute(main, 'edit', editArgs))
        assert.equal(edited.isError, false, JSON.stringify(edited))
        expected = expected.replace(old_string, new_string)
        assert.equal(read(candidate), expected)
        editSizes.push(Buffer.byteLength(JSON.stringify(editArgs)))
      }
      const beforeFailure = read(candidate)
      const failed = await withTurn(main, () => execute(main, 'edit', { file_path, old_string: '不存在的整段中文', new_string: '不可写入' }))
      assert.equal(failed.isError, true)
      assert.equal(read(candidate), beforeFailure)
      assert.equal((await execute(main, 'read', { file_path })).isError, false)
      const correction = await withTurn(main, () => execute(main, 'edit', { file_path, old_string: unit(6), new_string: unit(6).replaceAll('中文第', '中文重读第') }))
      assert.equal(correction.isError, false)
      expected = expected.replace(unit(6), unit(6).replaceAll('中文第', '中文重读第'))
      assert.equal(read(candidate), expected)
      const confirmArgs = { ...args, summary: '可靠性候选确认' }
      const confirmation = await call('novel_confirm_outline', confirmArgs)
      assert.equal(confirmation.ok, true, JSON.stringify(confirmation))
      assert.equal(fs.existsSync(file_path), false)
      const confirmed = read('大纲/卷规划/卷09/章细纲/9001-可靠性样本.md')
      assert.equal(core.parseDocument(confirmed).data.body.trim(), core.parseDocument(expected).data.body.trim())
      assert.match(git('log', '-1', '--format=%s'), /^design\(ch9001\):/)
      report.chineseRoundtrip = { generatedBytes: Buffer.byteLength(body), creationPayloadBytes: Buffer.byteLength(JSON.stringify(createArgs)), maximumEditPayloadBytes: Math.max(...editSizes), confirmationPayloadBytes: Buffer.byteLength(JSON.stringify(confirmArgs)), edits: 6, byteExact: true, failedEditUnchanged: true, backendGeneration: 'not covered by this deterministic Loader test' }
    } finally { off() }
  })
}
