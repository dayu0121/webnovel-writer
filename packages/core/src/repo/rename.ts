import * as fs from 'node:fs'

const waitCell = new Int32Array(new SharedArrayBuffer(4))
const WINDOWS_RETRY_MS = [10, 25, 50, 100, 150] as const

/** Windows 目录扫描/读句柄可能短暂阻止 rename；有界重试同一原子操作，不改权限或删除目标。 */
export function renameSync(source: string, target: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(source, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const delay = WINDOWS_RETRY_MS[attempt]
      if (process.platform !== 'win32' || (code !== 'EPERM' && code !== 'EBUSY') || delay === undefined) throw error
      Atomics.wait(waitCell, 0, 0, delay)
    }
  }
}
