import { writeFileAtomic } from '@webnovel/core'
import type { NativeWrite } from '../../src/native-write'

/** Business-only tests; the real Loader suite owns DSH observation/CAS coverage. */
export const nativeWriteStub: NativeWrite = async (root, op) => {
  writeFileAtomic(root, op.relPath, op.content)
}
