import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { deriveEntry } from '../vault-entry';

let vault: string;

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-entry-'));
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

function idByPath(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries).map(([p, id]) => [p.toLowerCase(), id]));
}

describe('deriveEntry — title', () => {
  it('import: resolves the title from the filename stem', () => {
    const { title } = deriveEntry({
      vault,
      relativePath: 'My Note.md',
      body: 'x',
      mode: 'import',
      id: 'a',
    });
    expect(title).toBe('My Note');
  });

  it('import: prefers a legacy frontmatter title', () => {
    const { title } = deriveEntry({
      vault,
      relativePath: 'Sanitized-Stem.md',
      frontmatterTitle: 'Exact: Title/With*Chars',
      body: 'x',
      mode: 'import',
      id: 'a',
    });
    expect(title).toBe('Exact: Title/With*Chars');
  });

  it('import: treats the Untitled sentinel as blank', () => {
    const { title } = deriveEntry({
      vault,
      relativePath: 'Untitled.md',
      body: 'x',
      mode: 'import',
      id: 'a',
    });
    expect(title).toBe('');
  });

  it('update: adopts an external filename rename', () => {
    const { title } = deriveEntry({
      vault,
      relativePath: 'Renamed On Disk.md',
      frontmatterTitle: 'Old Title',
      body: 'x',
      mode: 'update',
      currentTitle: 'Old Title',
      id: 'a',
    });
    expect(title).toBe('Renamed On Disk');
  });

  it('update: prefers a changed frontmatter title over the stem', () => {
    const { title } = deriveEntry({
      vault,
      relativePath: 'Stem.md',
      frontmatterTitle: 'Frontmatter Wins',
      body: 'x',
      mode: 'update',
      currentTitle: 'Old',
      id: 'a',
    });
    expect(title).toBe('Frontmatter Wins');
  });

  it('update: ignores a case-only stem difference', () => {
    const { title } = deriveEntry({
      vault,
      relativePath: 'my note.md',
      body: 'x',
      mode: 'update',
      currentTitle: 'My Note',
      id: 'a',
    });
    expect(title).toBe('My Note');
  });
});

describe('deriveEntry — hierarchy', () => {
  it('resolves the parent from the folder layout (case-insensitive)', () => {
    const { parentId } = deriveEntry({
      vault,
      relativePath: 'Folder/Child.md',
      body: 'x',
      mode: 'import',
      id: 'child',
      idByPath: idByPath({ 'folder.md': 'parent' }),
    });
    expect(parentId).toBe('parent');
  });

  it('is null for a root note', () => {
    const { parentId } = deriveEntry({
      vault,
      relativePath: 'Root.md',
      body: 'x',
      mode: 'import',
      id: 'a',
      idByPath: idByPath({ 'root.md': 'a' }),
    });
    expect(parentId).toBeNull();
  });

  it('never resolves a note as its own parent', () => {
    const { parentId } = deriveEntry({
      vault,
      relativePath: 'Self/Self.md',
      body: 'x',
      mode: 'import',
      id: 'self',
      idByPath: idByPath({ 'self/self.md': 'self' }),
    });
    expect(parentId).toBeNull();
  });
});

describe('deriveEntry — content', () => {
  it('is null for an empty body (never wipes a note)', () => {
    const { content } = deriveEntry({
      vault,
      relativePath: 'Empty.md',
      body: '   \n  ',
      mode: 'import',
      id: 'a',
    });
    expect(content).toBeNull();
  });

  it('derives content from the file body and strips a legacy leading title', () => {
    const { content } = deriveEntry({
      vault,
      relativePath: 'Note.md',
      body: '# Note\n\nreal body\n',
      mode: 'import',
      id: 'a',
    });
    expect(content).toBe('real body\n');
  });

  it('uses canonical contentOverride over the file body', () => {
    const { content } = deriveEntry({
      vault,
      relativePath: 'Note.md',
      body: 'from the file',
      mode: 'update',
      currentTitle: 'Note',
      id: 'a',
      contentOverride: 'from the renderer',
    });
    expect(content).toBe('from the renderer');
  });

  it('strips a legacy leading title from overridden content too', () => {
    const { content } = deriveEntry({
      vault,
      relativePath: 'Note.md',
      body: '',
      mode: 'update',
      currentTitle: 'Note',
      id: 'a',
      contentOverride: '# Note\n\ncanonical',
    });
    expect(content).toBe('canonical');
  });

  it('yields empty string (not null) for an empty override', () => {
    const { content } = deriveEntry({
      vault,
      relativePath: 'Note.md',
      body: 'ignored because an override is present',
      mode: 'update',
      currentTitle: 'Note',
      id: 'a',
      contentOverride: '',
    });
    expect(content).toBe('');
  });
});
