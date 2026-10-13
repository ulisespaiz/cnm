import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Smoke tests run against the production build served by `astro preview`:
//   npm run build && npm run test:e2e
// PW_CHROMIUM_PATH points at an installed Chromium/Chrome binary instead of the one
// `npx playwright install chromium` downloads (useful where that download is blocked).
// PW_PORT changes the preview port (default 4321) when another server already uses it.

const PORT = Number(process.env.PW_PORT) || 4321;
const baseURL = `http://127.0.0.1:${PORT}`;

if (!existsSync('dist/index.html')) {
  throw new Error('No build found: run "npm run build" before "npm run test:e2e".');
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined },
      },
    },
  ],
  webServer: {
    // --ignore-lock keeps the server in the foreground: Astro 7 otherwise detaches `astro preview`
    // into the background when it detects an AI coding agent, and Playwright would see it exit.
    command: `npx astro preview --ignore-lock --host 127.0.0.1 --port ${PORT}`,
    url: baseURL,
    // Never test against a dev server (drafts, no production build) that happens to be on the port.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
