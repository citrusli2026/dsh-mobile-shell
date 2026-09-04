import { test, expect } from '@playwright/test'

const MASTER_TOKEN = process.env.DSH_REMOTE_TOKEN
if (!MASTER_TOKEN) throw new Error('DSH_REMOTE_TOKEN is required for Web E2E')

const KNOWN_UPSTREAM_DIAGNOSTICS = [
  /\[ui-cordis\].*dynamicCordisRunner\/inventory failed: Failed to fetch/s,
  /\/api\/credentials\.describe due to access control checks\./s,
]

function trackBrowserErrors(page) {
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? ''
    // Long-lived event streams are expected to be cancelled on navigation and
    // reload; they are not application failures.
    if (/ERR_ABORTED|cancelled/i.test(failure)) return
    errors.push(`requestfailed: ${request.url()} ${failure}`)
  })
  return errors
}

async function mintPairingCode(request) {
  const response = await request.post('/pair/new', {
    headers: { authorization: `Bearer ${MASTER_TOKEN}` },
  })
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  expect(body.code).toMatch(/^\d{6}$/)
  return body.code
}

test.describe('Web QR pairing', () => {
  test('prefills a one-time code, pairs, and keeps the session after reload', async ({ page, request }) => {
    const errors = trackBrowserErrors(page)
    const code = await mintPairingCode(request)

    await page.goto(`/launch?token=legacy-secret&keep=1#pair=${code}`, {
      waitUntil: 'domcontentloaded',
    })

    await expect(page).toHaveURL(/\/launch\?keep=1$/)
    await expect(page.locator('body')).toHaveClass(/web/)
    await expect(page.locator('#pairServer')).toBeHidden()
    await expect(page.getByText(/当前主机/)).toBeVisible()
    await expect(page.locator('#code')).toHaveValue(code)
    await expect(page.getByRole('button', { name: '确认配对并连接' })).toBeFocused()
    await expect(page.locator('body')).not.toContainText(MASTER_TOKEN)

    await page.getByRole('button', { name: '确认配对并连接' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page).toHaveTitle(/DeepSeek Harness/)
    await expect(page.locator('body')).toContainText('探索未至之境')

    const cookies = await page.context().cookies()
    const sessionCookie = cookies.find((cookie) => cookie.name === 'dsh_token')
    expect(sessionCookie?.httpOnly).toBe(true)
    expect(sessionCookie?.value).not.toBe(MASTER_TOKEN)
    expect(page.url()).not.toContain('token')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page).toHaveTitle(/DeepSeek Harness/)
    await expect(page.locator('body')).toContainText('探索未至之境')
    await expect(page.locator('body')).not.toHaveClass(/web/)
    const knownDiagnostics = errors.filter((error) =>
      KNOWN_UPSTREAM_DIAGNOSTICS.some((pattern) => pattern.test(error)))
    for (const diagnostic of knownDiagnostics) {
      test.info().annotations.push({
        type: 'known-upstream-diagnostic',
        description: diagnostic,
      })
    }
    expect(errors.filter((error) => !knownDiagnostics.includes(error))).toEqual([])
  })

  test('rejects an invalid QR fragment without attempting redemption', async ({ page }) => {
    let pairRequests = 0
    page.on('request', (request) => {
      if (request.url().endsWith('/pair')) pairRequests += 1
    })

    await page.goto('/launch#pair=not-a-code', { waitUntil: 'domcontentloaded' })

    await expect(page).toHaveURL(/\/launch$/)
    await expect(page.getByRole('status')).toContainText('二维码中的配对码无效')
    expect(pairRequests).toBe(0)
  })

  test('launcher offers Chinese and English with the language toggle', async ({ page }) => {
    await page.goto('/launch', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-testid="tab-pair"]')).toHaveText('配对码连接')

    await page.locator('[data-testid="lang-toggle"]').click()
    await expect(page.locator('[data-testid="tab-pair"]')).toHaveText('Pairing code')
    await expect(page).toHaveTitle(/Connect to host/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    await page.locator('[data-testid="lang-toggle"]').click()
    await expect(page.locator('[data-testid="tab-pair"]')).toHaveText('配对码连接')
  })

  test('sign out revokes the device and returns to a clean pairing page', async ({ page, request }) => {
    const code = await mintPairingCode(request)
    await page.goto(`/launch#pair=${code}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '确认配对并连接' }).click()
    await expect(page).toHaveTitle(/DeepSeek Harness/)

    await page.goto('/launch', { waitUntil: 'domcontentloaded' })
    const savedCard = page.locator('[data-testid="saved-card"]')
    await expect(savedCard).toBeVisible()
    await page.locator('[data-testid="logout-btn"]').click()

    await expect(page.locator('[data-testid="picker"]')).toBeVisible()
    await expect(page.getByRole('status')).toContainText('已退出当前设备')

    const check = await page.request.get('/session/check')
    expect(check.status()).toBe(401)
  })

  test('an expired session shows the expired state instead of a bare 401', async ({ page, request }) => {
    // Pair, then revoke server-side to simulate a 30-day expiry or remote revoke.
    const code = await mintPairingCode(request)
    await page.goto(`/launch#pair=${code}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '确认配对并连接' }).click()
    await expect(page).toHaveTitle(/DeepSeek Harness/)

    const check = await page.request.get('/session/check')
    const deviceId = (await check.json()).deviceId
    expect(deviceId, 'device id missing from session check')
    const revoke = await page.request.post('/devices/revoke', {
      headers: { authorization: `Bearer ${MASTER_TOKEN}` },
      data: { id: deviceId },
    })
    expect(revoke.ok()).toBeTruthy()

    await page.goto('/launch', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-testid="saved-host"]')).toBeVisible()
    await expect(page.locator('[data-testid="saved-card"]')).toContainText('会话已过期')
    await expect(page.locator('[data-testid="continue-btn"]')).toBeHidden()
    // Pairing again is the offered recovery path and it works.
    const fresh = await mintPairingCode(request)
    await page.goto(`/launch#pair=${fresh}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '确认配对并连接' }).click()
    await expect(page).toHaveTitle(/DeepSeek Harness/)
  })
})

test.describe('Admin console', () => {
  test('unlocks with the master token, lists devices, and revokes one', async ({ page }) => {
    const code = await mintPairingCode(page.request)
    // Create a victim device via the browser pairing flow.
    await page.goto(`/launch#pair=${code}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '确认配对并连接' }).click()
    await expect(page).toHaveTitle(/DeepSeek Harness/)

    await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="admin-token"]').fill(MASTER_TOKEN)
    await page.locator('[data-testid="admin-unlock"]').click()
    await expect(page.locator('[data-testid="admin-device-table"]')).toBeVisible()
    await expect(page.locator('[data-testid="admin-revoke"]').first()).toBeVisible()

    // Grab the id of the newest active device row, then revoke it.
    const listBefore = await (await page.request.get('/devices', {
      headers: { authorization: `Bearer ${MASTER_TOKEN}` },
    })).json()
    const victim = listBefore.devices.filter((device) => device.active)
      .sort((a, b) => b.issuedAt - a.issuedAt)[0]
    expect(victim, 'no active device visible to the admin console')

    page.on('dialog', (dialog) => dialog.accept())
    await page.locator(`[data-device-id="${victim.id}"][data-testid="admin-revoke"]`).click()
    await expect(page.getByRole('status')).toContainText('已吊销')

    await expect(async () => {
      const list = await (await page.request.get('/devices', {
        headers: { authorization: `Bearer ${MASTER_TOKEN}` },
      })).json()
      const record = list.devices.find((device) => device.id === victim.id)
      expect(record?.active, `device ${victim.id} still active after revoke`)
    }).toPass()
  })
})
