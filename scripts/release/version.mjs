import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

export const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
export function releaseVersion(directory = root, tag) {
  const bundle = JSON.parse(fs.readFileSync(path.join(directory, 'packages/bundle/package.json'), 'utf8'))
  const workspace = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
  assert.match(bundle.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-z]+\.[1-9]\d*)?$/)
  assert.equal(workspace.version, bundle.version, 'Workspace and main release version must agree')
  assert.equal(bundle.name, '@linfengqaqtat/dsh-scriptor')
  const expectedTag = `scriptor-v${bundle.version}`
  if (tag) assert.equal(tag, expectedTag, 'Release tag must match the package version')
  const changelog = fs.readFileSync(path.join(directory, 'CHANGELOG.md'), 'utf8')
  assert.ok(changelog.includes(`## [${bundle.version}]`), 'Missing versioned changelog entry')
  return { version: bundle.version, tag: expectedTag, prerelease: bundle.version.includes('-'),
    packageName: bundle.name, filename: `linfengqaqtat-dsh-scriptor-${bundle.version}.tgz` }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(releaseVersion(root, process.env.RELEASE_TAG), null, 2))
}
