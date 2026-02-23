import {
  test as base,
  _electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PRODUCT_NAME = 'lychee';

function findPackagedBinary(): string | null {
  const platform = os.platform();
  const arch = os.arch();
  const outDir = path.join(PROJECT_ROOT, 'out');

  let binary: string;

  if (platform === 'darwin') {
    binary = path.join(
      outDir,
      `${PRODUCT_NAME}-darwin-${arch}`,
      `${PRODUCT_NAME}.app`,
      'Contents',
      'MacOS',
      PRODUCT_NAME,
    );
  } else if (platform === 'win32') {
    binary = path.join(
      outDir,
      `${PRODUCT_NAME}-win32-${arch}`,
      `${PRODUCT_NAME}.exe`,
    );
  } else {
    binary = path.join(
      outDir,
      `${PRODUCT_NAME}-linux-${arch}`,
      PRODUCT_NAME,
    );
  }

  return fs.existsSync(binary) ? binary : null;
}

function hasDevBuild(): boolean {
  return fs.existsSync(
    path.join(PROJECT_ROOT, '.webpack', 'main', 'index.js'),
  );
}

/**
 * Find the main app window (not DevTools). Waits up to 10s for it to appear.
 */
async function getMainWindow(app: ElectronApplication): Promise<Page> {
  // Close DevTools via the main process
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools();
      }
    }
  });

  // After closing DevTools, find the window whose URL isn't devtools://
  for (const page of app.windows()) {
    const url = page.url();
    if (!url.startsWith('devtools://')) {
      return page;
    }
  }

  // If no windows yet, wait for one
  return app.firstWindow();
}

type Fixtures = {
  electronApp: ElectronApplication;
  window: Page;
};

export const test = base.extend<Fixtures>({
  electronApp: async ({}, use) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-e2e-'));

    const packagedBinary = findPackagedBinary();
    const devBuild = hasDevBuild();

    if (!packagedBinary && !devBuild) {
      throw new Error(
        'No Electron build found. Run one of:\n' +
        '  pnpm run package   — packaged build (recommended for tests)\n' +
        '  pnpm start         — dev build (requires dev server running)',
      );
    }

    const launchOpts: Parameters<typeof _electron.launch>[0] = {
      env: { ...process.env, NODE_ENV: 'test', LYCHEE_E2E: '1' },
      timeout: 30_000,
    };

    if (packagedBinary) {
      launchOpts.executablePath = packagedBinary;
      launchOpts.args = [`--user-data-dir=${tmpDir}`];
    } else {
      launchOpts.args = [PROJECT_ROOT, `--user-data-dir=${tmpDir}`];
    }

    const app = await _electron.launch(launchOpts);

    await use(app);
    await app.close();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  },

  window: async ({ electronApp }, use) => {
    const window = await getMainWindow(electronApp);
    await window.waitForLoadState('domcontentloaded');
    // Wait for React to hydrate — the sidebar aside element
    await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
    await use(window);
  },
});

export { expect } from '@playwright/test';

// ── IPC helpers for backend verification ────────────────────────────

type DocumentRow = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  parentId: string | null;
  emoji: string | null;
  deletedAt: string | null;
  sortOrder: number;
};

/** Query all active (non-trashed) documents from the database via IPC. */
export async function listDocumentsFromDb(page: Page): Promise<DocumentRow[]> {
  const result = await page.evaluate(() =>
    (window as any).lychee.invoke('documents.list', { limit: 500, offset: 0 }),
  );
  return result.documents;
}

/** Query all trashed documents from the database via IPC. */
export async function listTrashedFromDb(page: Page): Promise<DocumentRow[]> {
  const result = await page.evaluate(() =>
    (window as any).lychee.invoke('documents.listTrashed', { limit: 500, offset: 0 }),
  );
  return result.documents;
}

/** Fetch a single document by ID from the database via IPC. */
export async function getDocumentFromDb(page: Page, id: string): Promise<DocumentRow | null> {
  const result = await page.evaluate(
    (docId) => (window as any).lychee.invoke('documents.get', { id: docId }),
    id,
  );
  return result.document;
}

/** Get the most recently updated document (for tests that just edited the current note). */
export async function getLatestDocumentFromDb(page: Page): Promise<DocumentRow | null> {
  const docs = await listDocumentsFromDb(page);
  if (docs.length === 0) return null;
  const sorted = [...docs].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  return sorted[0];
}

// ── Reusable launch helpers for persistence tests ───────────────────

export { findPackagedBinary, hasDevBuild, getMainWindow, PROJECT_ROOT };
