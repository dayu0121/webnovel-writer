import { defineConfig } from 'vitest/config';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Windows runners expose an 8.3 TEMP alias; fixtures and fault-injection mocks
// must use the same canonical path that the filesystem returns to production.
const testTemp = realpathSync.native(tmpdir());

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.spec.ts', 'packages/*/src/**/*.spec.ts'],
    environment: 'node',
    // Many integration files spawn Git/Node processes; bound contention on CI.
    maxWorkers: process.env['CI'] ? 2 : 4,
    testTimeout: 15_000,
    // afterAll fixture removal retries on slow Windows runners can exceed the 10s default.
    hookTimeout: 60_000,
    env: { TEMP: testTemp, TMP: testTemp, TMPDIR: testTemp },
  },
});
