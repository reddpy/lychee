import { describe, it, expect } from 'vitest';
import { planVaultImport, type ScannedVaultEntry } from '../vault-import';

function entry(relativePath: string, overrides: Partial<ScannedVaultEntry> = {}): ScannedVaultEntry {
  return { relativePath, body: '', ...overrides };
}

describe('planVaultImport', () => {
  it('derives parentId from the folder-per-note layout', () => {
    const plan = planVaultImport([
      entry('A.md', { id: 'id-a', title: 'A' }),
      entry('A/B.md', { id: 'id-b', title: 'B' }),
      entry('A/B/C.md', { id: 'id-c', title: 'C' }),
    ]);
    const byPath = new Map(plan.map((item) => [item.relativePath, item]));
    expect(byPath.get('A.md')!.parentId).toBeNull();
    expect(byPath.get('A/B.md')!.parentId).toBe('id-a');
    expect(byPath.get('A/B/C.md')!.parentId).toBe('id-b');
  });

  it('puts a child at the root when its parent file is missing', () => {
    const plan = planVaultImport([entry('A/B.md', { id: 'id-b', title: 'B' })]);
    expect(plan[0].parentId).toBeNull();
  });

  it('resolves duplicate ids to the newest and keeps the rest as new notes', () => {
    const plan = planVaultImport([
      entry('Old.md', { id: 'dup', title: 'Old', updated: '2026-01-01T00:00:00.000Z' }),
      entry('New.md', { id: 'dup', title: 'New', updated: '2026-06-01T00:00:00.000Z' }),
    ]);
    const byPath = new Map(plan.map((item) => [item.relativePath, item]));
    expect(byPath.get('New.md')).toMatchObject({ id: 'dup' });
    expect(byPath.get('Old.md')).toMatchObject({ id: null, duplicateOf: 'dup' });
  });

  it('assigns null id when frontmatter has none', () => {
    const plan = planVaultImport([entry('NoId.md', { title: 'No Id' })]);
    expect(plan[0].id).toBeNull();
  });

  it('uses the frontmatter title, falling back to the file stem', () => {
    const plan = planVaultImport([entry('Stem.md'), entry('Named.md', { title: 'Real Title' })]);
    const byPath = new Map(plan.map((item) => [item.relativePath, item]));
    expect(byPath.get('Stem.md')!.title).toBe('Stem');
    expect(byPath.get('Named.md')!.title).toBe('Real Title');
  });

  it('fills order from frontmatter or sibling index', () => {
    const plan = planVaultImport([
      entry('A.md', { title: 'A' }),
      entry('B.md', { title: 'B', order: 7 }),
      entry('C.md', { title: 'C' }),
    ]);
    const byPath = new Map(plan.map((item) => [item.relativePath, item]));
    expect(byPath.get('A.md')!.order).toBe(0);
    expect(byPath.get('B.md')!.order).toBe(7);
    expect(byPath.get('C.md')!.order).toBe(2);
  });

  it('points children at nothing when the parent was a duplicate loser', () => {
    const plan = planVaultImport([
      entry('Dup.md', { id: 'dup', title: 'Dup', updated: '2026-01-01T00:00:00.000Z' }),
      entry('Dup2.md', { id: 'dup', title: 'Dup2', updated: '2026-06-01T00:00:00.000Z' }),
      entry('Dup2/Child.md', { id: 'child', title: 'Child' }),
    ]);
    const child = plan.find((item) => item.relativePath === 'Dup2/Child.md')!;
    // Dup2 wins with id 'dup', so the child points at it.
    expect(child.parentId).toBe('dup');
  });
});
