import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  use: { ...devices['Desktop Chrome'], trace: 'off' },
});
