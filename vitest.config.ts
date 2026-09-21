import { defineConfig } from 'vitest/config';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Windows runners expose an 8.3 TEMP alias; fixtures and fault-injection mocks
// must use the same canonical path that the filesystem returns to production.
const testTemp = realpathSync(tmpdir());

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.spec.ts', 'packages/*/src/**/*.spec.ts'],
    environment: 'node',
    // Many integration files spawn Git/Node processes; bound contention on CI.
    maxWorkers: 4,
    env: { TEMP: testTemp, TMP: testTemp, TMPDIR: testTemp },
  },
});
