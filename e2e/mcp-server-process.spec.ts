import fs from 'fs';
import path from 'path';
import { test, expect } from './electron-app';
import { connectMcp, callTool, ensureMcpBundle } from './mcp-client';
import {
  INLINE_IMAGE,
  openLiveNote,
  renderedImageCount,
  syncSocketPath,
  waitForSyncSocket,
} from './mcp-live-helpers';
import { readNote, waitForContent, writeNote } from './vault-helpers';

/**
 * Drives the ACTUAL built MCP server binary over stdio JSON-RPC — the same way
 * Zed/Codex do — against a live app. Covers the CLI, the tool surface, the
 * server_info build stamp, and both the live and file-fallback write paths.
 */

test.use({ yjsFlag: true });

test.beforeAll(() => ensureMcpBundle());

test.describe('MCP server process', () => {
  test('advertises tools and reports a build stamp', async ({ vaultDir, testDir }) => {
    const socket = syncSocketPath(testDir);
    const client = await connectMcp([`--vault`, vaultDir, `--sync-socket`, socket]);
    try {
      const tools = await client.request('tools/list');
      const names = tools.tools.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(
        expect.arrayContaining(['append_to_note', 'update_note', 'get_note', 'server_info']),
      );

      const info = callTool(await client.request('tools/call', { name: 'server_info', arguments: {} }));
      // The build stamp is injected at bundle time — proves the running bundle,
      // not a stale process ('dev' would mean the define was dropped).
      expect(info.build).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(info.build).not.toBe('dev');
      expect(info.liveSyncEnabled).toBe(true);
      expect(info.vault).toBe(vaultDir);
    } finally {
      client.close();
    }
  });

  test('append_to_note edits the open note live', async ({ window, vaultDir, testDir }) => {
    const { docId, body } = await openLiveNote(window, 'MCP Process Live');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    const client = await connectMcp([`--vault`, vaultDir, `--sync-socket`, socket]);
    try {
      const result = callTool(
        await client.request('tools/call', {
          name: 'append_to_note',
          arguments: { id: docId, text: 'written by the mcp process' },
        }),
      );
      expect(result).toMatchObject({ ok: true, live: true });
    } finally {
      client.close();
    }

    await expect(body).toContainText('written by the mcp process');
    await waitForContent(vaultDir, 'MCP Process Live.md', 'written by the mcp process');
  });

  test('get_note reads back what a live edit wrote', async ({ window, vaultDir, testDir }) => {
    const { docId } = await openLiveNote(window, 'MCP Read Back');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    const client = await connectMcp([`--vault`, vaultDir, `--sync-socket`, socket]);
    try {
      await client.request('tools/call', {
        name: 'append_to_note',
        arguments: { id: docId, text: 'roundtrip value' },
      });
      await expect
        .poll(async () => {
          const result = await client.request('tools/call', {
            name: 'get_note',
            arguments: { id: docId },
          });
          const text = (result as { content: Array<{ text: string }> }).content[0].text;
          return text.includes('roundtrip value');
        })
        .toBe(true);
    } finally {
      client.close();
    }
  });

  test('falls back to the file when the note is not open', async ({ vaultDir, testDir }) => {
    writeNote(vaultDir, 'Offline Note.md', { id: 'offline-note', title: 'Offline Note' }, 'seed');
    const socket = syncSocketPath(testDir);

    const client = await connectMcp([`--vault`, vaultDir, `--sync-socket`, socket]);
    try {
      const result = callTool(
        await client.request('tools/call', {
          name: 'append_to_note',
          arguments: { id: 'offline-note', text: 'appended offscreen' },
        }),
      );
      // No live doc: the file tool handles it (no `live: true`).
      expect(result.live).not.toBe(true);
      expect(result.ok).toBe(true);
    } finally {
      client.close();
    }

    await waitForContent(vaultDir, 'Offline Note.md', 'appended offscreen');
  });

  test('unknown note id reports not-found rather than crashing', async ({ vaultDir, testDir }) => {
    const socket = syncSocketPath(testDir);
    const client = await connectMcp([`--vault`, vaultDir, `--sync-socket`, socket]);
    try {
      const result = callTool(
        await client.request('tools/call', {
          name: 'append_to_note',
          arguments: { id: 'does-not-exist', text: 'nope' },
        }),
      );
      expect(result).toMatchObject({ ok: false, reason: 'note_not_found' });
    } finally {
      client.close();
    }
  });

  test('create_note strips a redundant leading title heading', async ({ vaultDir, testDir }) => {
    const socket = syncSocketPath(testDir);
    const client = await connectMcp([`--vault`, vaultDir, `--sync-socket`, socket]);
    try {
      const result = callTool(
        await client.request('tools/call', {
          name: 'create_note',
          arguments: { title: 'Bird Notes', markdown: '# Bird Notes\n\nbody text' },
        }),
      );
      expect(result.ok).toBe(true);
      const raw = fs.readFileSync(path.join(vaultDir, result.relativePath), 'utf8');
      expect(raw).toContain('body text');
      expect(raw).not.toMatch(/^#\s*Bird Notes\s*$/m);
    } finally {
      client.close();
    }
  });

  test('update_note strips a leading title heading', async ({ vaultDir, testDir }) => {
    writeNote(vaultDir, 'Plain.md', { id: 'plain', title: 'Plain' }, 'seed');
    const socket = syncSocketPath(testDir);
    const client = await connectMcp([`--vault`, vaultDir, `--sync-socket`, socket]);
    try {
      const result = callTool(
        await client.request('tools/call', {
          name: 'update_note',
          arguments: { id: 'plain', markdown: '# Plain\n\nnew text' },
        }),
      );
      expect(result.ok).toBe(true);
    } finally {
      client.close();
    }
    const note = readNote(vaultDir, 'Plain.md');
    expect(note.body).toContain('new text');
    expect(note.body).not.toMatch(/^#\s*Plain\s*$/m);
  });

  test('appending several images keeps every source, in order', async ({ vaultDir, testDir }) => {
    writeNote(vaultDir, 'Birds.md', { id: 'birds', title: 'Birds' }, '');
    const socket = syncSocketPath(testDir);
    const client = await connectMcp([`--vault`, vaultDir, `--sync-socket`, socket]);
    try {
      for (const alt of ['robin', 'heron', 'owl']) {
        const result = callTool(
          await client.request('tools/call', {
            name: 'append_to_note',
            arguments: { id: 'birds', text: `![${alt}](${INLINE_IMAGE})` },
          }),
        );
        expect(result.ok).toBe(true);
      }
    } finally {
      client.close();
    }
    const raw = fs.readFileSync(path.join(vaultDir, 'Birds.md'), 'utf8');
    expect((raw.match(/data:image\/gif;base64/g) ?? []).length).toBe(3);
    expect(raw.indexOf('![robin]')).toBeLessThan(raw.indexOf('![heron]'));
    expect(raw.indexOf('![heron]')).toBeLessThan(raw.indexOf('![owl]'));
  });

  test('the real server appends two images live and both render', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId } = await openLiveNote(window, 'MCP Images');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);
    const client = await connectMcp([`--vault`, vaultDir, `--sync-socket`, socket]);
    try {
      for (const alt of ['one', 'two']) {
        const result = callTool(
          await client.request('tools/call', {
            name: 'append_to_note',
            arguments: { id: docId, text: `![${alt}](${INLINE_IMAGE})` },
          }),
        );
        expect(result).toMatchObject({ ok: true, live: true });
      }
    } finally {
      client.close();
    }
    await expect.poll(() => renderedImageCount(window), { timeout: 10_000 }).toBe(2);
    await waitForContent(vaultDir, 'MCP Images.md', INLINE_IMAGE);
  });

  test('server_info reports live sync disabled without a socket', async ({ vaultDir }) => {
    const client = await connectMcp([`--vault`, vaultDir]);
    try {
      const info = callTool(
        await client.request('tools/call', { name: 'server_info', arguments: {} }),
      );
      expect(info.liveSyncEnabled).toBe(false);
      expect(info.syncSocket).toBeNull();
    } finally {
      client.close();
    }
  });

  test('a live update is refused when expectedRevision is stale', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Live Guard');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);
    const client = await connectMcp([`--vault`, vaultDir, `--sync-socket`, socket]);
    try {
      const result = callTool(
        await client.request('tools/call', {
          name: 'update_note',
          arguments: { id: docId, markdown: 'STALE WRITE', expectedRevision: 'not-the-revision' },
        }),
      );
      expect(result).toMatchObject({ ok: false, reason: 'revision_mismatch' });
    } finally {
      client.close();
    }
    await expect(body).not.toContainText('STALE WRITE');
  });
});
