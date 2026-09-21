/** Match the CLI's launch initialization before the source-denied probe. */
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const [profile, hostAnchor] = process.argv.slice(2)
const require = createRequire(hostAnchor)
const { loadProfile, healProfilesModuleFallback } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
const home = path.dirname(path.dirname(profile))
await healProfilesModuleFallback({ installAnchor: hostAnchor, home,
  profile: loadProfile('dsh', path.basename(profile), hostAnchor, home) })
console.log('Initialized the isolated profile using the host launch API')
