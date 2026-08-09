/**
 * Manual verification spec for the `pi` (prime-agent) terminal-panel spike.
 * Not part of the default suite — run explicitly:
 *   npx playwright test tests/e2e/pi-agent-spike.spec.ts --config tests/playwright.config.ts --project=electron-headful
 *
 * Drives the exact user path: click "+" → "pi (spike)" → real xterm renders
 * the pi TUI → type "2+2" → real model answer appears → close tab → verify
 * no orphaned node.exe process remains.
 */
import { execSync } from 'node:child_process'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady, waitForActiveWorktree, getActiveTabId } from './helpers/store'
import {
  focusActiveTerminalInput,
  getTerminalContent,
  waitForActivePanePtyId,
  waitForTerminalOutput
} from './helpers/terminal'

const SORTABLE_TAB = '[data-testid="sortable-tab"]'

function listPiProcessIds(): number[] {
  const out = execSync(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \'*prime-agent*cli.js*\' -and $_.CommandLine -notlike \'*daemon*\' } | Select-Object -ExpandProperty ProcessId"',
    { encoding: 'utf8' }
  )
  return out
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
}

test('pi (spike) launches, answers a real prompt, resizes, and leaves no orphan on close', async ({
  orcaPage
}) => {
  test.setTimeout(300_000)
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)

  const before = listPiProcessIds()
  expect(before, 'no pi process should be running before the test').toEqual([])

  // 1. Open the "+" menu and launch pi (spike) — same DOM path a user takes.
  await orcaPage.getByRole('button', { name: 'New tab' }).click({ force: true })
  const piMenuItem = orcaPage.getByRole('menuitem', { name: /pi \(spike\)/i }).first()
  await piMenuItem.click({ force: true })
  await expect(piMenuItem).toBeHidden({ timeout: 3_000 })

  // 2. A PTY must actually spawn for the new tab. Generous timeout: this is
  // the underlying shell PTY connecting, before pi is even typed in.
  const ptyId = await waitForActivePanePtyId(orcaPage, 60_000)
  expect(ptyId).toBeTruthy()

  // 3. The pi TUI must render real content into the xterm pane (not just the
  // two win32-input-mode escape sequences node-pty writes on spawn).
  for (let i = 0; i < 18; i++) {
    await orcaPage.waitForTimeout(5_000)
    const snapshot = await getTerminalContent(orcaPage, 300)
    console.log(`[pi-spike] t=${(i + 1) * 5}s len=${snapshot.length}`, JSON.stringify(snapshot))
  }
  await expect
    .poll(async () => (await getTerminalContent(orcaPage, 8_000)).length, {
      timeout: 5_000,
      message: 'pi TUI never rendered visible content into the xterm pane'
    })
    .toBeGreaterThan(40)
  const rendered = await getTerminalContent(orcaPage, 8_000)
  await orcaPage.screenshot({
    path: 'C:/Users/israe/AppData/Local/Temp/claude/C--Dev2026/a8dce6cf-a611-43ea-af80-5438fb9084fc/scratchpad/pi-01-rendered.png'
  })
  console.log('[pi-spike] rendered terminal content:', JSON.stringify(rendered.slice(0, 500)))

  // 4. Typing reaches the agent and a real model answer comes back.
  await focusActiveTerminalInput(orcaPage)
  await orcaPage.keyboard.type('2+2', { delay: 30 })
  await orcaPage.keyboard.press('Enter')
  await waitForTerminalOutput(orcaPage, '4', 45_000, 8_000)
  await orcaPage.screenshot({ path: 'C:/Users/israe/AppData/Local/Temp/claude/C--Dev2026/a8dce6cf-a611-43ea-af80-5438fb9084fc/scratchpad/pi-02-answered.png' })

  // 5. Resize the window; the pane must reflow (addon-fit).
  const before2 = await orcaPage.evaluate(() => ({
    w: window.innerWidth,
    h: window.innerHeight
  }))
  await orcaPage.setViewportSize({ width: before2.w - 220, height: before2.h - 120 })
  await orcaPage.waitForTimeout(500)
  await orcaPage.screenshot({ path: 'C:/Users/israe/AppData/Local/Temp/claude/C--Dev2026/a8dce6cf-a611-43ea-af80-5438fb9084fc/scratchpad/pi-03-resized.png' })

  // 6. Confirm the OS process is really alive before we close it.
  const running = listPiProcessIds()
  expect(running.length, 'expected the pi CLI process to be running').toBeGreaterThan(0)

  // 7. Close the tab via the real UI control (the actual user path), then
  // verify both the DOM (tab gone) and the OS (no orphaned process).
  const activeTabId = await getActiveTabId(orcaPage)
  expect(activeTabId).not.toBeNull()
  const activeTabLocator = orcaPage.locator(`${SORTABLE_TAB}[data-tab-id="${activeTabId}"]`).first()
  await activeTabLocator.hover()
  await activeTabLocator.getByRole('button', { name: /^Close tab /i }).click()
  await expect(activeTabLocator, 'closing the tab did not remove it from the DOM').toBeHidden({
    timeout: 5_000
  })

  await expect
    .poll(() => listPiProcessIds().length, {
      timeout: 20_000,
      message: 'pi CLI process survived tab close — orphaned'
    })
    .toBe(0)
})
