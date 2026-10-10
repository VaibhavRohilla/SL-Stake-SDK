import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: 'browser.test.ts', workers: 1,
  reporter: 'list', use: { browserName: 'chromium', headless: true, baseURL: 'http://127.0.0.1:4179' },
  webServer: { command: 'node scripts/serve.mjs', url: 'http://127.0.0.1:4179', reuseExistingServer: false },
});
