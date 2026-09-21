import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = process.argv[2] ?? process.env.DSH_CLI_ENTRY
const port = Number(process.argv[3] ?? 6095)
if (!cli || !fs.existsSync(cli)) throw new Error('Supply the installed DSH lib/bin.js path or set DSH_CLI_ENTRY')
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port')
await new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(port, '127.0.0.1', () => probe.close(resolve))
})
const root = path.join(packageRoot, '.webnovel', 'local-server')
fs.mkdirSync(root, { recursive: true })
const patch = path.join(root, 'cordis.patch.yml')
fs.writeFileSync(patch, JSON.stringify([{ insert: [{ id: 'webnovel', name: pathToFileURL(path.join(packageRoot, 'lib/index.js')).href }] }], null, 2) + '\n')
const stdout = fs.openSync(path.join(root, 'stdout.log'), 'w')
const stderr = fs.openSync(path.join(root, 'stderr.log'), 'w')
const child = spawn(process.execPath, [path.resolve(cli), '--profile', 'web', '--patch', patch, '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
  cwd: path.resolve(packageRoot, '../..'),
  env: { ...process.env },
  detached: true, windowsHide: true, stdio: ['ignore', stdout, stderr],
})
child.unref(); fs.closeSync(stdout); fs.closeSync(stderr)
fs.writeFileSync(path.join(root, 'runtime.json'), JSON.stringify({ root, processId: child.pid, port }, null, 2) + '\n')
console.log(`DSH local process ${child.pid}; URL http://127.0.0.1:${port}/; logs ${root}`)
