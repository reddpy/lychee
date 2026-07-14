import {
  test as base,
  _electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  expect,
  findPackagedBinary,
  hasDevBuild,
  PROJECT_ROOT,
  test,
} from './electron-app';

const SIDEBAR_SETTING_KEY = 'ui.sidebar.layout';
const DEFAULT_WIDTH = 288;
const MIN_WIDTH = 224;
const MAX_WIDTH = 480;

function provider(page: Page) {
  return page.locator('[data-sidebar-provider="true"]');
}

function sidebar(page: Page) {
  return page.locator('aside[data-sidebar="app"]');
}

function rail(page: Page) {
  return page.locator('[aria-label="Resize sidebar"]');
}

async function renderedWidth(page: Page): Promise<number> {
  return provider(page).evaluate((element) =>
    Number.parseFloat(
      getComputedStyle(element).getPropertyValue('--sidebar-width'),
    ),
  );
}

/** Read the canonical persisted value through the SQLite settings repository. */
async function sidebarLayoutFromDb(
  page: Page,
): Promise<{ version: number; open: boolean; width: number } | null> {
  const raw = await page.evaluate(async (key) => {
    const result = await (window as any).lychee.invoke('settings.get', { key });
    return result.value as string | null;
  }, SIDEBAR_SETTING_KEY);
  return raw ? JSON.parse(raw) : null;
}

async function rawSidebarLayoutFromDb(page: Page): Promise<string | null> {
  return page.evaluate(async (key) => {
    const result = await (window as any).lychee.invoke('settings.get', { key });
    return result.value as string | null;
  }, SIDEBAR_SETTING_KEY);
}

async function dragRailTo(page: Page, targetX: number): Promise<void> {
  const box = await rail(page).boundingBox();
  if (!box) throw new Error('Resize rail has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetX, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
}

async function revealFloatingSidebar(page: Page): Promise<void> {
  await page.locator('[aria-label="Toggle sidebar"]').click();
  await expect(sidebar(page)).toHaveAttribute('data-state', 'collapsed');
  await page.mouse.move(500, 120);
  await page.mouse.move(1, 120);
  await expect(sidebar(page)).toHaveClass(/translate-x-0/);
}

test.describe('Sidebar resize', () => {
  test('covers fixed, collapsed-hidden, floating, and fixed-again transitions', async ({
    window,
  }) => {
    await expect(sidebar(window)).toHaveAttribute('data-state', 'expanded');
    await expect(sidebar(window)).toHaveClass(/relative/);
    await expect.poll(() => sidebarLayoutFromDb(window)).toEqual({
      version: 1,
      open: true,
      width: DEFAULT_WIDTH,
    });

    // Fixed → collapsed. The trigger intentionally reveals the floating panel
    // first so the transition does not feel like the sidebar disappeared.
    await window.locator('[aria-label="Toggle sidebar"]').click();
    await expect(sidebar(window)).toHaveAttribute('data-state', 'collapsed');
    await expect(sidebar(window)).toHaveClass(/translate-x-0/);
    await expect.poll(() => sidebarLayoutFromDb(window)).toEqual({
      version: 1,
      open: false,
      width: DEFAULT_WIDTH,
    });

    // Floating → hidden. Hover state is ephemeral and must never mutate the
    // persisted collapsed state in SQLite.
    await window.mouse.move(600, 160);
    await expect(sidebar(window)).toHaveClass(/-translate-x-full/);
    await expect.poll(() => sidebarLayoutFromDb(window)).toEqual({
      version: 1,
      open: false,
      width: DEFAULT_WIDTH,
    });

    // Hidden → floating via the edge affordance; SQLite remains collapsed.
    await window.mouse.move(1, 160);
    await expect(sidebar(window)).toHaveClass(/translate-x-0/);
    await expect.poll(() => sidebarLayoutFromDb(window)).toEqual({
      version: 1,
      open: false,
      width: DEFAULT_WIDTH,
    });

    // Floating → fixed by clicking the rail.
    await rail(window).click();
    await expect(sidebar(window)).toHaveAttribute('data-state', 'expanded');
    await expect(sidebar(window)).toHaveClass(/relative/);
    await expect.poll(() => sidebarLayoutFromDb(window)).toEqual({
      version: 1,
      open: true,
      width: DEFAULT_WIDTH,
    });
  });

  test('dragging the static rail resizes without collapsing and persists metadata', async ({
    window,
  }) => {
    await expect.poll(() => renderedWidth(window)).toBe(DEFAULT_WIDTH);

    await dragRailTo(window, 360);

    await expect.poll(() => renderedWidth(window)).toBe(360);
    await expect(sidebar(window)).toHaveAttribute('data-state', 'expanded');
    await expect.poll(() => sidebarLayoutFromDb(window)).toEqual({
      version: 1,
      open: true,
      width: 360,
    });
  });

  test('dragging the floating rail resizes while keeping the sidebar collapsed', async ({
    window,
  }) => {
    await revealFloatingSidebar(window);

    await dragRailTo(window, 352);

    await expect.poll(() => renderedWidth(window)).toBe(352);
    await expect(sidebar(window)).toHaveAttribute('data-state', 'collapsed');
    await expect.poll(() => sidebarLayoutFromDb(window)).toEqual({
      version: 1,
      open: false,
      width: 352,
    });
  });

  test('floating visual guide spans the content viewport but its hit target does not', async ({
    window,
  }) => {
    await revealFloatingSidebar(window);
    await expect.poll(() => sidebarLayoutFromDb(window)).toEqual({
      version: 1,
      open: false,
      width: DEFAULT_WIDTH,
    });
    const railBox = await rail(window).boundingBox();
    const guideBox = await rail(window).locator('span').boundingBox();
    const contentBox = await sidebar(window).evaluate((element) => {
      const rect = element.parentElement!.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    });

    expect(railBox).not.toBeNull();
    expect(guideBox).not.toBeNull();
    expect(guideBox!.y).toBeCloseTo(contentBox.top, 0);
    expect(guideBox!.y + guideBox!.height).toBeCloseTo(contentBox.bottom, 0);
    expect(railBox!.height).toBeLessThan(guideBox!.height);
    await expect(rail(window).locator('span')).toHaveCSS('pointer-events', 'none');
  });

  test('extreme drags clamp to the supported minimum and maximum widths', async ({
    window,
  }) => {
    await dragRailTo(window, 20);
    await expect.poll(() => renderedWidth(window)).toBe(MIN_WIDTH);
    await expect(sidebar(window)).toHaveAttribute('data-state', 'expanded');

    await dragRailTo(window, 760);
    await expect.poll(() => renderedWidth(window)).toBe(MAX_WIDTH);
    await expect(sidebar(window)).toHaveAttribute('data-state', 'expanded');
    await expect.poll(() => sidebarLayoutFromDb(window)).toEqual({
      version: 1,
      open: true,
      width: MAX_WIDTH,
    });
  });

  test('one-pixel pointer jitter remains a click and does not alter width', async ({
    window,
  }) => {
    const box = await rail(window).boundingBox();
    if (!box) throw new Error('Resize rail has no bounding box');
    const startX = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    await window.mouse.move(startX, y);
    await window.mouse.down();
    await window.mouse.move(startX + 1, y);
    await window.mouse.up();

    await expect.poll(() => renderedWidth(window)).toBe(DEFAULT_WIDTH);
    await expect(sidebar(window)).toHaveAttribute('data-state', 'collapsed');
    await expect.poll(() => sidebarLayoutFromDb(window)).toEqual({
      version: 1,
      open: false,
      width: DEFAULT_WIDTH,
    });
  });

  test('keyboard resizing honors bounds and persists the final value', async ({
    window,
  }) => {
    await rail(window).focus();
    await window.keyboard.press('End');
    await expect.poll(() => renderedWidth(window)).toBe(MAX_WIDTH);
    await window.keyboard.press('ArrowRight');
    await expect.poll(() => renderedWidth(window)).toBe(MAX_WIDTH);
    await window.keyboard.press('Home');
    await expect.poll(() => renderedWidth(window)).toBe(MIN_WIDTH);
    await window.keyboard.press('ArrowLeft');
    await expect.poll(() => renderedWidth(window)).toBe(MIN_WIDTH);
    await expect.poll(() => sidebarLayoutFromDb(window)).toEqual({
      version: 1,
      open: true,
      width: MIN_WIDTH,
    });
  });
});

function buildLaunchOpts(tmpDir: string): Parameters<typeof _electron.launch>[0] {
  const packagedBinary = findPackagedBinary();
  const opts: Parameters<typeof _electron.launch>[0] = {
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: process.env.CI ? 60_000 : 30_000,
  };
  const extraArgs = process.env.CI ? ['--no-sandbox'] : [];
  if (packagedBinary) {
    opts.executablePath = packagedBinary;
    opts.args = [`--user-data-dir=${tmpDir}`, ...extraArgs];
  } else if (hasDevBuild()) {
    opts.args = [PROJECT_ROOT, `--user-data-dir=${tmpDir}`, ...extraArgs];
  } else {
    throw new Error('No Electron build found.');
  }
  return opts;
}

async function launchAndGetWindow(
  tmpDir: string,
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await _electron.launch(buildLaunchOpts(tmpDir));
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
  return { app, window };
}

base.describe('Sidebar resize persistence', () => {
  base('width and collapsed state survive a full app restart', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-sidebar-layout-'));
    let app: ElectronApplication | undefined;
    try {
      let launched = await launchAndGetWindow(tmpDir);
      app = launched.app;
      await dragRailTo(launched.window, 368);
      await launched.window.locator('[aria-label="Toggle sidebar"]').click();
      await expect.poll(() => sidebarLayoutFromDb(launched.window)).toEqual({
        version: 1,
        open: false,
        width: 368,
      });
      await app.close();
      app = undefined;

      launched = await launchAndGetWindow(tmpDir);
      app = launched.app;
      await expect(launched.window.locator('aside[data-sidebar="app"]')).toHaveAttribute(
        'data-state',
        'collapsed',
      );
      await expect.poll(() => renderedWidth(launched.window)).toBe(368);
      await expect.poll(() => sidebarLayoutFromDb(launched.window)).toEqual({
        version: 1,
        open: false,
        width: 368,
      });
    } finally {
      await app?.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  base('malformed and out-of-range stored metadata fall back safely on restart', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-sidebar-invalid-'));
    let app: ElectronApplication | undefined;
    try {
      let launched = await launchAndGetWindow(tmpDir);
      app = launched.app;
      await launched.window.evaluate(async ({ key }) => {
        await (window as any).lychee.invoke('settings.set', {
          key,
          value: '{not valid json',
        });
      }, { key: SIDEBAR_SETTING_KEY });
      await app.close();
      app = undefined;

      launched = await launchAndGetWindow(tmpDir);
      app = launched.app;
      await expect(launched.window.locator('aside[data-sidebar="app"]')).toHaveAttribute(
        'data-state',
        'expanded',
      );
      await expect.poll(() => renderedWidth(launched.window)).toBe(DEFAULT_WIDTH);
      await expect.poll(() => sidebarLayoutFromDb(launched.window)).toEqual({
        version: 1,
        open: true,
        width: DEFAULT_WIDTH,
      });
      await expect.poll(() => rawSidebarLayoutFromDb(launched.window)).toBe(
        JSON.stringify({ version: 1, open: true, width: DEFAULT_WIDTH }),
      );

      await launched.window.evaluate(async ({ key }) => {
        await (window as any).lychee.invoke('settings.set', {
          key,
          value: JSON.stringify({ version: 1, open: false, width: 99_999 }),
        });
      }, { key: SIDEBAR_SETTING_KEY });
      await app.close();
      app = undefined;

      launched = await launchAndGetWindow(tmpDir);
      app = launched.app;
      await expect(launched.window.locator('aside[data-sidebar="app"]')).toHaveAttribute(
        'data-state',
        'collapsed',
      );
      await expect.poll(() => renderedWidth(launched.window)).toBe(MAX_WIDTH);
      await expect.poll(() => sidebarLayoutFromDb(launched.window)).toEqual({
        version: 1,
        open: false,
        width: MAX_WIDTH,
      });
      await expect.poll(() => rawSidebarLayoutFromDb(launched.window)).toBe(
        JSON.stringify({ version: 1, open: false, width: MAX_WIDTH }),
      );
    } finally {
      await app?.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
