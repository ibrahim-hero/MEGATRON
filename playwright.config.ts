import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 120000, expect: { timeout: 30000 }, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3093', viewport: { width: 1440, height: 1000 }, headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node bin/mg.js serve --demo --port 3093 --state tools/e2e-state', url: 'http://127.0.0.1:3093', reuseExistingServer: false, timeout: 30000 },
  reporter: [['list'], ['html', { open: 'never' }]],
});
