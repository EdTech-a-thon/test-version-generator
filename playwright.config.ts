import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './scripts',
  testMatch: '*.e2e.ts',
  // This VM has only 2 cores. Running several Chromium instances in parallel
  // alongside the Vite dev server exhausts memory and crashes pages
  // ("Page crashed"), which surfaced as intermittent e2e failures that wasted
  // whole coordinator repair cycles. Serialize to one worker for stability and
  // retry transient failures so a single flake no longer fails the run.
  workers: 1,
  retries: 2,
  use: { baseURL: 'http://127.0.0.1:4174' },
  webServer: {
    command: 'bunx vite --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: true,
  },
})
