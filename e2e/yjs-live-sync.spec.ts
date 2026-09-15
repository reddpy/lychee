import path from 'path';
import { test, expect, launchLychee, firstWindowReady } from './electron-app';
import { createNote, noteItem, waitForContent } from './vault-helpers';

/**
 * Yjs live sync: an external peer (agent/MCP) edits the same note's Y.Doc and
 * the change appears in the open editor immediately — the local stand-in for
 * "watch the AI edit".
 *
 * Runs only in Yjs mode (`LYCHEE_YJS=1`); the rest of the suite is unaffected.
 */
test.use({ yjsFlag: true });

test.describe('Yjs live sync — agent peer', () => {
  test('an external agent edit appears in the open editor and the markdown file', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'Live Doc');

    const docId = await noteItem(window, 'Live Doc').getAttribute('data-note-id');
    expect(docId).toBeTruthy();

    await expect
      .poll(
        () =>
          window.evaluate(
            (id) => Boolean((window as any).__lycheeNoteSync?.isReady(id)),
            docId as string,
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    await window.evaluate((id) => {
      (window as any).__lycheeNoteSync.agentEdit(id, 'AGENT LINE');
    }, docId as string);

    await expect(window.locator('main:visible .ContentEditable__root')).toContainText('AGENT LINE', {
      timeout: 10_000,
    });
    await waitForContent(vaultDir, 'Live Doc.md', 'AGENT LINE');
  });

  test('an agent edit merges with a local edit rather than replacing it', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'Merge Doc');
    const docId = await noteItem(window, 'Merge Doc').getAttribute('data-note-id');
    await expect
      .poll(() =>
        window.evaluate(
          (id) => Boolean((window as any).__lycheeNoteSync?.isReady(id)),
          docId as string,
        ),
      )
      .toBe(true);

    // User types a body paragraph.
    const body = window.locator('main:visible .ContentEditable__root');
    await body.click();
    await window.keyboard.type('local text');
    await window.waitForTimeout(600);

    // The local edit synced into the live doc.
    await expect
      .poll(() =>
        window.evaluate(
          (id) => (window as any).__lycheeNoteSync?.snapshot(id) as string | null,
          docId as string,
        ),
      )
      .toContain('local text');

    await window.evaluate((id) => {
      (window as any).__lycheeNoteSync.agentEdit(id, 'AGENT PARAGRAPH');
    }, docId as string);

    await expect(body).toContainText('local text', { timeout: 10_000 });
    await expect(body).toContainText('AGENT PARAGRAPH', { timeout: 10_000 });
    await waitForContent(vaultDir, 'Merge Doc.md', 'AGENT PARAGRAPH');
    await waitForContent(vaultDir, 'Merge Doc.md', 'local text');
  });

  test('undo reverts a local edit through the Yjs undo manager', async ({ window }) => {
    await createNote(window, 'Undo Doc');
    const docId = await noteItem(window, 'Undo Doc').getAttribute('data-note-id');
    await expect
      .poll(() =>
        window.evaluate(
          (id) => Boolean((window as any).__lycheeNoteSync?.isReady(id)),
          docId as string,
        ),
      )
      .toBe(true);

    const body = window.locator('main:visible .ContentEditable__root');
    await body.click();
    await window.keyboard.type('revert me');
    await expect(body).toContainText('revert me', { timeout: 10_000 });

    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(500);
    await expect(body).not.toContainText('revert me', { timeout: 10_000 });
  });
});

test.describe('Yjs CRDT persistence', () => {
  test('updates persist to SQLite and the note reloads after relaunch', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');

    const first = await launchLychee({ userDataDir, vaultDir, yjsFlag: true });
    const w1 = await firstWindowReady(first);
    await createNote(w1, 'Persist Doc');

    const docId = await noteItem(w1, 'Persist Doc').getAttribute('data-note-id');
    await expect
      .poll(() =>
        w1.evaluate((id) => Boolean((window as any).__lycheeNoteSync?.isReady(id)), docId as string),
      )
      .toBe(true);

    await w1.locator('main:visible .ContentEditable__root').click();
    await w1.keyboard.type('crdt body');
    await w1.waitForTimeout(900);

    // CRDT updates were appended to SQLite.
    await expect
      .poll(() =>
        w1.evaluate(async (id) => {
          const { updates } = await (window as any).lychee.invoke('crdt.load', { id });
          return updates.length as number;
        }, docId as string),
      )
      .toBeGreaterThan(0);

    await first.close();

    const second = await launchLychee({ userDataDir, vaultDir, yjsFlag: true });
    const w2 = await firstWindowReady(second);
    await expect(noteItem(w2, 'Persist Doc')).toBeVisible();
    await noteItem(w2, 'Persist Doc').click();
    await expect(w2.locator('main:visible .ContentEditable__root')).toContainText('crdt body', {
      timeout: 10_000,
    });
    await second.close();
  });
});
