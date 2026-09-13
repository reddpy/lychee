import path from 'path';
import {
  test,
  expect,
  listDocumentsFromDb,
  getDocumentFromDb,
  launchLychee,
  firstWindowReady,
} from './electron-app';
import { listMarkdown, readNote, readTrashedNote, noteItem } from './vault-helpers';
import { serializeFrontmatter } from '../src/shared/frontmatter';

/**
 * Startup import — odd/edge markdown straight from the OS.
 *
 * Every file below is written into the hermetic vault *before* launch, so this
 * exercises the import path, not the live watcher. Never touches the real vault.
 */

const ID = (n: string) => `e0000000-0000-4000-8000-0000000000${n}`;
const UNTITLED_ID = ID('01');
const UNICODE_ID = ID('02');
const COLLIDE_ID = ID('03');
const BOM_ID = ID('04');
const CRLF_ID = ID('05');
const EMPTY_ID = ID('06');
const FMNAME_ID = ID('07');
const ORDERA_ID = ID('08');
const ORDERB_ID = ID('09');
const HIDDEN_ID = ID('0a');
const UPPER_ID = ID('0b');
const SPACED_ID = ID('0c');
const CONFLICT_ID = ID('0d');

const IMPORTED_IDS = [
  UNTITLED_ID,
  UNICODE_ID,
  COLLIDE_ID,
  BOM_ID,
  CRLF_ID,
  EMPTY_ID,
  FMNAME_ID,
  ORDERA_ID,
  ORDERB_ID,
  UPPER_ID,
  SPACED_ID,
];

function fm(
  note: {
    id?: string;
    title?: string;
    emoji?: string;
    order?: number;
    updated?: string;
  },
  body = '',
): string {
  if (!note.id) throw new Error('fm() needs an id');
  const frontmatter = serializeFrontmatter({
    id: note.id,
    title: note.title,
    emoji: note.emoji,
    created: '2024-01-01T00:00:00.000Z',
    updated: note.updated ?? '2024-01-02T00:00:00.000Z',
    contentSchemaVersion: 1,
    order: note.order,
  });
  return `${frontmatter}\n${body}`;
}

const EDGE_FILES: Record<string, string> = {
  'Untitled.md': fm({ id: UNTITLED_ID }, 'blank body'),
  'Ünïcödé ⛄ 标题.md': fm({ id: UNICODE_ID, title: 'Ünïcödé ⛄ 标题' }, 'unicode body'),
  'collide-a.md': fm(
    { id: COLLIDE_ID, title: 'Collide A', updated: '2024-06-01T00:00:00.000Z' },
    'a',
  ),
  'collide-b.md': fm(
    { id: COLLIDE_ID, title: 'Collide B', updated: '2024-05-01T00:00:00.000Z' },
    'b',
  ),
  'bom.md': `\uFEFF${fm({ id: BOM_ID, title: 'BOM Note' }, 'bom')}`,
  'crlf.md': fm({ id: CRLF_ID, title: 'CRLF Note' }, 'line one\nline two').replace(/\n/g, '\r\n'),
  'empty-body.md': fm({ id: EMPTY_ID, title: 'Empty Body' }, ''),
  'frontmatter-name.md': fm({ id: FMNAME_ID, title: 'Frontmatter Name' }, 'x'),
  'order-a.md': fm({ id: ORDERA_ID, title: 'Order A', order: 5 }, 'x'),
  'order-b.md': fm({ id: ORDERB_ID, title: 'Order B', order: 1 }, 'x'),
  'UPPER.MD': fm({ id: UPPER_ID, title: 'Upper Note' }, 'x'),
  'with space in name.md': fm({ id: SPACED_ID, title: 'Spaced Name' }, 'x'),
  // Everything below must be ignored.
  'no-frontmatter.md': '# No frontmatter\n\nplain',
  'malformed.md': '---\nid: "unterminated\n\nno closing delimiter',
  'only-title.md': '---\ntitle: "No Id"\n---\n\nbody',
  '.hidden/secret.md': fm({ id: HIDDEN_ID, title: 'Hidden' }, 'x'),
  'notes.txt': 'not markdown',
  'dup (conflict 2024-01-01 00-00-00).md': fm({ id: CONFLICT_ID, title: 'Conflict' }, 'x'),
};

test.use({ vaultExtra: EDGE_FILES });

test.describe('Startup import — edge cases', () => {
  test('imports every valid file and ignores the rest', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 15_000 })
      .toBe(IMPORTED_IDS.length);

    const docs = await listDocumentsFromDb(window);
    const ids = new Set(docs.map((doc) => doc.id));
    for (const id of IMPORTED_IDS) expect(ids.has(id)).toBe(true);

    // Ignored: dot-dir, non-markdown, no-id-once frontmatter, malformed, conflict copies.
    expect(ids.has(HIDDEN_ID)).toBe(false);
    expect(ids.has(CONFLICT_ID)).toBe(false);
    expect(docs.some((doc) => doc.title === 'No Id')).toBe(false);
    expect(docs.some((doc) => doc.title === 'No frontmatter')).toBe(false);

    // Ignored files are left on disk untouched.
    const onDisk = listMarkdown(vaultDir);
    expect(onDisk).toContain('no-frontmatter.md');
    expect(onDisk).toContain('malformed.md');
    expect(onDisk).toContain('only-title.md');
    expect(onDisk).not.toContain('.hidden/secret.md');
  });

  test('imports a Unicode/emoji filename and title', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, UNICODE_ID))?.title, { timeout: 15_000 })
      .toBe('Ünïcödé ⛄ 标题');
    await expect(noteItem(window, 'Ünïcödé')).toBeVisible();
  });

  test('handles a UTF-8 BOM before the frontmatter', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOM_ID))?.title, { timeout: 15_000 })
      .toBe('BOM Note');
  });

  test('handles CRLF line endings', async ({ window }) => {
    const doc = await (async () => {
      await expect
        .poll(async () => (await getDocumentFromDb(window, CRLF_ID))?.title, { timeout: 15_000 })
        .toBe('CRLF Note');
      return getDocumentFromDb(window, CRLF_ID);
    })();
    expect(doc!.content).toContain('line one');
    expect(doc!.content).toContain('line two');
  });

  test('imports a note whose file has no body', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, EMPTY_ID))?.title, { timeout: 15_000 })
      .toBe('Empty Body');
    expect((await getDocumentFromDb(window, EMPTY_ID))!.content).toBe('');
  });

  test('prefers an explicit frontmatter title over the filename stem', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, FMNAME_ID))?.title, { timeout: 15_000 })
      .toBe('Frontmatter Name');
  });

  test('adopts frontmatter order values', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ORDERA_ID))?.sortOrder, { timeout: 15_000 })
      .toBe(5);
    await expect
      .poll(async () => (await getDocumentFromDb(window, ORDERB_ID))?.sortOrder, { timeout: 15_000 })
      .toBe(1);
  });

  test('processes an uppercase .MD extension', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, UPPER_ID))?.title, { timeout: 15_000 })
      .toBe('Upper Note');
  });

  test('imports a filename containing spaces', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, SPACED_ID))?.title, { timeout: 15_000 })
      .toBe('Spaced Name');
  });

  test('keeps one note for a duplicated id and trashes the stale file on relaunch', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchLychee({ userDataDir, vaultDir });
    const firstWindow = await firstWindowReady(first);
    await expect
      .poll(
        async () =>
          (await listDocumentsFromDb(firstWindow)).filter((doc) => doc.id === COLLIDE_ID).length,
        { timeout: 15_000 },
      )
      .toBe(1);
    await first.close();

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect
      .poll(
        async () =>
          (await listDocumentsFromDb(secondWindow)).filter((doc) => doc.id === COLLIDE_ID).length,
        { timeout: 15_000 },
      )
      .toBe(1);

    // Exactly one file with that id remains live; the other is in .trash.
    const liveWithId = listMarkdown(vaultDir).filter(
      (rel) => readNote(vaultDir, rel).data.id === COLLIDE_ID,
    );
    const trashedWithId = listMarkdown(vaultDir, { trash: true }).filter(
      (rel) => readTrashedNote(vaultDir, rel).data.id === COLLIDE_ID,
    );
    expect(liveWithId.length).toBe(1);
    expect(trashedWithId.length).toBe(1);
    await second.close();
  });
});
