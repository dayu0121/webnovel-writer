import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { packageFiles } from '../tar.mjs'

function entry(name, type = '0', body = 'example') {
  const header = Buffer.alloc(512)
  header.write(name)
  header.write(Buffer.byteLength(body).toString(8).padStart(11, '0'), 124)
  header.write(type, 156)
  return Buffer.concat([header, Buffer.from(body), Buffer.alloc((512 - Buffer.byteLength(body) % 512) % 512)])
}
function withArchive(data, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptor-archive-'))
  const file = path.join(root, 'package.tgz')
  try { fs.writeFileSync(file, zlib.gzipSync(Buffer.concat([data, Buffer.alloc(1024)]))); callback(file) }
  finally { fs.unlinkSync(file); fs.rmdirSync(root) }
}
test('archive inspection reads regular files without extracting', () => {
  withArchive(entry('package/README.md'), file => assert.equal(packageFiles(file).get('README.md').toString(), 'example'))
})
test('archive inspection rejects traversal, links, absolute paths and duplicate entries', () => {
  for (const data of [entry('package/../../secret'), entry('package/link', '2'), entry('/package/file'), Buffer.concat([entry('package/x'), entry('package/x')])]) {
    withArchive(data, file => assert.throws(() => packageFiles(file)))
  }
})
