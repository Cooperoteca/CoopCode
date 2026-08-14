/**
 * The two pi-shell surfaces that unit tests cannot reach: the provider form must
 * really write a provider entry into ~/.prime/agent/models.json through the
 * main-process writer, and the model picker must populate from a live pi child
 * over RPC.
 *
 * Two traps this spec exists to avoid, both hit while writing it:
 *
 * 1. The harness isolates HOME to a disposable profile, so the main process does
 *    NOT write to the developer's ~/.prime. Resolving the target path from the
 *    main process is the only way to assert on the file that was actually written.
 * 2. Asserting the *absence* of "Loading models…" passes when the menu swaps the
 *    placeholder for an error item. The picker must be asserted by the presence
 *    of enabled model entries.
 *
 * The picker also needs a provider registered in the isolated HOME, or pi exits
 * with `Unknown provider "clinepass"` and the request dies on its 10s timeout.
 * Only the extension file is copied in — by design it holds an env var NAME, never
 * a key — so no credential crosses the fixture boundary.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'

const PI_CLI = 'C:/Dev2026/external_repos/prime-agent/packages/coding-agent/dist/cli.js'
const PROVIDER_ID = 'e2e-probe-provider'

/** The isolated HOME as the main process sees it, under the harness profile. */
async function isolatedHomeDir(electronApp: ElectronApplication): Promise<string> {
  return electronApp.evaluate(({ app }) => app.getPath('home'))
}

/** The extensions dir as the main process sees it, under the isolated HOME. */
async function isolatedExtensionsDir(electronApp: ElectronApplication): Promise<string> {
  const home = await isolatedHomeDir(electronApp)
  return join(home, '.prime', 'agent', 'extensions')
}

test.describe('pi shell — model picker and provider registration', () => {
  test.skip(!existsSync(PI_CLI), 'pi CLI not present on this machine')

  test('writes a provider into models.json and refuses a raw key', async ({ orcaPage: page, electronApp }) => {
    test.setTimeout(180_000)
    const home = await isolatedHomeDir(electronApp)
    const modelsPath = join(home, '.prime', 'agent', 'models.json')
    const legacyExtensionPath = join(home, '.prime', 'agent', 'extensions', `${PROVIDER_ID}.ts`)
    if (existsSync(modelsPath)) {
      rmSync(modelsPath)
    }

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('pi-chat:open')))
    await expect(page.getByTestId('flex-shell-region')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('flex-shell-open-providers').click()

    await page.locator('#pi-provider-id').fill(PROVIDER_ID)
    await page.locator('#pi-provider-name').fill('E2E Probe Provider')
    await page.locator('#pi-provider-baseurl').fill('https://api.example.com/v1')
    await page.locator('#pi-provider-api').fill('openai-completions')
    await page.locator('#pi-provider-credential').fill('E2E_PROBE_API_KEY')
    await page.locator('#pi-model-id-0').fill('probe/model-a')
    await page.locator('#pi-model-name-0').fill('Probe Model A')
    await page.locator('#pi-model-context-0').fill('128000')
    await page.locator('#pi-model-maxtokens-0').fill('8192')

    await page.getByRole('button', { name: /save provider/i }).click()
    await expect(page.getByText(/provider saved/i)).toBeVisible({ timeout: 30_000 })

    expect(existsSync(modelsPath)).toBe(true)
    const written = JSON.parse(readFileSync(modelsPath, 'utf8'))
    expect(written.providers[PROVIDER_ID]).toMatchObject({
      name: 'E2E Probe Provider',
      baseUrl: 'https://api.example.com/v1',
      // The credential must land as the env var NAME, never a key value.
      apiKey: 'E2E_PROBE_API_KEY',
      api: 'openai-completions'
    })
    expect(written.providers[PROVIDER_ID].models[0].id).toBe('probe/model-a')
    // The old extension-emitting path is gone: no .ts file may be generated.
    expect(existsSync(legacyExtensionPath)).toBe(false)
    // Reading back is the payoff: the form lists the provider it just wrote.
    await expect(page.getByTestId(`pi-registered-provider-${PROVIDER_ID}`)).toBeVisible({
      timeout: 15_000
    })

    // A raw-looking key must be refused, and nothing may be written for it.
    rmSync(modelsPath)
    await page.locator('#pi-provider-credential').fill(`sk-${'x'.repeat(48)}`)
    await page.getByRole('button', { name: /save provider/i }).click()
    await expect(page.getByText(/environment variable|never/i).first()).toBeVisible({
      timeout: 15_000
    })
    expect(existsSync(modelsPath)).toBe(false)
  })

  test('populates the model picker from a live pi session', async ({ orcaPage: page, electronApp }) => {
    test.setTimeout(240_000)

    const sourceExtension = join(homedir(), '.prime', 'agent', 'extensions', 'clinepass.ts')
    test.skip(!existsSync(sourceExtension), 'no clinepass provider extension to seed')
    const extensionsDir = await isolatedExtensionsDir(electronApp)
    mkdirSync(extensionsDir, { recursive: true })
    copyFileSync(sourceExtension, join(extensionsDir, 'clinepass.ts'))

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('pi-chat:open')))
    await expect(page.getByTestId('flex-shell-region')).toBeVisible({ timeout: 30_000 })

    const trigger = page.getByTestId('pi-model-picker-trigger')
    await expect(trigger).toBeVisible({ timeout: 30_000 })
    await trigger.click()

    const menu = page.getByTestId('pi-model-picker-menu')
    await expect(menu).toBeVisible({ timeout: 30_000 })
    // Assert on real entries, not on the placeholder being gone: an error item
    // also clears the placeholder, which is how this spec first passed falsely.
    await expect(menu.getByTestId('pi-model-error')).toHaveCount(0, { timeout: 60_000 })
    const options = menu.getByRole('menuitem')
    await expect(options.first()).toBeEnabled({ timeout: 60_000 })
    expect(await options.count()).toBeGreaterThan(1)

    await options.first().click()
    await expect(trigger).not.toContainText('No model', { timeout: 30_000 })
  })
})
