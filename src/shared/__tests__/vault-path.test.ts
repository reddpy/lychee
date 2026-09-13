import { describe, it, expect } from 'vitest';
import {
  capFileStem,
  conflictCopyPath,
  planVaultPaths,
  sanitizeFileStem,
  siblingFileStem,
  type VaultDoc,
} from '../vault-path';

function doc(id: string, title: string, parentId: string | null = null, sortOrder = 0): VaultDoc {
  return { id, title, parentId, sortOrder };
}

describe('sanitizeFileStem', () => {
  it('strips illegal characters', () => {
    expect(sanitizeFileStem('a/b:c*d?e"f<g>h|i')).toBe('a-b-c-d-e-f-g-h-i');
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeFileStem('  hello   world  ')).toBe('hello world');
  });

  it('removes trailing dots and spaces', () => {
    expect(sanitizeFileStem('name...   ')).toBe('name');
  });

  it('falls back for empty titles', () => {
    expect(sanitizeFileStem('   ')).toBe('Untitled');
  });

  it('escapes reserved Windows names', () => {
    expect(sanitizeFileStem('CON')).toBe('_CON');
    expect(sanitizeFileStem('com1')).toBe('_com1');
  });

  it('normalizes to NFC and caps length in bytes', () => {
    expect(sanitizeFileStem('cafe\u0301')).toBe('café');
    expect(new TextEncoder().encode(sanitizeFileStem('x'.repeat(500))).length).toBe(200);
    // Multibyte titles are capped by byte length, not character count.
    expect(new TextEncoder().encode(sanitizeFileStem('😀'.repeat(100))).length).toBeLessThanOrEqual(200);
  });

  it('never produces a dotfile', () => {
    expect(sanitizeFileStem('.hidden')).toBe('hidden');
    expect(sanitizeFileStem('..config..')).toBe('config');
    expect(sanitizeFileStem('...')).toBe('Untitled');
    expect(sanitizeFileStem('.')).toBe('Untitled');
  });

  it('capFileStem leaves no trailing dot or space', () => {
    const stem = capFileStem(`${'a'.repeat(119)}. `, 120);
    expect(stem.length).toBeLessThanOrEqual(120);
    expect(/[. ]$/.test(stem)).toBe(false);
  });

  it('honors a custom max (path budget)', () => {
    expect(sanitizeFileStem('abcdef', 3)).toBe('abc');
  });

  it('keeps the numeric suffix visible when capping', () => {
    const stem = siblingFileStem('a'.repeat(200), 42);
    expect(stem.endsWith(' (42)')).toBe(true);
  });

  it('conflict copies stay sanitized and keep the conflict marker', () => {
    const relative = conflictCopyPath(`${'n'.repeat(200)}.md`, '2026-01-01T00:00:00.000Z');
    const file = relative.split('/').pop()!;
    expect(file.endsWith('.md')).toBe(true);
    expect(file).toContain('(conflict 2026-01-01 00-00-00)');
    expect(new TextEncoder().encode(file).length).toBeLessThanOrEqual(203);
  });
});

describe('planVaultPaths', () => {
  it('maps a nested tree onto folder-per-note layout', () => {
    const docs = [
      doc('parent', 'Parent Note', null, 0),
      doc('childA', 'Child A', 'parent', 0),
      doc('childB', 'Child B', 'parent', 1),
      doc('grandchild', 'Grandchild', 'childB', 0),
    ];
    const paths = planVaultPaths(docs);
    expect(paths.get('parent')).toBe('Parent Note.md');
    expect(paths.get('childA')).toBe('Parent Note/Child A.md');
    expect(paths.get('childB')).toBe('Parent Note/Child B.md');
    expect(paths.get('grandchild')).toBe('Parent Note/Child B/Grandchild.md');
  });

  it('de-duplicates sibling titles', () => {
    const docs = [
      doc('a', 'Meeting', null, 0),
      doc('b', 'Meeting', null, 1),
      doc('c', 'Meeting', null, 2),
    ];
    const paths = planVaultPaths(docs);
    expect(paths.get('a')).toBe('Meeting.md');
    expect(paths.get('b')).toBe('Meeting (2).md');
    expect(paths.get('c')).toBe('Meeting (3).md');
  });

  it('orders siblings by sortOrder', () => {
    const docs = [doc('b', 'Second', null, 1), doc('a', 'First', null, 0)];
    const paths = planVaultPaths(docs);
    expect(paths.get('a')).toBe('First.md');
    expect(paths.get('b')).toBe('Second.md');
  });

  it('places docs with a missing parent at the root', () => {
    const docs = [doc('orphan', 'Orphan', 'missing-parent', 0)];
    expect(planVaultPaths(docs).get('orphan')).toBe('Orphan.md');
  });

  it('does not drop circular references', () => {
    const docs = [doc('a', 'A', 'b', 0), doc('b', 'B', 'a', 0)];
    const paths = planVaultPaths(docs);
    expect(paths.size).toBe(2);
  });
});
