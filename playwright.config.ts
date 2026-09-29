import { defineConfig } from '@playwright/test'
import { loadEnv } from 'vite'

// Same Supabase URL/key the dev server uses (.env.local).
Object.assign(process.env, loadEnv('development', process.cwd(), ''))

export default defineConfig({
  testDir: 'e2e',
  workers: 1, // the tests share one seeded contest
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
})
