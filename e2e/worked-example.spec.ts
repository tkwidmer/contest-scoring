// P1 exit check: the worked example from docs/design/02-scoring-engine.md (loaded by supabase/seed.sql)
// produces "Winner: B" on tiebreak step 2, score entry changes the outcome, and finalize freezes it.
// The test puts every score back, so it can run against a local dev database.
import { expect, request, test, type Page } from '@playwright/test'

const API = process.env.VITE_SUPABASE_URL!
const KEY = process.env.VITE_SUPABASE_ANON_KEY!
const MAILPIT = 'http://127.0.0.1:54324'
const CONTEST = '/c/00000000-0000-0000-0000-0000000000c1'

async function signIn(page: Page) {
  const api = await request.newContext()
  await api.delete(`${MAILPIT}/api/v1/messages`)
  const otp = await api.post(`${API}/auth/v1/otp`, { headers: { apikey: KEY }, data: { email: 'producer@test.dev', create_user: false } })
  expect(otp.ok(), await otp.text()).toBeTruthy()
  let id = ''
  await expect.poll(async () => (id = (await (await api.get(`${MAILPIT}/api/v1/messages`)).json()).messages?.[0]?.ID ?? '')).not.toBe('')
  const html: string = (await (await api.get(`${MAILPIT}/api/v1/message/${id}`)).json()).HTML
  await page.goto(html.match(/href="([^"]+)"/)![1]!.replace(/&amp;/g, '&'))
  await expect(page.getByRole('heading', { name: 'Your organizations' })).toBeVisible()
}

async function setScore(page: Page, judge: string, contestant: string, component: string, value: string) {
  await page.goto(`${CONTEST}/scores`)
  await page.getByLabel('Judge', { exact: true }).selectOption({ label: judge })
  await page.getByLabel('Contestant', { exact: true }).selectOption({ label: contestant })
  const cell = page.getByRole('textbox', { name: component, exact: true })
  await cell.fill(value)
  await cell.press('Enter')
  await expect(page.getByRole('status')).toHaveText('All saved')
}

const banner = (page: Page) => page.getByRole('status').first()

test('worked example: tiebreak, score entry and finalize', async ({ page }) => {
  page.on('dialog', d => d.accept())
  await signIn(page)

  await page.goto(`${CONTEST}/standings`)
  await expect(banner(page)).toHaveText(/Winner: 2 · B · 117 pts \(78\.0%\) · won on tiebreak step 2/)
  const rows = page.locator('tbody > tr').filter({ has: page.locator('button[aria-expanded]') })
  await expect(rows.nth(0)).toContainText('2 · B')
  await expect(rows.nth(1)).toContainText('1 · A')
  await expect(page.getByText('Below the 70% minimum')).toBeVisible()

  // J3 gives A 1.5 more on Speech Content: A's Speech becomes 49.5, total 118.5, an outright win.
  await setScore(page, 'J3', '1 · A', 'Content', '9.5')
  await page.goto(`${CONTEST}/standings`)
  await expect(banner(page)).toHaveText(/Winner: 1 · A · 118\.5 pts/)

  await setScore(page, 'J3', '1 · A', 'Content', '8')
  await page.goto(`${CONTEST}/standings`)
  await expect(banner(page)).toHaveText(/Winner: 2 · B/)

  await page.getByRole('button', { name: 'Finalize results' }).click()
  await expect(banner(page)).toContainText('Finalized')
  await page.goto(`${CONTEST}/scores`)
  await expect(page.getByText('Scores are read-only')).toBeVisible()

  await page.goto(`${CONTEST}/standings`)
  await page.getByRole('button', { name: 'Reopen scoring' }).click()
  await expect(page.getByRole('button', { name: 'Finalize results' })).toBeVisible()
})
