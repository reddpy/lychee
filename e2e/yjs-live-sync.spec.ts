import path from 'path';
import fs from 'fs';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { test, expect, launchLychee, firstWindowReady } from './electron-app';
import { joinNoteAsPeer } from '../src/mcp/bridge-peer';
import { editNoteLive } from '../src/mcp/live-edit';
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

test.describe('Yjs cross-process peer (socket bridge)', () => {
  test('an external process edits over the socket and the app reflects it', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    await createNote(window, 'Socket Doc');
    const docId = await noteItem(window, 'Socket Doc').getAttribute('data-note-id');
    await expect
      .poll(() =>
        window.evaluate(
          (id) => Boolean((window as any).__lycheeNoteSync?.isReady(id)),
          docId as string,
        ),
      )
      .toBe(true);

    const socketPath = path.join(testDir, 'userdata', 'lychee-sync.sock');
    await expect.poll(() => fs.existsSync(socketPath), { timeout: 10_000 }).toBe(true);

    const peer = await joinNoteAsPeer(socketPath, docId as string, {
      settleMs: 300,
      name: 'Playwright Peer',
    });
    expect(peer).not.toBeNull();
    if (!peer) return;

    peer.editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('FROM SOCKET PEER')));
      },
      { discrete: true },
    );
    peer.publish();

    await expect(window.locator('main:visible .ContentEditable__root')).toContainText(
      'FROM SOCKET PEER',
      { timeout: 10_000 },
    );
    await waitForContent(vaultDir, 'Socket Doc.md', 'FROM SOCKET PEER');

    // Presence: the peer's awareness (name) reached the app.
    await expect
      .poll(
        () =>
          window.evaluate(
            (id) => {
              const states = (window as any).__lycheeNoteSync?.awareness(id) as
                | Array<{ state?: { name?: string } }>
                | null;
              return states ? states.some((s) => s.state?.name === 'Playwright Peer') : false;
            },
            docId as string,
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    peer.close();
  });

  test('the peer\u2019s cursor and name render in the open editor', async ({ window, testDir }) => {
    await createNote(window, 'Cursor Doc');
    const docId = await noteItem(window, 'Cursor Doc').getAttribute('data-note-id');
    await expect
      .poll(() =>
        window.evaluate(
          (id) => Boolean((window as any).__lycheeNoteSync?.isReady(id)),
          docId as string,
        ),
      )
      .toBe(true);

    const socketPath = path.join(testDir, 'userdata', 'lychee-sync.sock');
    await expect.poll(() => fs.existsSync(socketPath), { timeout: 10_000 }).toBe(true);

    const peer = await joinNoteAsPeer(socketPath, docId as string, {
      settleMs: 300,
      name: 'Cursor Agent',
      color: '#7c3aed',
    });
    expect(peer).not.toBeNull();
    if (!peer) return;

    // The agent writes something, which also places its cursor.
    peer.editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('cursor target')));
      },
      { discrete: true },
    );
    peer.publish();

    // The agent's presence renders in the cursor overlay inside the editor.
    await expect(window.locator('[data-yjs-cursors]')).toContainText('Cursor Agent', {
      timeout: 10_000,
    });
    peer.close();
  });

  test('the agent caret auto-hides after the agent goes idle', async ({ window, testDir }) => {
    await createNote(window, 'Idle Cursor Doc');
    const docId = await noteItem(window, 'Idle Cursor Doc').getAttribute('data-note-id');
    await expect
      .poll(() =>
        window.evaluate(
          (id) => Boolean((window as any).__lycheeNoteSync?.isReady(id)),
          docId as string,
        ),
      )
      .toBe(true);

    const socketPath = path.join(testDir, 'userdata', 'lychee-sync.sock');
    await expect.poll(() => fs.existsSync(socketPath), { timeout: 10_000 }).toBe(true);

    const peer = await joinNoteAsPeer(socketPath, docId as string, {
      settleMs: 300,
      name: 'Idle Agent',
      cursorIdleMs: 700,
    });
    expect(peer).not.toBeNull();
    if (!peer) return;

    peer.editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('idle target')));
      },
      { discrete: true },
    );
    peer.publish();

    const overlay = window.locator('[data-yjs-cursors]');
    await expect(overlay).toContainText('Idle Agent', { timeout: 5_000 });
    // After the idle debounce the caret is withdrawn (the overlay empties).
    await expect(overlay).not.toContainText('Idle Agent', { timeout: 5_000 });

    peer.close();
  });
});

test.describe('MCP live tool path', () => {
  test('editNoteLive applies a tool-style edit to the open note', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    await createNote(window, 'Live Tool Doc');
    const docId = await noteItem(window, 'Live Tool Doc').getAttribute('data-note-id');
    await expect
      .poll(() =>
        window.evaluate(
          (id) => Boolean((window as any).__lycheeNoteSync?.isReady(id)),
          docId as string,
        ),
      )
      .toBe(true);

    const socket = path.join(testDir, 'userdata', 'lychee-sync.sock');
    await expect.poll(() => fs.existsSync(socket), { timeout: 10_000 }).toBe(true);

    const result = await editNoteLive({
      vault: vaultDir,
      socket,
      idOrPath: docId as string,
      transform: (current) => `${current.replace(/\s+$/, '')}\n\nFROM TOOL\n`,
    });
    expect(result).not.toBeNull();

    await expect(window.locator('main:visible .ContentEditable__root')).toContainText('FROM TOOL', {
      timeout: 10_000,
    });
    await waitForContent(vaultDir, 'Live Tool Doc.md', 'FROM TOOL');
  });

  test('live append still lands after the user clears the body', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    await createNote(window, 'Cleared Doc');
    const docId = await noteItem(window, 'Cleared Doc').getAttribute('data-note-id');
    await expect
      .poll(() =>
        window.evaluate(
          (id) => Boolean((window as any).__lycheeNoteSync?.isReady(id)),
          docId as string,
        ),
      )
      .toBe(true);

    // Type content, then select-all + delete (leaving the title).
    const body = window.locator('main:visible .ContentEditable__root');
    await body.click();
    await window.keyboard.type('content to remove');
    await expect(body).toContainText('content to remove');
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(900);
    await expect(body).not.toContainText('content to remove');

    const socket = path.join(testDir, 'userdata', 'lychee-sync.sock');
    await expect.poll(() => fs.existsSync(socket), { timeout: 10_000 }).toBe(true);

    const result = await editNoteLive({
      vault: vaultDir,
      socket,
      idOrPath: docId as string,
      transform: (current) => `${current.replace(/\s+$/, '')}\n\nAFTER CLEAR\n`,
    });
    expect(result).not.toBeNull();

    await expect(body).toContainText('AFTER CLEAR', { timeout: 10_000 });
  });

  test('a live agent edit is highlighted, and clicking dismisses it', async ({
    window,
    testDir,
  }) => {
    await createNote(window, 'Highlight Doc');
    const docId = await noteItem(window, 'Highlight Doc').getAttribute('data-note-id');
    await expect
      .poll(() =>
        window.evaluate(
          (id) => Boolean((window as any).__lycheeNoteSync?.isReady(id)),
          docId as string,
        ),
      )
      .toBe(true);

    const socket = path.join(testDir, 'userdata', 'lychee-sync.sock');
    await expect.poll(() => fs.existsSync(socket), { timeout: 10_000 }).toBe(true);

    const peer = await joinNoteAsPeer(socket, docId as string, {
      settleMs: 300,
      name: 'Highlighter',
    });
    expect(peer).not.toBeNull();
    if (!peer) return;

    peer.editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('HIGHLIGHT ME')));
      },
      { discrete: true },
    );
    peer.publish();

    const body = window.locator('main:visible .ContentEditable__root');
    const highlighted = window.locator('main:visible .lychee-agent-added');
    await expect(highlighted).toHaveCount(1, { timeout: 10_000 });
    await expect(highlighted).toContainText('HIGHLIGHT ME');

    // Clicking the editor dismisses the highlight.
    await body.click();
    await expect(window.locator('main:visible .lychee-agent-added')).toHaveCount(0, {
      timeout: 5_000,
    });

    peer.close();
  });

  test('editNoteLive (full-replace edit) highlights only the changed block', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    await createNote(window, 'Tool Highlight Doc');
    const docId = await noteItem(window, 'Tool Highlight Doc').getAttribute('data-note-id');
    await expect
      .poll(() =>
        window.evaluate(
          (id) => Boolean((window as any).__lycheeNoteSync?.isReady(id)),
          docId as string,
        ),
      )
      .toBe(true);

    // Seed existing content so the note has blocks that must NOT be highlighted.
    const body = window.locator('main:visible .ContentEditable__root');
    await body.click();
    await window.keyboard.type('existing line');
    await window.waitForTimeout(800);

    const socket = path.join(testDir, 'userdata', 'lychee-sync.sock');
    await expect.poll(() => fs.existsSync(socket), { timeout: 10_000 }).toBe(true);

    const result = await editNoteLive({
      vault: vaultDir,
      socket,
      idOrPath: docId as string,
      transform: (current) => `${current.replace(/\s+$/, '')}\n\nTOOL ADDED\n`,
    });
    expect(result).not.toBeNull();

    const highlighted = window.locator('main:visible .lychee-agent-added');
    await expect(highlighted).toHaveCount(1, { timeout: 10_000 });
    await expect(highlighted).toContainText('TOOL ADDED');
    await expect(highlighted).not.toContainText('existing line');
  });
});
