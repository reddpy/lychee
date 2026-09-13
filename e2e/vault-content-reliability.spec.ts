import fs from 'fs';
import path from 'path';
import {
  test,
  expect,
  listDocumentsFromDb,
  getDocumentFromDb,
  launchLychee,
  firstWindowReady,
} from './electron-app';
import {
  createNote,
  noteItem,
  visibleTitle,
  listMarkdown,
  readNote,
  waitForFile,
} from './vault-helpers';

/**
 * Content fidelity + reliability. Real users paste rich markdown and expect it
 * to survive; and they expect to never lose notes if a folder moves or vanishes.
 */

function externalNote(id: string, title: string, body: string): string {
  return `---\nid: "${id}"\ntitle: "${title}"\ncreated: "2024-01-01T00:00:00.000Z"\nupdated: "2024-01-02T00:00:00.000Z"\ncontent_schema_version: 1\n---\n\n${body}`;
}

const RICH_BODY = [
  '## Heading',
  '',
  '- bullet one',
  '- bullet two',
  '',
  '1. first',
  '2. second',
  '',
  '- [ ] todo',
  '- [x] done',
  '',
  '> a quote',
  '',
  'Some `inline` code.',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  '| A | B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '[Example](https://example.com)',
].join('\n');

test.describe('Content fidelity', () => {
  test('rich markdown from the OS imports and re-exports without loss', async ({
    window,
    vaultDir,
  }) => {
    const id = 'c1000000-0000-4000-8000-000000000001';
    fs.writeFileSync(path.join(vaultDir, 'Rich.md'), externalNote(id, 'Rich', RICH_BODY));

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('const x = 1;');

    const content = (await getDocumentFromDb(window, id))!.content;
    for (const marker of ['## Heading', 'bullet one', 'todo', 'a quote', '`inline`', 'example.com']) {
      expect(content).toContain(marker);
    }

    // The canonical on-disk file keeps the same meaning.
    const raw = fs.readFileSync(path.join(vaultDir, 'Rich.md'), 'utf8');
    for (const marker of ['## Heading', 'bullet one', 'todo', 'a quote', 'const x = 1;', 'example.com']) {
      expect(raw).toContain(marker);
    }
  });

  test('a body H1 matching the title is stripped, other headings are kept', async ({
    window,
    vaultDir,
  }) => {
    const id = 'c2000000-0000-4000-8000-000000000001';
    fs.writeFileSync(
      path.join(vaultDir, 'Body Title.md'),
      externalNote(id, 'Body Title', '# Body Title\n\n# Other Heading\n\nbody text'),
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('Other Heading');

    const content = (await getDocumentFromDb(window, id))!.content;
    expect(content).not.toContain('# Body Title');
    expect(content).toContain('# Other Heading');
  });

  test('rich markdown survives an app rewrite of the file', async ({ window, vaultDir }) => {
    const id = 'c3000000-0000-4000-8000-000000000001';
    fs.writeFileSync(path.join(vaultDir, 'Rewrite.md'), externalNote(id, 'Rewrite', RICH_BODY));
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('const x = 1;');

    // Force the app to rewrite the file (emoji change = field write-through).
    await window.evaluate(
      async (docId) => {
        await (window as any).lychee.invoke('documents.update', { id: docId, emoji: '📎' });
      },
      id,
    );
    await window.waitForTimeout(600);

    const raw = fs.readFileSync(path.join(vaultDir, 'Rewrite.md'), 'utf8');
    for (const marker of ['## Heading', 'bullet one', 'todo', 'a quote', 'const x = 1;', 'example.com']) {
      expect(raw).toContain(marker);
    }
  });

  test('nested lists and task lists round-trip', async ({ window, vaultDir }) => {
    const id = 'c4000000-0000-4000-8000-000000000001';
    const body = ['- top', '  - nested one', '  - nested two', '', '- [ ] open', '- [x] closed'].join(
      '\n',
    );
    fs.writeFileSync(path.join(vaultDir, 'Lists.md'), externalNote(id, 'Lists', body));

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('nested one');
    const content = (await getDocumentFromDb(window, id))!.content;
    expect(content).toContain('nested two');
    expect(content).toContain('open');
    expect(content).toContain('closed');
  });

  test('a body of horizontal rules is not mistaken for frontmatter', async ({ window, vaultDir }) => {
    const id = 'c5000000-0000-4000-8000-000000000001';
    const body = ['section one', '', '---', '', 'section two'].join('\n');
    fs.writeFileSync(path.join(vaultDir, 'Rules.md'), externalNote(id, 'Rules', body));

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('section two');
    const content = (await getDocumentFromDb(window, id))!.content;
    expect(content).toContain('section one');
    // The exporter canonicalizes a thematic break to `***`.
    expect(content).toContain('***');
  });

  test('unknown frontmatter keys are ignored', async ({ window, vaultDir }) => {
    const id = 'c6000000-0000-4000-8000-000000000001';
    const raw = [
      '---',
      `id: "${id}"`,
      'title: "Extra Keys"',
      'created: "2024-01-01T00:00:00.000Z"',
      'updated: "2024-01-02T00:00:00.000Z"',
      'content_schema_version: 1',
      'custom_field: "ignored"',
      'weird: [not, really, yaml]',
      '---',
      '',
      'body with extras',
    ].join('\n');
    fs.writeFileSync(path.join(vaultDir, 'Extra Keys.md'), raw);

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('body with extras');
    expect((await getDocumentFromDb(window, id))!.title).toBe('Extra Keys');
  });

  test('a very long body persists', async ({ window, vaultDir }) => {
    const id = 'c7000000-0000-4000-8000-000000000001';
    const body = Array.from({ length: 400 }, (_, i) => `line ${i} of a long note`).join('\n');
    fs.writeFileSync(path.join(vaultDir, 'Long.md'), externalNote(id, 'Long', body));

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('line 399 of a long note');
  });
});

test.describe('Reliability', () => {
  test('notes survive deletion of the entire vault and are re-exported', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');

    const first = await launchLychee({ userDataDir, vaultDir });
    const firstWindow = await firstWindowReady(first);
    await createNote(firstWindow, 'Recover Me');
    await waitForFile(path.join(vaultDir, 'Recover Me.md'));
    await first.close();

    // Catastrophe: the whole vault folder goes away.
    fs.rmSync(vaultDir, { recursive: true, force: true });

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect(noteItem(secondWindow, 'Recover Me')).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        async () => (await listDocumentsFromDb(secondWindow)).some((doc) => doc.title === 'Recover Me'),
        { timeout: 15_000 },
      )
      .toBe(true);
    // The file is re-created from the database, not lost.
    await waitForFile(path.join(vaultDir, 'Recover Me.md'));
    await second.close();
  });

  test('an extremely long title is preserved and the filename is byte-capped', async ({
    window,
    vaultDir,
  }) => {
    const longTitle = 'L'.repeat(260);
    await createNote(window, 'Short');
    await visibleTitle(window).click();
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.keyboard.press(`${mod}+A`);
    await window.keyboard.insertText(longTitle);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(800);

    await expect
      .poll(
        async () =>
          (await listDocumentsFromDb(window)).some((doc) => doc.title === longTitle),
        { timeout: 15_000 },
      )
      .toBe(true);

    const files = listMarkdown(vaultDir);
    const match = files.find((rel) => rel.startsWith('L'.repeat(20)));
    expect(match).toBeTruthy();
    const stem = match!.replace(/\.md$/i, '');
    expect(Buffer.byteLength(stem, 'utf8')).toBeLessThanOrEqual(200);
    expect(readNote(vaultDir, match!).data.title).toBe(longTitle);
  });
});
