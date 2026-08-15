import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3081'
const chromeUse = {
  ...devices['Desktop Chrome'],
  ...(process.env.E2E_USE_INSTALLED_CHROME === '1' ? { channel: 'chrome' } : {}),
}

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // dsh web keeps per-process session state; serialize browsers against the
  // one shared upstream used by the local and CI E2E harness.
  workers: 1,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['line']] : [['line']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: chromeUse },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 14'] } },
  ],
})
