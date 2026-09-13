import {
  test,
  expect,
  listDocumentsFromDb,
  getDocumentFromDb,
  launchLychee,
  firstWindowReady,
} from './electron-app';
import { readRaw, listMarkdown, frontmatterNote } from './vault-helpers';
import { serializeFrontmatter } from '../src/shared/frontmatter';

/**
 * Frontmatter parsing/serialization hardening. The vault format is a tiny
 * dependency-free YAML subset, so malformed or surprising frontmatter must
 * degrade safely: never crash, never import a non-note, never lose a file that
 * the app chose not to understand. Every file here is authored by the "OS".
 */

const ID = (n: string) => `f1000000-0000-4000-8000-0000000000${n}`;
const CREATED = '2024-01-01T00:00:00.000Z';
const UPDATED = '2024-02-02T00:00:00.000Z';

const NO_UPDATED = ID('01');
const NUMERIC_ID = ID('02');
const EMPTY_ID = ID('03');
const LEADING_SPACE = ID('04');
const UNTERMINATED = ID('05');
const UNQUOTED_ORDER = ID('06');
const QUOTED_ORDER = ID('07');
const NEGATIVE_ORDER = ID('08');
const FRACTIONAL_ORDER = ID('09');
const DUP_KEY = ID('0a');
const COMMENT_LINES = ID('0b');
const FRONTMATTER_ONLY = ID('0c');
const CRLF_FRONTMATTER = ID('0d');
const ARBITRARY_BOOKMARK = ID('0e');
const EMOJI_NOTE = ID('0f');
const UNKNOWN_KEY = ID('10');
const NEWER_SCHEMA = ID('11');
const SYMBOL_ID = 'id with spaces & symbols !@#$%';

/** Every id in FILES that must successfully import. */
const VALID_IDS = [
  NO_UPDATED,
  UNQUOTED_ORDER,
  QUOTED_ORDER,
  NEGATIVE_ORDER,
  FRACTIONAL_ORDER,
  DUP_KEY,
  COMMENT_LINES,
  FRONTMATTER_ONLY,
  CRLF_FRONTMATTER,
  ARBITRARY_BOOKMARK,
  EMOJI_NOTE,
  UNKNOWN_KEY,
  NEWER_SCHEMA,
  SYMBOL_ID,
];

/**
 * Anchor for the negative (ignored-file) assertions: wait until the entire
 * directory scan has been consumed by the watcher — proven by every valid file
 * being imported — so an absent id means "classified and ignored", not
 * "not processed yet".
 */
async function waitForAllValid(window: Parameters<typeof listDocumentsFromDb>[0]): Promise<void> {
  await expect
    .poll(
      async () => {
        const ids = new Set((await listDocumentsFromDb(window)).map((doc) => doc.id));
        return VALID_IDS.every((id) => ids.has(id));
      },
      { timeout: 20_000 },
    )
    .toBe(true);
}

const FILES: Record<string, string> = {
  'no-updated.md': [
    '---',
    `id: "${NO_UPDATED}"`,
    `created: "${CREATED}"`,
    'content_schema_version: 1',
    '---',
    '',
    'body without an updated stamp',
  ].join('\n'),
  'numeric-id.md': ['---', 'id: 12345', `created: "${CREATED}"`, '---', 'numeric id'].join('\n'),
  'empty-id.md': ['---', 'id: ""', `created: "${CREATED}"`, '---', 'empty id'].join('\n'),
  'leading-space.md': [
    '  ---',
    `id: "${LEADING_SPACE}"`,
    `created: "${CREATED}"`,
    '---',
    'indented delimiter',
  ].join('\n'),
  'unterminated.md': [`---\nid: "${UNTERMINATED}"\ncreated: "${CREATED}"\n\nnever closed`].join('\n'),
  'unquoted-order.md': [
    '---',
    `id: "${UNQUOTED_ORDER}"`,
    `created: "${CREATED}"`,
    `updated: "${UPDATED}"`,
    'content_schema_version: 1',
    'order: 5',
    '---',
    'x',
  ].join('\n'),
  'quoted-order.md': [
    '---',
    `id: "${QUOTED_ORDER}"`,
    `created: "${CREATED}"`,
    `updated: "${UPDATED}"`,
    'content_schema_version: 1',
    'order: "9"',
    '---',
    'x',
  ].join('\n'),
  'negative-order.md': [
    '---',
    `id: "${NEGATIVE_ORDER}"`,
    `created: "${CREATED}"`,
    `updated: "${UPDATED}"`,
    'content_schema_version: 1',
    'order: -3',
    '---',
    'x',
  ].join('\n'),
  'fractional-order.md': [
    '---',
    `id: "${FRACTIONAL_ORDER}"`,
    `created: "${CREATED}"`,
    `updated: "${UPDATED}"`,
    'content_schema_version: 1',
    'order: 2.7',
    '---',
    'x',
  ].join('\n'),
  'dup-key.md': [
    '---',
    `id: "${DUP_KEY}"`,
    `created: "${CREATED}"`,
    `updated: "${UPDATED}"`,
    'content_schema_version: 1',
    'order: 1',
    'order: 4',
    '---',
    'x',
  ].join('\n'),
  'comment-lines.md': [
    '---',
    '# this is a comment',
    `id: "${COMMENT_LINES}"`,
    `created: "${CREATED}"`,
    `updated: "${UPDATED}"`,
    '# another comment: ignored',
    'content_schema_version: 1',
    '---',
    'x',
  ].join('\n'),
  'frontmatter-only.md': [
    '---',
    `id: "${FRONTMATTER_ONLY}"`,
    `created: "${CREATED}"`,
    `updated: "${UPDATED}"`,
    'content_schema_version: 1',
    '---',
    '',
  ].join('\n'),
  'crlf-frontmatter.md': frontmatterNote(
    { id: CRLF_FRONTMATTER, title: 'CRLF Frontmatter' },
    'crlf body',
  ).replace(/\n/g, '\r\n'),
  'arbitrary-bookmark.md': [
    '---',
    `id: "${ARBITRARY_BOOKMARK}"`,
    'bookmarked: "not-a-real-date"',
    `created: "${CREATED}"`,
    `updated: "${UPDATED}"`,
    'content_schema_version: 1',
    '---',
    'x',
  ].join('\n'),
  'emoji.md': [
    '---',
    `id: "${EMOJI_NOTE}"`,
    'emoji: "🦄"',
    `created: "${CREATED}"`,
    `updated: "${UPDATED}"`,
    'content_schema_version: 1',
    '---',
    'x',
  ].join('\n'),
  'unknown-key.md': [
    '---',
    `id: "${UNKNOWN_KEY}"`,
    'title: "Unknown Key"',
    'custom_unknown_key: keep-me-please',
    `created: "${CREATED}"`,
    `updated: "${UPDATED}"`,
    'content_schema_version: 1',
    '---',
    'body',
  ].join('\n'),
  'newer-schema.md': [
    '---',
    `id: "${NEWER_SCHEMA}"`,
    `created: "${CREATED}"`,
    `updated: "${UPDATED}"`,
    'content_schema_version: 99',
    '---',
    'future content',
  ].join('\n'),
  'symbol-id.md': serializeFrontmatter({
    id: SYMBOL_ID,
    created: CREATED,
    updated: UPDATED,
    contentSchemaVersion: 1,
  })
    .concat('\n')
    .concat('symbol body'),
};

test.use({ vaultExtra: FILES });

test.describe('Frontmatter hardening', () => {
  test('falls back to `created` when `updated` is absent', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, NO_UPDATED))?.updatedAt, {
        timeout: 15_000,
      })
      .toBe(CREATED);
  });

  test('ignores a numeric (non-string) id', async ({ window, vaultDir }) => {
    await waitForAllValid(window);
    expect(await getDocumentFromDb(window, '12345')).toBeNull();
    expect(listMarkdown(vaultDir)).toContain('numeric-id.md');
    expect(readRaw(vaultDir, 'numeric-id.md')).toContain('id: 12345');
  });

  test('ignores an empty-string id', async ({ window, vaultDir }) => {
    await waitForAllValid(window);
    expect((await listDocumentsFromDb(window)).some((doc) => doc.id === EMPTY_ID)).toBe(false);
    expect(listMarkdown(vaultDir)).toContain('empty-id.md');
  });

  test('ignores a file with leading whitespace before the delimiter', async ({
    window,
    vaultDir,
  }) => {
    await waitForAllValid(window);
    expect((await listDocumentsFromDb(window)).some((doc) => doc.id === LEADING_SPACE)).toBe(
      false,
    );
    expect(listMarkdown(vaultDir)).toContain('leading-space.md');
  });

  test('ignores an unterminated frontmatter block', async ({ window, vaultDir }) => {
    await waitForAllValid(window);
    expect((await listDocumentsFromDb(window)).some((doc) => doc.id === UNTERMINATED)).toBe(false);
    expect(listMarkdown(vaultDir)).toContain('unterminated.md');
  });

  test('reads an unquoted numeric order', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, UNQUOTED_ORDER))?.sortOrder, {
        timeout: 15_000,
      })
      .toBe(5);
  });

  test('ignores a quoted numeric order', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, QUOTED_ORDER))?.sortOrder, {
        timeout: 15_000,
      })
      .toBe(0);
  });

  test('clamps a negative order to zero', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, NEGATIVE_ORDER))?.sortOrder, {
        timeout: 15_000,
      })
      .toBe(0);
  });

  test('floors a fractional order', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, FRACTIONAL_ORDER))?.sortOrder, {
        timeout: 15_000,
      })
      .toBe(2);
  });

  test('takes the last value for a duplicated frontmatter key', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, DUP_KEY))?.sortOrder, { timeout: 15_000 })
      .toBe(4);
  });

  test('ignores comment lines inside frontmatter', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, COMMENT_LINES))?.title, { timeout: 15_000 })
      .toBe('comment-lines');
  });

  test('imports a frontmatter-only file as a blank body', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, FRONTMATTER_ONLY)) != null, {
        timeout: 15_000,
      })
      .toBe(true);
    expect((await getDocumentFromDb(window, FRONTMATTER_ONLY))!.content).toBe('');
  });

  test('handles CRLF line endings in the frontmatter block', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, CRLF_FRONTMATTER))?.title, {
        timeout: 15_000,
      })
      .toBe('CRLF Frontmatter');
  });

  test('adopts an arbitrary bookmark string without validation', async ({ window }) => {
    await expect
      .poll(
        async () =>
          (await getDocumentFromDb(window, ARBITRARY_BOOKMARK))?.metadata?.bookmarkedAt ?? null,
        { timeout: 15_000 },
      )
      .toBe('not-a-real-date');
  });

  test('adopts a unicode emoji from frontmatter', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, EMOJI_NOTE))?.emoji, { timeout: 15_000 })
      .toBe('🦄');
  });

  test('drops unknown frontmatter keys when it rewrites the file', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, UNKNOWN_KEY))?.title, { timeout: 15_000 })
      .toBe('Unknown Key');
    await expect
      .poll(() => readRaw(vaultDir, 'unknown-key.md').includes('custom_unknown_key'), {
        timeout: 10_000,
      })
      .toBe(false);
    // The known fields survive.
    expect(readRaw(vaultDir, 'unknown-key.md')).toContain(`id: "${UNKNOWN_KEY}"`);
  });

  test('blocks a content overwrite for a newer content schema', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, NEWER_SCHEMA))?.title, { timeout: 15_000 })
      .toBe('newer-schema');

    const error = await window.evaluate(
      async (id) => {
        try {
          await (window as any).lychee.invoke('documents.update', { id, content: 'clobber' });
          return null;
        } catch (caught) {
          return String((caught as Error)?.message ?? caught);
        }
      },
      NEWER_SCHEMA,
    );
    expect(error).toContain('newer content schema');
  });

  test('preserves an id containing spaces and symbols', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, SYMBOL_ID))?.id, { timeout: 15_000 })
      .toBe(SYMBOL_ID);
  });
});

test.describe('Frontmatter hardening — relaunch', () => {
  test('frontmatter quirks survive a full relaunch', async ({ testDir, vaultDir }) => {
    const userDataDir = `${testDir}/userdata`;
    const first = await launchLychee({ userDataDir, vaultDir });
    const firstWindow = await firstWindowReady(first);
    await expect
      .poll(async () => (await getDocumentFromDb(firstWindow, DUP_KEY))?.sortOrder, {
        timeout: 15_000,
      })
      .toBe(4);
    await first.close();

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(secondWindow, DUP_KEY))?.sortOrder, {
        timeout: 15_000,
      })
      .toBe(4);
    expect((await getDocumentFromDb(secondWindow, QUOTED_ORDER))!.sortOrder).toBe(0);
    await second.close();
  });
});
