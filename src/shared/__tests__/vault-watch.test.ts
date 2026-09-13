import { describe, it, expect } from 'vitest';
import {
  classifyVaultChange,
  isConflictCopyPath,
  isNonMarkdownFileTitle,
  shouldIgnoreVaultPath,
  type VaultChangeFacts,
} from '../vault-watch';

function facts(overrides: Partial<VaultChangeFacts> = {}): VaultChangeFacts {
  return {
    exists: true,
    fileRevision: 'rev-file',
    hasId: true,
    note: {
      fileRevision: 'baseline-file',
      contentRevision: 'baseline-content',
      currentContentRevision: 'baseline-content',
    },
    ...overrides,
  };
}

describe('classifyVaultChange', () => {
  it('ignores a missing file (deletes are never propagated)', () => {
    expect(classifyVaultChange(facts({ exists: false }))).toBe('ignore');
  });

  it('ignores markdown that is not a Lychee note (no id)', () => {
    expect(classifyVaultChange(facts({ hasId: false, note: null }))).toBe('ignore');
  });

  it('imports a file whose id has no matching note', () => {
    expect(classifyVaultChange(facts({ note: null }))).toBe('import');
  });

  it('adopts a note that has no baseline yet', () => {
    expect(
      classifyVaultChange(facts({ note: { currentContentRevision: 'x' } })),
    ).toBe('adopt');
  });

  it('ignores our own write (revision matches the stored baseline)', () => {
    expect(classifyVaultChange(facts({ fileRevision: 'baseline-file' }))).toBe('ignore');
  });

  it('applies an external edit when the db is unchanged since export', () => {
    expect(
      classifyVaultChange(
        facts({
          fileRevision: 'external',
          note: { fileRevision: 'baseline-file', contentRevision: 'c', currentContentRevision: 'c' },
        }),
      ),
    ).toBe('apply');
  });

  it('reports a conflict when the db also changed since export', () => {
    expect(
      classifyVaultChange(
        facts({
          fileRevision: 'external',
          note: { fileRevision: 'baseline-file', contentRevision: 'c', currentContentRevision: 'changed' },
        }),
      ),
    ).toBe('conflict');
  });
});

describe('shouldIgnoreVaultPath', () => {
  it('ignores dotfiles, temp, and editor artifacts', () => {
    for (const name of ['.hidden.md', '.Note.md.tmp', 'Note.md~', 'Note.md.swp', 'Note.md.swx']) {
      expect(shouldIgnoreVaultPath(name)).toBe(true);
    }
  });

  it('keeps real markdown files', () => {
    for (const name of ['Note.md', 'Note (2).md', '日本語.md']) {
      expect(shouldIgnoreVaultPath(name)).toBe(false);
    }
  });
});

describe('isConflictCopyPath', () => {
  it('matches conflict copies including de-duplicated ones', () => {
    expect(isConflictCopyPath('Note (conflict 2026-09-12 10-00-00).md')).toBe(true);
    expect(isConflictCopyPath('A/Note (conflict 2026-09-12 10-00-00 2).md')).toBe(true);
  });

  it('does not match normal notes', () => {
    expect(isConflictCopyPath('Note.md')).toBe(false);
    expect(isConflictCopyPath('Conflict.md')).toBe(false);
  });
});

describe('isNonMarkdownFileTitle', () => {
  it('detects notes that are really files', () => {
    for (const title of ['photo.png', 'Report.pdf', 'song.mp3', 'archive.zip', 'clip.mov', 'notes.txt']) {
      expect(isNonMarkdownFileTitle(title)).toBe(true);
    }
  });

  it('leaves normal note titles alone', () => {
    for (const title of ['Meeting Notes', 'photo', 'Q3 Report', 'C++']) {
      expect(isNonMarkdownFileTitle(title)).toBe(false);
    }
  });
});
