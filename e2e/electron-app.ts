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
const packageJson = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'),
) as { name?: string; productName?: string };

function dedupeNames(...names: Array<string | undefined>): string[] {
  return names.filter((name, index, all): name is string =>
    typeof name === 'string' && name.length > 0 && all.indexOf(name) === index,
  );
}

// The packaged output folder / .app bundle / .exe are named after productName,
// but forge.config.ts pins `executableName: "lychee"` on Linux builds, so the
// executable name can differ from the bundle name depending on platform (and
// older local builds pinned it everywhere). Keep the two candidate lists
// separate so the cross product finds the binary in all combinations.
const BUNDLE_NAMES = dedupeNames(packageJson.productName, packageJson.name, 'Lychee', 'lychee');
const EXECUTABLE_NAMES = dedupeNames('lychee', packageJson.name, packageJson.productName, 'Lychee');

function findPackagedBinary(): string | null {
  const platform = os.platform();
  const arch = os.arch();
  const outDir = path.join(PROJECT_ROOT, 'out');

  for (const bundleName of BUNDLE_NAMES) {
    for (const execName of EXECUTABLE_NAMES) {
      let binary: string;

      if (platform === 'darwin') {
        binary = path.join(
          outDir,
          `${bundleName}-darwin-${arch}`,
          `${bundleName}.app`,
          'Contents',
          'MacOS',
          execName,
        );
      } else if (platform === 'win32') {
        binary = path.join(
          outDir,
          `${bundleName}-win32-${arch}`,
          `${execName}.exe`,
        );
      } else {
        binary = path.join(
          outDir,
          `${bundleName}-linux-${arch}`,
          execName,
        );
      }

      if (fs.existsSync(binary)) {
        return binary;
      }
    }
  }

  return null;
}

function hasDevBuild(): boolean {
  return fs.existsSync(
    path.join(PROJECT_ROOT, '.webpack', 'main', 'index.js'),
  );
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
      // Keep E2E-only preload controls available and prevent packaged tests
      // from starting real updater/network work. Packaging with E2E=1 enables
      // the test surface; the launched Electron process needs the flag too.
      env: { ...process.env, NODE_ENV: 'test', E2E: '1' },
      timeout: process.env.CI ? 60_000 : 30_000,
    };

    // --no-sandbox is required on Linux CI (GitHub Actions)
    const extraArgs =
      process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : [];

    if (packagedBinary) {
      launchOpts.executablePath = packagedBinary;
      launchOpts.args = [`--user-data-dir=${tmpDir}`, ...extraArgs];
    } else {
      launchOpts.args = [PROJECT_ROOT, `--user-data-dir=${tmpDir}`, ...extraArgs];
    }

    const app = await _electron.launch(launchOpts);

    await use(app);
    await app.close();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  },

  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
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

export { findPackagedBinary, hasDevBuild, PROJECT_ROOT };
