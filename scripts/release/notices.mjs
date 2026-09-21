import fs from 'node:fs'
import path from 'node:path'

/** License inventory is derived from actual bundled inputs, not all dev tools. */
export function writeNotices(packageRoot, builds) {
  const found = new Map()
  for (const build of builds) {
    for (const input of Object.keys(build.metafile.inputs)) {
      if (!input.replaceAll('\\', '/').includes('node_modules/')) continue
      let directory = path.dirname(fs.realpathSync(path.resolve(input)))
      let manifest
      while (true) {
        const filename = path.join(directory, 'package.json')
        if (fs.existsSync(filename)) {
          const candidate = JSON.parse(fs.readFileSync(filename, 'utf8'))
          if (candidate.name && candidate.version) { manifest = candidate; break }
        }
        const parent = path.dirname(directory)
        if (parent === directory) throw new Error(`No package owner for bundled input: ${input}`)
        directory = parent
      }
      const key = `${manifest.name}@${manifest.version}`
      if (found.has(key)) continue
      const license = typeof manifest.license === 'string' ? manifest.license : manifest.license?.type
      const allowed = /^(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|\(MPL-2\.0 OR Apache-2\.0\))$/
      if (!allowed.test(license ?? '')) throw new Error(`Review bundled license before release: ${key} (${license})`)
      const files = fs.readdirSync(directory).filter(name => /^(licen[cs]e|copying|notice)([._-]|$)/i.test(name) && fs.statSync(path.join(directory, name)).isFile()).sort()
      if (!files.length) throw new Error(`No original license file found: ${key}`)
      const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
      found.set(key, { name: manifest.name, version: manifest.version, license, repository, directory, files })
    }
  }
  const entries = [...found.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'))
  const licenses = path.join(packageRoot, 'licenses')
  fs.mkdirSync(licenses, { recursive: true })
  const expected = new Set()
  const rows = []
  for (const entry of entries) {
    const filename = `${entry.name.replaceAll('@', '').replaceAll('/', '__')}--${entry.version}.txt`
    expected.add(filename)
    const text = [`${entry.name}@${entry.version}`, `SPDX: ${entry.license}`, `Repository: ${entry.repository ?? 'see package metadata'}`, '',
      ...entry.files.flatMap(name => [`--- ${name} ---`, fs.readFileSync(path.join(entry.directory, name), 'utf8'), ''])].join('\n')
    fs.writeFileSync(path.join(licenses, filename), text)
    rows.push(`| ${entry.name} | ${entry.version} | ${entry.license} | [Original notices](licenses/${filename}) |`)
  }
  // Only previously generated regular notice files in this exact directory.
  for (const name of fs.readdirSync(licenses)) {
    if (/--[\d][\w.+-]*\.txt$/.test(name) && !expected.has(name) && fs.lstatSync(path.join(licenses, name)).isFile()) fs.unlinkSync(path.join(licenses, name))
  }
  fs.writeFileSync(path.join(packageRoot, 'THIRD_PARTY_NOTICES.md'), [
    '# Third-party notices', '',
    'Generated from the Host and Client build inputs. Original copyright notices and license texts are preserved in `licenses/`.',
    'The application is GPL-3.0-only; these components retain their own licenses. For DOMPurify, this distribution elects the Apache-2.0 option.',
    'Shared DSH/React peers are provided by the host and are not included in this bundle. Their exact versions are recorded in package.json.', '',
    '| Component | Version | License | Text |', '| --- | --- | --- | --- |', ...rows, '',
    'The release includes source materials and a manifest for these bundled components. Build from the corresponding public source tag with the lockfile.', '',
  ].join('\n'))
  fs.writeFileSync(path.join(packageRoot, 'lib', 'third-party-inputs.json'), JSON.stringify(entries, null, 2) + '\n')
  console.log(`[licenses] ${path.basename(packageRoot)}: ${entries.length} bundled components`)
}
