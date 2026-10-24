import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { connectDoc, type SyncAdapter } from '../memory-hub';
import { appendMarkdown, createNoteDoc, flushEditor, projectDocMarkdown } from '../note-doc';

/**
 * Origin isolation: transport-sourced updates must never be rebroadcast by
 * `connectDoc` (that would echo forever between devices). Only local edits are
 * published; note-sync explicitly mirrors socket-agent edits into the folder.
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

class RecordingAdapter implements SyncAdapter {
  publishes: Uint8Array[] = [];
  private listeners = new Map<string, (update: Uint8Array, source?: string) => void>();

  subscribe(docId: string, onUpdate: (update: Uint8Array, source?: string) => void): () => void {
    this.listeners.set(docId, onUpdate);
    return () => this.listeners.delete(docId);
  }

  publish(_docId: string, update: Uint8Array): void {
    this.publishes.push(update);
  }

  emit(docId: string, update: Uint8Array, source?: "socket" | "folder"): void {
    this.listeners.get(docId)?.(update, source);
  }

  subscribeAwareness(): () => void {
    return () => {};
  }

  publishAwareness(): void {}
}

describe('sync origin isolation', () => {
  it('does not rebroadcast folder-sourced updates', () => {
    const adapter = new RecordingAdapter();
    const handle = createNoteDoc('note', { markdown: 'base\n' });
    cleanups.push(() => handle.dispose());
    connectDoc(adapter, 'note', handle.doc);
    const afterConnect = adapter.publishes.length;

    const source = createNoteDoc('note', { markdown: 'external\n' });
    cleanups.push(() => source.dispose());
    adapter.emit('note', Y.encodeStateAsUpdate(source.doc), 'folder');
    flushEditor(handle.editor);

    expect(projectDocMarkdown(handle.doc)).toContain('external');
    expect(adapter.publishes).toHaveLength(afterConnect);
  });

  it('does not rebroadcast socket-sourced updates', () => {
    const adapter = new RecordingAdapter();
    const handle = createNoteDoc('note', { markdown: 'base\n' });
    cleanups.push(() => handle.dispose());
    connectDoc(adapter, 'note', handle.doc);
    const afterConnect = adapter.publishes.length;

    const agent = createNoteDoc('note', { markdown: 'agent\n' });
    cleanups.push(() => agent.dispose());
    adapter.emit('note', Y.encodeStateAsUpdate(agent.doc), 'socket');
    flushEditor(handle.editor);

    expect(projectDocMarkdown(handle.doc)).toContain('agent');
    expect(adapter.publishes).toHaveLength(afterConnect);
  });

  it('publishes local edits', () => {
    const adapter = new RecordingAdapter();
    const handle = createNoteDoc('note', { markdown: 'base\n' });
    cleanups.push(() => handle.dispose());
    connectDoc(adapter, 'note', handle.doc);
    const afterConnect = adapter.publishes.length;

    appendMarkdown(handle.editor, 'local edit\n');
    expect(adapter.publishes.length).toBeGreaterThan(afterConnect);
  });
});
