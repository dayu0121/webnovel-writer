import type { StudyDocument } from '../study/types'

export function documentQuote(document: StudyDocument, buffer: string, selection: string): string {
  const offset = buffer.indexOf(selection)
  const unique = offset >= 0 && buffer.indexOf(selection, offset + 1) < 0
  const dirty = buffer !== document.body
  const location = unique ? `正文第 ${buffer.slice(0, offset).split('\n').length} 行起` : '以完整引文核对，未猜测位置'
  return [
    '【书房原文引用】',
    `来源：${document.owner} / ${document.ref.path}`,
    `范围：${document.ref.space}；文件：${document.absolutePath}`,
    `磁盘版本：${String(document.version ?? '无版本字段')}；SHA-256：${document.hash}`,
    `${dirty ? '以下引用来自未保存编辑，磁盘哈希仅标识编辑基线；' : ''}${location}`,
    '', selection.split('\n').map(line => '> ' + line).join('\n'), '',
  ].join('\n')
}
