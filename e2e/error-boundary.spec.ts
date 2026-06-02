import { test, expect } from './electron-app';
import type { Page } from '@playwright/test';

// The E2E crash probe (src/components/error-boundary.tsx) is inert unless this
// is an E2E build (__LYCHEE_E2E__) — in production it's stripped entirely. A
// test arms it by setting window.__lycheeE2ECrash = { scope, mode }.
type CrashMode = 'error' | 'null' | 'string' | 'long';

// Arm a crash for the NEXT load (persists across reloads), then reload.
async function armAndReload(
  window: Page,
  scope: 'app' | 'editor',
  mode: CrashMode = 'error',
) {
  await window.addInitScript(
    (spec) => {
      (globalThis as { __lycheeE2ECrash?: unknown }).__lycheeE2ECrash = spec;
    },
    { scope, mode },
  );
  await window.reload();
}

// Disarm at runtime without a reload (so a subsequent re-render recovers).
async function disarm(window: Page) {
  await window.evaluate(() => {
    delete (globalThis as { __lycheeE2ECrash?: unknown }).__lycheeE2ECrash;
  });
}

const FALLBACK = 'Something went wrong';

test.describe('ErrorBoundary (wiring + recovery)', () => {
  test('top-level boundary catches a crash and Reload recovers', async ({
    window,
  }) => {
    await expect(window.locator('aside[data-state]')).toBeVisible();

    await armAndReload(window, 'app');
    await expect(window.getByText(FALLBACK)).toBeVisible({ timeout: 15_000 });
    // Whole-window takeover — proves <App> is wrapped by the app boundary.
    await expect(window.locator('aside[data-state]')).toHaveCount(0);

    // Disarm on the next load, click the real Reload button.
    await window.addInitScript(() => {
      delete (globalThis as { __lycheeE2ECrash?: unknown }).__lycheeE2ECrash;
    });
    await window.getByRole('button', { name: 'Reload' }).click();
    await expect(window.locator('aside[data-state]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(window.getByText(FALLBACK)).toHaveCount(0);
  });

  test('editor boundary localizes the crash and the rest of the app stays interactive', async ({
    window,
  }) => {
    await armAndReload(window, 'editor');
    await expect(window.getByText(FALLBACK)).toBeVisible({ timeout: 15_000 });

    // Sidebar survives...
    await expect(window.locator('aside[data-state="expanded"]')).toBeVisible();

    // ...and is still INTERACTIVE, not just painted: opening Settings (rendered
    // outside the editor boundary) works while the editor pane shows the fallback.
    await window
      .locator('aside[data-state="expanded"]')
      .getByText('Settings')
      .click();
    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Settings');
    // Fallback is still confined to the editor pane behind the dialog.
    await expect(window.getByText(FALLBACK)).toBeVisible();
  });
});

test.describe('ErrorBoundary (edge cases)', () => {
  // Regression for the headline bug: a falsy throw must NOT blank the window.
  test('a falsy throw (throw null) still shows the fallback, not a blank window', async ({
    window,
  }) => {
    await armAndReload(window, 'app', 'null');
    await expect(window.getByText(FALLBACK)).toBeVisible({ timeout: 15_000 });
    // The blank-screen failure mode would leave #root empty.
    const rootHtml = await window.locator('#root').innerHTML();
    expect(rootHtml.trim().length).toBeGreaterThan(0);
  });

  test('a thrown string is surfaced as the error message', async ({
    window,
  }) => {
    await armAndReload(window, 'app', 'string');
    await expect(window.getByText(FALLBACK)).toBeVisible({ timeout: 15_000 });
    await expect(window.getByText('E2E string-mode failure')).toBeVisible();
  });

  // Layout edge case — only meaningfully testable with a real layout engine.
  test('an oversized error message keeps the Reload button inside the viewport', async ({
    window,
  }) => {
    await armAndReload(window, 'app', 'long');
    const reload = window.getByRole('button', { name: 'Reload' });
    await expect(reload).toBeVisible({ timeout: 15_000 });

    const box = await reload.boundingBox();
    const vh = await window.evaluate(() => globalThis.innerHeight);
    expect(box).not.toBeNull();
    // Button must be fully within the viewport (not pushed off-screen by the
    // message), so a user can actually click it.
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(vh);
    // And it must be genuinely clickable (Playwright actionability check).
    await expect(reload).toBeEnabled();
    await reload.click({ trial: true });
  });
});

test.describe('ErrorBoundary (recovery semantics)', () => {
  test('an editor crash recovers via resetKeys when navigating to a new note', async ({
    window,
  }) => {
    await armAndReload(window, 'editor');
    await expect(window.getByText(FALLBACK)).toBeVisible({ timeout: 15_000 });

    // Stop the crash, then navigate: creating a note changes selectedId, which
    // is the editor boundary's resetKey → it clears and re-renders the editor.
    await disarm(window);
    await window.locator('[aria-label="New note"]').click();

    await expect(window.getByText(FALLBACK)).toHaveCount(0, { timeout: 15_000 });
    // The editor is actually back: the new note is selected in the sidebar.
    await expect(window.locator('aside[data-state]')).toBeVisible();
  });

  test('a deterministic crash is NOT recovered by Reload (documents the limit)', async ({
    window,
  }) => {
    // Persistently armed: addInitScript re-applies on every load, like a crash
    // rooted in corrupt persisted state.
    await armAndReload(window, 'app');
    await expect(window.getByText(FALLBACK)).toBeVisible({ timeout: 15_000 });

    await window.getByRole('button', { name: 'Reload' }).click();
    // Still crashed after Reload — Reload alone cannot escape a deterministic crash.
    await expect(window.getByText(FALLBACK)).toBeVisible({ timeout: 15_000 });
    await expect(window.locator('aside[data-state]')).toHaveCount(0);
  });

  test('repeated crash → recover cycles leave no stuck state', async ({
    window,
  }) => {
    for (let i = 0; i < 3; i++) {
      await armAndReload(window, 'editor');
      await expect(window.getByText(FALLBACK)).toBeVisible({ timeout: 15_000 });

      await disarm(window);
      await window.locator('[aria-label="New note"]').click();
      await expect(window.getByText(FALLBACK)).toHaveCount(0, {
        timeout: 15_000,
      });
    }
  });
});

test.describe('ErrorBoundary (scope — what it must NOT catch)', () => {
  test('an async throw does not trip the boundary; the app stays up', async ({
    window,
  }) => {
    await expect(window.locator('aside[data-state]')).toBeVisible();

    // Capture real uncaught errors so this isn't a vacuous "no fallback" check:
    // we prove the async error ACTUALLY fired and escaped React entirely.
    const pageErrors: string[] = [];
    window.on('pageerror', (e) => pageErrors.push(e.message));

    await window.evaluate(() => {
      setTimeout(() => {
        throw new Error('async uncaught — outside React render');
      }, 0);
    });
    await expect
      .poll(() => pageErrors.some((m) => m.includes('async uncaught')), {
        timeout: 5000,
      })
      .toBe(true);

    // The error fired AND was not caught by React: no fallback, app still up.
    await expect(window.getByText(FALLBACK)).toHaveCount(0);
    await expect(window.locator('aside[data-state]')).toBeVisible();
  });
});
