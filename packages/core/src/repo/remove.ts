/**
 * 删除文件或目录。
 *
 * Node 24 Windows 上 `fs.rmSync(path)` 的 path 含非 ASCII 时会静默空操作、也不抛错。
 * 书仓路径是中文，必须走 unlink/rmdir。ENOENT 视为已删除。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

export function removeSync(abs: string): void {
  let st: fs.Stats
  try {
    st = fs.lstatSync(abs)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(abs)) {
      removeSync(path.join(abs, name))
    }
    fs.rmdirSync(abs)
    return
  }
  fs.unlinkSync(abs)
}
