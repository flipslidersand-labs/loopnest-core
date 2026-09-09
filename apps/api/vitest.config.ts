import { defineConfig } from 'vitest/config';
import coverageThresholds from './coverage-thresholds.json' with { type: 'json' };

// Coverage thresholds live in ./coverage-thresholds.json so the CI PR-comment
// step (.github/workflows/ci.yml) can read the same values instead of a
// hardcoded duplicate — see issue #112.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: coverageThresholds,
    },
  },
});
