import fs from 'fs';
import path from 'path';
import { test, expect } from './electron-app';
import { callTool, connectMcp, ensureMcpBundle, toolText } from './mcp-client';
import { listMarkdown, readNote, waitForContent, writeNote } from './vault-helpers';

/**
 * The rest of the MCP tool surface, driven through the REAL built binary.
 * These are the calls an agent actually makes ("rename this", "move it under
 * X", "trash that", "search the vault") — file-first, no UI required.
 */

test.beforeAll(() => ensureMcpBundle());

/** Open a client for the hermetic vault. */
async function client(vaultDir: string) {
  return connectMcp(['--vault', vaultDir]);
}

async function createViaMcp(c: Awaited<ReturnType<typeof client>>, args: Record<string, unknown>) {
  return callTool(await c.request('tools/call', { name: 'create_note', arguments: args }));
}

test.describe('MCP tools (process) — read/search/links', () => {
  test('search_notes finds notes written through the tools', async ({ vaultDir }) => {
    const c = await client(vaultDir);
    try {
      await createViaMcp(c, { title: 'Apples', markdown: 'about fruit' });
      await createViaMcp(c, { title: 'Other', markdown: 'apples too' });

      const hits = callTool(
        await c.request('tools/call', { name: 'search_notes', arguments: { query: 'apples' } }),
      );
      expect(hits.map((hit: { title: string }) => hit.title).sort()).toEqual(['Apples', 'Other']);
      const none = callTool(
        await c.request('tools/call', { name: 'search_notes', arguments: { query: 'zzzzz' } }),
      );
      expect(none).toEqual([]);
    } finally {
      c.close();
    }
  });

  test('backlinks finds a link an agent added', async ({ vaultDir }) => {
    const c = await client(vaultDir);
    try {
      const target = await createViaMcp(c, { title: 'Target' });
      await createViaMcp(c, {
        title: 'Linker',
        markdown: `See [Target](https://note.lychee.invalid/${target.id}).`,
      });

      const links = callTool(
        await c.request('tools/call', { name: 'backlinks', arguments: { id: target.id } }),
      );
      expect(links.map((link: { title: string }) => link.title)).toEqual(['Linker']);
    } finally {
      c.close();
    }
  });

  test('get_note returns the body and a revision that changes on write', async ({ vaultDir }) => {
    const c = await client(vaultDir);
    try {
      const note = await createViaMcp(c, { title: 'Revs', markdown: 'one' });
      const first = toolText(await c.request('tools/call', { name: 'get_note', arguments: { id: note.id } }));
      await c.request('tools/call', {
        name: 'update_note',
        arguments: { id: note.id, markdown: 'two' },
      });
      const second = toolText(await c.request('tools/call', { name: 'get_note', arguments: { id: note.id } }));
      expect(first).toContain('one');
      expect(second).toContain('two');
      expect(second).not.toBe(first);
    } finally {
      c.close();
    }
  });
});

test.describe('MCP tools (process) — structure', () => {
  test('rename_note moves the file and keeps identity', async ({ vaultDir }) => {
    const c = await client(vaultDir);
    try {
      const note = await createViaMcp(c, { title: 'Old Name', markdown: 'body' });
      const renamed = callTool(
        await c.request('tools/call', {
          name: 'rename_note',
          arguments: { id: note.id, title: 'New Name' },
        }),
      );
      expect(renamed.ok).toBe(true);
      expect(renamed.relativePath).toBe('New Name.md');

      const read = toolText(await c.request('tools/call', { name: 'get_note', arguments: { id: note.id } }));
      expect(read).toContain('body');
      expect(fs.existsSync(path.join(vaultDir, 'Old Name.md'))).toBe(false);
    } finally {
      c.close();
    }
  });

  test('move_note nests under a parent and back to the root', async ({ vaultDir }) => {
    const c = await client(vaultDir);
    try {
      const parent = await createViaMcp(c, { title: 'Parent' });
      const child = await createViaMcp(c, { title: 'Child', markdown: 'nested' });

      const moved = callTool(
        await c.request('tools/call', {
          name: 'move_note',
          arguments: { id: child.id, parentId: parent.id },
        }),
      );
      expect(moved.relativePath).toBe('Parent/Child.md');

      const back = callTool(
        await c.request('tools/call', {
          name: 'move_note',
          arguments: { id: child.id, parentId: null },
        }),
      );
      expect(back.relativePath).toBe('Child.md');
    } finally {
      c.close();
    }
  });

  test('create_note accepts a parent by id and by vault path', async ({ vaultDir }) => {
    const c = await client(vaultDir);
    try {
      const parent = await createViaMcp(c, { title: 'Alpha' });
      const byId = await createViaMcp(c, { title: 'Beta', parentId: parent.id });
      expect(byId.relativePath).toBe('Alpha/Beta.md');
      const byPath = await createViaMcp(c, { title: 'Gamma', parentId: 'Alpha.md' });
      expect(byPath.relativePath).toBe('Alpha/Gamma.md');
      // A title that is not a path/id is not a parent.
      const bad = await createViaMcp(c, { title: 'Delta', parentId: 'Alpha' });
      expect(bad).toMatchObject({ ok: false, reason: 'parent_not_found' });
    } finally {
      c.close();
    }
  });
});

test.describe('MCP tools (process) — trash and restore', () => {
  test('trash_note hides the note and restore_note brings it back', async ({ vaultDir }) => {
    const c = await client(vaultDir);
    try {
      const note = await createViaMcp(c, { title: 'Doomed', markdown: 'bye' });

      const trashed = callTool(
        await c.request('tools/call', { name: 'trash_note', arguments: { id: note.id } }),
      );
      expect(trashed.ok).toBe(true);

      const listed = callTool(await c.request('tools/call', { name: 'list_notes', arguments: {} }));
      expect(listed.map((n: { id: string }) => n.id)).not.toContain(note.id);
      expect(listMarkdown(vaultDir, { trash: true }).some((p) => p.includes('Doomed'))).toBe(true);

      const restored = callTool(
        await c.request('tools/call', { name: 'restore_note', arguments: { id: note.id } }),
      );
      expect(restored.ok).toBe(true);
      const listedAgain = callTool(
        await c.request('tools/call', { name: 'list_notes', arguments: {} }),
      );
      expect(listedAgain.map((n: { id: string }) => n.id)).toContain(note.id);
    } finally {
      c.close();
    }
  });
});

test.describe('MCP tools (process) — editing edge cases', () => {
  test('replace_in_note replaces every occurrence', async ({ vaultDir }) => {
    writeNote(vaultDir, 'Rep.md', { id: 'rep', title: 'Rep' }, 'red red red');
    const c = await client(vaultDir);
    try {
      const result = callTool(
        await c.request('tools/call', {
          name: 'replace_in_note',
          arguments: { id: 'rep', find: 'red', replace: 'blue' },
        }),
      );
      expect(result.ok).toBe(true);
      const body = readNote(vaultDir, 'Rep.md').body;
      expect(body).not.toContain('red');
      expect(body.match(/blue/g)?.length).toBe(3);
    } finally {
      c.close();
    }
  });

  test('a stale expectedRevision is refused', async ({ vaultDir }) => {
    const c = await client(vaultDir);
    try {
      const note = await createViaMcp(c, { title: 'Guard', markdown: 'v1' });
      const stale = callTool(
        await c.request('tools/call', {
          name: 'update_note',
          arguments: { id: note.id, markdown: 'v2', expectedRevision: 'not-the-revision' },
        }),
      );
      expect(stale).toMatchObject({ ok: false, reason: 'revision_mismatch' });
      // The refused write did not change the file.
      const read = toolText(
        await c.request('tools/call', { name: 'get_note', arguments: { id: note.id } }),
      );
      expect(read).toContain('v1');
      expect(read).not.toContain('v2');
    } finally {
      c.close();
    }
  });

  test('append_to_note preserves a lychee-unknown block', async ({ vaultDir }) => {
    const unknown = '```lychee-unknown\n{"type":"future-widget","payload":{"x":1}}\n```';
    writeNote(vaultDir, 'Unknown.md', { id: 'unk', title: 'Unknown' }, unknown);
    const c = await client(vaultDir);
    try {
      const result = callTool(
        await c.request('tools/call', {
          name: 'append_to_note',
          arguments: { id: 'unk', text: 'appended after the unknown block' },
        }),
      );
      expect(result.ok).toBe(true);
    } finally {
      c.close();
    }
    const body = readNote(vaultDir, 'Unknown.md').body;
    expect(body).toContain('lychee-unknown');
    expect(body).toContain('future-widget');
    expect(body).toContain('appended after the unknown block');
  });

  test('unicode and emoji titles round-trip through filenames', async ({ vaultDir }) => {
    const c = await client(vaultDir);
    try {
      const note = await createViaMcp(c, { title: 'Ångström 🐦 Notes', markdown: 'body' });
      expect(note.ok).toBe(true);
      const read = toolText(
        await c.request('tools/call', { name: 'get_note', arguments: { id: note.id } }),
      );
      expect(read).toContain('body');
      await waitForContent(vaultDir, `${note.relativePath}`, 'body');
    } finally {
      c.close();
    }
  });
});

test.describe('MCP tools (process) — multi-note isolation', () => {
  test('edits to two notes stay isolated', async ({ vaultDir }) => {
    const c = await client(vaultDir);
    try {
      const a = await createViaMcp(c, { title: 'Iso A', markdown: 'a base' });
      const b = await createViaMcp(c, { title: 'Iso B', markdown: 'b base' });

      await c.request('tools/call', {
        name: 'append_to_note',
        arguments: { id: a.id, text: 'A-X' },
      });
      await c.request('tools/call', {
        name: 'append_to_note',
        arguments: { id: b.id, text: 'B-X' },
      });

      const bodyA = readNote(vaultDir, 'Iso A.md').body;
      const bodyB = readNote(vaultDir, 'Iso B.md').body;
      expect(bodyA).toContain('A-X');
      expect(bodyA).not.toContain('B-X');
      expect(bodyB).toContain('B-X');
      expect(bodyB).not.toContain('A-X');
    } finally {
      c.close();
    }
  });

  test('edits under different parents stay isolated', async ({ vaultDir }) => {
    const c = await client(vaultDir);
    try {
      const p1 = await createViaMcp(c, { title: 'P1' });
      const p2 = await createViaMcp(c, { title: 'P2' });
      const c1 = await createViaMcp(c, { title: 'Child One', parentId: p1.id, markdown: 'one' });
      const c2 = await createViaMcp(c, { title: 'Child Two', parentId: p2.id, markdown: 'two' });
      expect(c1.relativePath).toBe('P1/Child One.md');
      expect(c2.relativePath).toBe('P2/Child Two.md');

      await c.request('tools/call', {
        name: 'append_to_note',
        arguments: { id: c1.id, text: 'C1-ONLY' },
      });
      expect(readNote(vaultDir, 'P1/Child One.md').body).toContain('C1-ONLY');
      expect(readNote(vaultDir, 'P2/Child Two.md').body).not.toContain('C1-ONLY');
    } finally {
      c.close();
    }
  });
});
