import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server';
import { getNote, listNotes } from '../vault-tools';

/**
 * End-to-end MCP wiring: drive the real server over an in-memory transport, the
 * same way an MCP client would, and assert the vault changes on disk. This is
 * the contract that keeps the agent path and the app path (both on
 * `vault-store`) honest.
 */

let vault: string;

async function connect() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(vault);
  const client = new Client({ name: 'lychee-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return content.map((part) => part.text).join('\n');
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-mcp-server-'));
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

describe('MCP server — tool surface', () => {
  it('advertises the vault tools including create_note', async () => {
    const { client, server } = await connect();
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_notes',
        'create_note',
        'get_note',
        'search_notes',
        'backlinks',
        'update_note',
        'replace_in_note',
        'append_to_note',
        'rename_note',
        'move_note',
        'trash_note',
        'restore_note',
      ]),
    );
    await server.close();
  });

  it('creates a note through the protocol and writes it to disk', async () => {
    const { client, server } = await connect();

    const result = await client.callTool({
      name: 'create_note',
      arguments: { title: 'From MCP', markdown: '# From MCP\n\nhello', emoji: '🤖' },
    });
    const payload = JSON.parse(textOf(result)) as { ok: boolean; id: string; relativePath: string };
    expect(payload.ok).toBe(true);

    expect(fs.existsSync(path.join(vault, payload.relativePath))).toBe(true);
    const note = getNote(vault, payload.id)!;
    expect(note.title).toBe('From MCP');
    expect(note.body).toContain('hello');
    expect(listNotes(vault).map((entry) => entry.id)).toContain(payload.id);

    await server.close();
  });

  it('surfaces a duplicate-title refusal as a tool result, not a crash', async () => {
    const { client, server } = await connect();
    await client.callTool({ name: 'create_note', arguments: { title: 'Taken' } });

    const second = await client.callTool({
      name: 'create_note',
      arguments: { title: 'Taken' },
    });
    const payload = JSON.parse(textOf(second)) as { ok: boolean; reason: string };
    expect(payload).toMatchObject({ ok: false, reason: 'duplicate_title' });
    expect(listNotes(vault)).toHaveLength(1);

    await server.close();
  });

  it('creates a nested note and then reads it back by id', async () => {
    const { client, server } = await connect();

    const parentResult = await client.callTool({
      name: 'create_note',
      arguments: { title: 'Parent' },
    });
    const parent = JSON.parse(textOf(parentResult)) as { id: string };

    const childResult = await client.callTool({
      name: 'create_note',
      arguments: { title: 'Child', parentId: parent.id, markdown: 'nested' },
    });
    const child = JSON.parse(textOf(childResult)) as { id: string; relativePath: string };
    expect(child.relativePath).toBe('Parent/Child.md');

    const read = await client.callTool({ name: 'get_note', arguments: { id: child.id } });
    expect(textOf(read)).toContain('nested');

    await server.close();
  });
});
