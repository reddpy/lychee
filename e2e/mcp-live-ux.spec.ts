import path from 'path';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { test, expect, firstWindowReady, launchLychee } from './electron-app';
import { joinNoteAsPeer } from '../src/mcp/bridge-peer';
import {
  appendLive,
  editorBlocks,
  imageCount,
  INLINE_IMAGE,
  openLiveNote,
  renderedImageCount,
  replaceLive,
  syncSocketPath,
  updateLive,
  waitForSyncSocket,
} from './mcp-live-helpers';
import { noteItem, typeInBody, readRaw, waitForContent, writeNote } from './vault-helpers';

/**
 * Live MCP editing, end to end through a real app instance.
 *
 * Each test drives `editNoteLive` exactly the way an MCP tool does (see
 * `src/mcp/server.ts`) and asserts what the *user* sees in the editor and what
 * lands in the durable markdown file.
 */
test.use({ yjsFlag: true });

test.describe('MCP live editing — content constructs', () => {
  test('append paragraph appears live and in the file', async ({ window, vaultDir, testDir }) => {
    const { docId, body } = await openLiveNote(window, 'Append Paragraph');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    expect(await appendLive(vaultDir, socket, docId, 'a plain paragraph')).not.toBeNull();

    await expect(body).toContainText('a plain paragraph');
    await waitForContent(vaultDir, 'Append Paragraph.md', 'a plain paragraph');
  });

  test('append heading renders as a heading', async ({ window, vaultDir, testDir }) => {
    const { docId, body } = await openLiveNote(window, 'Append Heading');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    expect(await appendLive(vaultDir, socket, docId, '## Section Title')).not.toBeNull();

    await expect(body.locator('h2').filter({ hasText: 'Section Title' })).toBeVisible();
    await waitForContent(vaultDir, 'Append Heading.md', '## Section Title');
  });

  test('append bullet + numbered lists', async ({ window, vaultDir, testDir }) => {
    const { docId, body } = await openLiveNote(window, 'Append Lists');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    expect(await appendLive(vaultDir, socket, docId, '- one\n- two\n\n1. first\n2. second')).not.toBeNull();

    const blocks = await editorBlocks(window);
    expect(blocks).toContain('ul');
    expect(blocks).toContain('ol');
    await expect(body.locator('ul li')).toHaveCount(2);
    await expect(body.locator('ol li')).toHaveCount(2);
    await expect(body.locator('ul li').first()).toHaveText('one');
    await expect(body.locator('ol li').first()).toHaveText('first');
  });

  test('append blockquote, code block, and horizontal rule', async ({ window, vaultDir, testDir }) => {
    const { docId } = await openLiveNote(window, 'Append Blocks');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    expect(
      await appendLive(vaultDir, socket, docId, '> quoted\n\n```\nconst x = 1\n```\n\n---'),
    ).not.toBeNull();

    const blocks = await editorBlocks(window);
    expect(blocks).toContain('quote');
    expect(blocks).toContain('pre');
    expect(blocks).toContain('hr');
  });

  test('append table renders as a table', async ({ window, vaultDir, testDir }) => {
    const { docId, body } = await openLiveNote(window, 'Append Table');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    expect(
      await appendLive(vaultDir, socket, docId, '| A | B |\n| --- | --- |\n| 1 | 2 |'),
    ).not.toBeNull();

    expect(await editorBlocks(window)).toContain('table');
    await expect(body.locator('table')).toBeVisible();
  });

  test('append a remote image renders a reference image', async ({ window, vaultDir, testDir }) => {
    const { docId } = await openLiveNote(window, 'Append Image');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    expect(await appendLive(vaultDir, socket, docId, '![an image](https://example.com/pic.png)')).not.toBeNull();

    // Exactly one image block (catches duplication as well as absence).
    await expect.poll(() => imageCount(window), { timeout: 10_000 }).toBe(1);
    await waitForContent(vaultDir, 'Append Image.md', 'https://example.com/pic.png');
  });
});

test.describe('MCP live editing — image ordering (regression)', () => {
  test('image → text → image keeps document order in editor and file', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId } = await openLiveNote(window, 'Ordering');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);
    await typeInBody(window, 'intro text');

    expect(await appendLive(vaultDir, socket, docId, '![first](https://example.com/1.png)')).not.toBeNull();
    await expect.poll(() => imageCount(window)).toBe(1);
    expect(await appendLive(vaultDir, socket, docId, 'middle text')).not.toBeNull();
    await expect(window.locator('main:visible .ContentEditable__root')).toContainText('middle text');
    expect(await appendLive(vaultDir, socket, docId, '![second](https://example.com/2.png)')).not.toBeNull();
    await expect.poll(() => imageCount(window)).toBe(2);

    // Editor order: image, text, image.
    const order = await window.evaluate(() => {
      const root = document.querySelector('main .ContentEditable__root');
      return Array.from(root?.children ?? []).map((el) => {
        if (el.classList.contains('editor-image') || el.querySelector('.editor-image')) return 'IMG';
        return (el.textContent ?? '').trim().slice(0, 20);
      });
    });
    const firstImg = order.indexOf('IMG');
    const middle = order.indexOf('middle text');
    const secondImg = order.lastIndexOf('IMG');
    expect(firstImg).toBeGreaterThanOrEqual(0);
    expect(middle).toBeGreaterThan(firstImg);
    expect(secondImg).toBeGreaterThan(middle);

    // Durable file preserves the same order.
    await waitForContent(vaultDir, 'Ordering.md', 'example.com/2.png');
    await expect
      .poll(() => {
        const md = readRaw(vaultDir, 'Ordering.md');
        return (
          md.indexOf('example.com/1.png') < md.indexOf('middle text') &&
          md.indexOf('middle text') < md.indexOf('example.com/2.png')
        );
      })
      .toBe(true);
  });

  test('three appended images all persist (no duplication or drop)', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId } = await openLiveNote(window, 'Three Images');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    for (const n of [1, 2, 3]) {
      expect(await appendLive(vaultDir, socket, docId, `![img${n}](https://example.com/${n}.png)`)).not.toBeNull();
    }

    await expect.poll(() => imageCount(window), { timeout: 10_000 }).toBe(3);
    await waitForContent(vaultDir, 'Three Images.md', 'example.com/3.png');
    // All three refs are in the durable body, in order.
    const md = readRaw(vaultDir, 'Three Images.md');
    expect(md.indexOf('example.com/1.png')).toBeLessThan(md.indexOf('example.com/2.png'));
    expect(md.indexOf('example.com/2.png')).toBeLessThan(md.indexOf('example.com/3.png'));
  });
});

test.describe('MCP live editing — regression guards', () => {
  test('update_note that re-sends the title as a heading strips the duplicate', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Title Guard');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    expect(await updateLive(vaultDir, socket, docId, '# Title Guard\n\nnew body text')).not.toBeNull();

    await expect(body).toContainText('new body text');
    // The title is frontmatter/filename, never a body heading.
    await expect(body.locator('h1')).toHaveCount(0);
  });

});

test.describe('MCP live editing — replace and update', () => {
  test('replace_in_note swaps a substring live', async ({ window, vaultDir, testDir }) => {
    const { docId, body } = await openLiveNote(window, 'Replace');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);
    await typeInBody(window, 'color is red');

    expect(await replaceLive(vaultDir, socket, docId, 'red', 'blue')).not.toBeNull();

    await expect(body).toContainText('color is blue');
    await expect(body).not.toContainText('color is red');
    await waitForContent(vaultDir, 'Replace.md', 'color is blue');
  });

  test('update_note replaces the whole body live', async ({ window, vaultDir, testDir }) => {
    const { docId, body } = await openLiveNote(window, 'Whole Update');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);
    await typeInBody(window, 'old body');

    expect(await updateLive(vaultDir, socket, docId, '# brand new\n\nfresh content')).not.toBeNull();

    await expect(body).toContainText('fresh content');
    await expect(body).not.toContainText('old body');
    await waitForContent(vaultDir, 'Whole Update.md', 'fresh content');
  });

  test('refuses an edit that would drop a lychee-* block without permission', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Fence Guard');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);
    await appendLive(vaultDir, socket, docId, '![kept](https://example.com/kept.png)');
    await expect.poll(() => imageCount(window)).toBeGreaterThan(0);

    // Whole-body replace removing the reference fence must be refused.
    const result = await updateLive(vaultDir, socket, docId, 'just text, no reference');
    expect(result).toBeNull();
    await expect.poll(() => imageCount(window)).toBeGreaterThan(0);
    await expect(body).not.toContainText('just text, no reference');
  });
});

test.describe('MCP live editing — stress and robustness', () => {
  test('many sequential appends all land in order', async ({ window, vaultDir, testDir }) => {
    const { docId } = await openLiveNote(window, 'Stress Appends');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`);
    for (const line of lines) {
      expect(await appendLive(vaultDir, socket, docId, line)).not.toBeNull();
    }

    // Every line is present exactly once, in the order it was appended.
    const blocks = await editorBlocks(window);
    const positions = lines.map((line) => blocks.indexOf(line));
    expect(positions).not.toContain(-1);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
    for (const line of lines) {
      expect(blocks.filter((b) => b === line)).toHaveLength(1);
    }

    // And the durable file preserves the same order.
    await waitForContent(vaultDir, 'Stress Appends.md', 'line 12');
    const file = readRaw(vaultDir, 'Stress Appends.md');
    const filePositions = lines.map((line) => file.indexOf(line));
    expect(filePositions).not.toContain(-1);
    for (let i = 1; i < filePositions.length; i += 1) {
      expect(filePositions[i]).toBeGreaterThan(filePositions[i - 1]);
    }
  });

  test('a large append survives in full, not just its tail', async ({ window, vaultDir, testDir }) => {
    const { docId, body } = await openLiveNote(window, 'Large Append');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    const big = Array.from({ length: 80 }, (_, i) => `paragraph number ${i + 1}`).join('\n\n');
    expect(await appendLive(vaultDir, socket, docId, big)).not.toBeNull();

    await expect(body).toContainText('paragraph number 80', { timeout: 15_000 });
    await waitForContent(vaultDir, 'Large Append.md', 'paragraph number 80');

    // All 80 paragraphs present exactly once — a tail-only check would miss the
    // early ones surviving.
    const paragraphs = (await editorBlocks(window)).filter((b) => b.startsWith('paragraph number '));
    expect(paragraphs).toHaveLength(80);
    expect(paragraphs[0]).toBe('paragraph number 1');
    expect(paragraphs[79]).toBe('paragraph number 80');
  });

  test('unicode, emoji, and CJK round-trip', async ({ window, vaultDir, testDir }) => {
    const { docId, body } = await openLiveNote(window, 'Unicode');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    const text = 'café 🚀 日本語 Ω — em dash';
    expect(await appendLive(vaultDir, socket, docId, text)).not.toBeNull();

    await expect(body).toContainText('日本語');
    await waitForContent(vaultDir, 'Unicode.md', '日本語');
  });

  test('append to a note that is not open falls back (returns null)', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    // A note that exists on disk but has no open tab / live doc.
    writeNote(vaultDir, 'Closed Note.md', { id: 'closed-note-id', title: 'Closed Note' }, 'body');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);
    // Ensure the app is up and a different note is open.
    await openLiveNote(window, 'Some Other Note');

    const result = await appendLive(vaultDir, socket, 'closed-note-id', 'should not go live');
    expect(result).toBeNull();
  });

  test('replace_in_note declines when the text is absent (null, unchanged)', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Replace Missing');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);
    await typeInBody(window, 'stable content');

    const result = await replaceLive(vaultDir, socket, docId, 'not-present', 'replacement');
    expect(result).toBeNull();
    await expect(body).toContainText('stable content');
    await expect(body).not.toContainText('replacement');
  });
});

test.describe('MCP live editing — presence and highlight', () => {
  test('the agent cursor appears while it edits and hides when the user acts', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Presence');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    await appendLive(vaultDir, socket, docId, 'agent wrote this');
    await expect(window.locator('[data-yjs-cursors]')).toContainText('Lychee Agent', {
      timeout: 10_000,
    });

    // The user edits: the agent caret steps aside.
    await body.click();
    await window.keyboard.type('x');
    await expect(window.locator('[data-yjs-cursors]')).not.toContainText('Lychee Agent', {
      timeout: 5_000,
    });
  });

  test('appended content is highlighted and the highlight is dismissed on click', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Highlight Click');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    await appendLive(vaultDir, socket, docId, 'highlighted addition');
    const highlighted = window.locator('main:visible .lychee-agent-added');
    await expect(highlighted).toHaveCount(1, { timeout: 10_000 });
    await expect(highlighted).toContainText('highlighted addition');

    await body.click();
    await expect(window.locator('main:visible .lychee-agent-added')).toHaveCount(0, {
      timeout: 5_000,
    });
  });

  test('Escape dismisses the highlight', async ({ window, vaultDir, testDir }) => {
    const { docId } = await openLiveNote(window, 'Highlight Escape');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    await appendLive(vaultDir, socket, docId, 'escape target');
    await expect(window.locator('main:visible .lychee-agent-added')).toHaveCount(1, {
      timeout: 10_000,
    });
    await window.keyboard.press('Escape');
    await expect(window.locator('main:visible .lychee-agent-added')).toHaveCount(0, {
      timeout: 5_000,
    });
  });

  test('typing dismisses the highlight', async ({ window, vaultDir, testDir }) => {
    const { docId, body } = await openLiveNote(window, 'Highlight Type');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    await appendLive(vaultDir, socket, docId, 'type target');
    await expect(window.locator('main:visible .lychee-agent-added')).toHaveCount(1, {
      timeout: 10_000,
    });

    await body.click();
    await window.keyboard.type('!');
    await expect(window.locator('main:visible .lychee-agent-added')).toHaveCount(0, {
      timeout: 5_000,
    });
  });

  test('only the appended block is highlighted, not existing content', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId } = await openLiveNote(window, 'Highlight Scope');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);
    await typeInBody(window, 'pre-existing text');

    await appendLive(vaultDir, socket, docId, 'brand new block');

    const highlighted = window.locator('main:visible .lychee-agent-added');
    await expect(highlighted).toHaveCount(1, { timeout: 10_000 });
    await expect(highlighted).toContainText('brand new block');
    await expect(highlighted).not.toContainText('pre-existing text');
  });
});


test.describe('MCP live editing — images are viewable and durable', () => {
  test('an appended inline image renders a real <img> and its source persists', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId } = await openLiveNote(window, 'Viewable Image');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    expect(await appendLive(vaultDir, socket, docId, `![dot](${INLINE_IMAGE})`)).not.toBeNull();

    // Actually rendered (not just an image block with an error placeholder).
    await expect.poll(() => renderedImageCount(window), { timeout: 10_000 }).toBe(1);
    // And the source survives into the durable markdown.
    await waitForContent(vaultDir, 'Viewable Image.md', INLINE_IMAGE);
  });

  test('update_note preserves an image source', async ({ window, vaultDir, testDir }) => {
    const { docId } = await openLiveNote(window, 'Update Image');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    expect(await updateLive(vaultDir, socket, docId, `![dot](${INLINE_IMAGE})`)).not.toBeNull();

    await expect.poll(() => renderedImageCount(window), { timeout: 10_000 }).toBe(1);
    await waitForContent(vaultDir, 'Update Image.md', INLINE_IMAGE);
  });

  test('mixed text / image / heading / list keeps document order', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId } = await openLiveNote(window, 'Mixed Order');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    await appendLive(vaultDir, socket, docId, 'intro text');
    await appendLive(vaultDir, socket, docId, `![one](${INLINE_IMAGE})`);
    await appendLive(vaultDir, socket, docId, '## Mid heading');
    await appendLive(vaultDir, socket, docId, `![two](${INLINE_IMAGE})`);
    await appendLive(vaultDir, socket, docId, '- list item');

    await expect.poll(() => renderedImageCount(window), { timeout: 10_000 }).toBe(2);
    const blocks = await editorBlocks(window);
    const intro = blocks.indexOf('intro text');
    const firstImg = blocks.indexOf('img');
    const heading = blocks.indexOf('h2');
    const secondImg = blocks.lastIndexOf('img');
    const list = blocks.indexOf('ul');
    expect(intro).toBeGreaterThanOrEqual(0);
    expect(firstImg).toBeGreaterThan(intro);
    expect(heading).toBeGreaterThan(firstImg);
    expect(secondImg).toBeGreaterThan(heading);
    expect(list).toBeGreaterThan(secondImg);
  });

  test('two appended images render and survive an app relaunch', async ({ testDir, vaultDir }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchLychee({ userDataDir, vaultDir, yjsFlag: true });
    const w1 = await firstWindowReady(first);
    const { docId } = await openLiveNote(w1, 'Relaunch Images');
    const socket = path.join(userDataDir, 'lychee-sync.sock');
    await waitForSyncSocket(socket);

    expect(await appendLive(vaultDir, socket, docId, `![one](${INLINE_IMAGE})`)).not.toBeNull();
    expect(await appendLive(vaultDir, socket, docId, `![two](${INLINE_IMAGE})`)).not.toBeNull();
    await expect.poll(() => renderedImageCount(w1), { timeout: 10_000 }).toBe(2);
    await first.close();

    const second = await launchLychee({ userDataDir, vaultDir, yjsFlag: true });
    const w2 = await firstWindowReady(second);
    await noteItem(w2, 'Relaunch Images').click();
    await expect.poll(() => renderedImageCount(w2), { timeout: 10_000 }).toBe(2);
    await second.close();
  });
});

test.describe('MCP live editing — highlight covers non-text blocks', () => {
  test('an appended image block is highlighted', async ({ window, vaultDir, testDir }) => {
    const { docId } = await openLiveNote(window, 'Highlight Image');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    expect(await appendLive(vaultDir, socket, docId, `![dot](${INLINE_IMAGE})`)).not.toBeNull();

    await expect(window.locator('main:visible .lychee-agent-added.editor-image')).toHaveCount(1, {
      timeout: 10_000,
    });
  });

  test('an appended table is highlighted', async ({ window, vaultDir, testDir }) => {
    const { docId } = await openLiveNote(window, 'Highlight Table');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    expect(
      await appendLive(vaultDir, socket, docId, '| A | B |\n| --- | --- |\n| 1 | 2 |'),
    ).not.toBeNull();

    await expect(
      window.locator('main:visible .lychee-agent-added').filter({ has: window.locator('table') }),
    ).toHaveCount(1, { timeout: 10_000 });
  });
});

test.describe('MCP live editing — undo, fences, concurrency', () => {
  test('user undo does not remove an agent edit (per-origin undo)', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Per Origin Undo');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);
    await typeInBody(window, 'user typed this');
    await expect(body).toContainText('user typed this');

    expect(await appendLive(vaultDir, socket, docId, 'AGENT ADDITION')).not.toBeNull();
    await expect(body).toContainText('AGENT ADDITION');

    // Undo tracks only this device's edits, so it must not remove the agent's.
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await body.click();
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(500);
    await expect(body).toContainText('AGENT ADDITION');
  });

  test('replace_in_note near a lychee block keeps the block', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId } = await openLiveNote(window, 'Fence Replace');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    expect(await appendLive(vaultDir, socket, docId, `![dot](${INLINE_IMAGE})`)).not.toBeNull();
    await expect.poll(() => renderedImageCount(window), { timeout: 10_000 }).toBe(1);

    // A targeted replacement (allowFenceChanges) must not drop the image block.
    expect(await replaceLive(vaultDir, socket, docId, 'dot', 'renamed dot')).not.toBeNull();

    await expect.poll(() => renderedImageCount(window), { timeout: 10_000 }).toBe(1);
    await waitForContent(vaultDir, 'Fence Replace.md', 'lychee-reference');
    await waitForContent(vaultDir, 'Fence Replace.md', 'renamed dot');
  });

  test('a user edit and a simultaneous agent edit both survive', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Concurrent Edit');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    await typeInBody(window, 'base line');
    await body.click();
    await window.keyboard.type(' USER-TYPED');
    const agent = appendLive(vaultDir, socket, docId, 'AGENT-CONCURRENT');
    expect(await agent).not.toBeNull();

    await expect(body).toContainText('AGENT-CONCURRENT', { timeout: 10_000 });
    await expect(body).toContainText('USER-TYPED');
    await waitForContent(vaultDir, 'Concurrent Edit.md', 'USER-TYPED');
    await waitForContent(vaultDir, 'Concurrent Edit.md', 'AGENT-CONCURRENT');
  });
});

test.describe('MCP live editing — multi-note isolation', () => {
  test('editing one note never touches another', async ({ window, vaultDir, testDir }) => {
    const a = await openLiveNote(window, 'Isolation A');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);
    expect(await appendLive(vaultDir, socket, a.docId, 'A-ONLY')).not.toBeNull();
    await waitForContent(vaultDir, 'Isolation A.md', 'A-ONLY');

    // Opening B leaves A mounted in its (hidden) tab.
    const b = await openLiveNote(window, 'Isolation B');
    expect(await appendLive(vaultDir, socket, b.docId, 'B-ONLY')).not.toBeNull();
    await expect(b.body).toContainText('B-ONLY');
    await expect(b.body).not.toContainText('A-ONLY');

    await waitForContent(vaultDir, 'Isolation B.md', 'B-ONLY');
    expect(readRaw(vaultDir, 'Isolation A.md')).not.toContain('B-ONLY');
    expect(readRaw(vaultDir, 'Isolation B.md')).not.toContain('A-ONLY');

    // Switching back shows A's own content, not B's.
    await noteItem(window, 'Isolation A').click();
    const active = window.locator('main:visible .ContentEditable__root');
    await expect(active).toContainText('A-ONLY');
    await expect(active).not.toContainText('B-ONLY');
  });

  test('a background note receives a live edit and shows it on return', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const a = await openLiveNote(window, 'Background A');
    await typeInBody(window, 'A base');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    await openLiveNote(window, 'Foreground B');
    await typeInBody(window, 'B base');

    // A is hidden but still bound, so the edit is live, not a file fallback.
    const result = await appendLive(vaultDir, socket, a.docId, 'A-BACKGROUND');
    expect(result).not.toBeNull();
    await waitForContent(vaultDir, 'Background A.md', 'A-BACKGROUND');

    // B (the visible note) is unaffected.
    const visibleB = window.locator('main:visible .ContentEditable__root');
    await expect(visibleB).toContainText('B base');
    await expect(visibleB).not.toContainText('A-BACKGROUND');

    await noteItem(window, 'Background A').click();
    const visibleA = window.locator('main:visible .ContentEditable__root');
    await expect(visibleA).toContainText('A-BACKGROUND');
    await expect(visibleA).not.toContainText('B base');
  });

  test('the agent cursor is scoped to the note it edits', async ({ window, vaultDir, testDir }) => {
    const a = await openLiveNote(window, 'Cursor Scope A');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);
    await appendLive(vaultDir, socket, a.docId, 'A cursor target');
    await expect(window.locator('main:visible [data-yjs-cursors]')).toContainText('Lychee Agent', {
      timeout: 10_000,
    });

    // Switching to B (edited by nobody) shows no agent cursor.
    await openLiveNote(window, 'Cursor Scope B');
    await expect(window.locator('main:visible [data-yjs-cursors]')).not.toContainText(
      'Lychee Agent',
      { timeout: 5_000 },
    );
  });
});

test.describe('MCP live editing — many notes and shared notes', () => {
  test('an agent edits several open notes with no cross-talk', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const socket = syncSocketPath(testDir);
    const a = await openLiveNote(window, 'Multi A');
    await waitForSyncSocket(socket);
    const b = await openLiveNote(window, 'Multi B');
    const c = await openLiveNote(window, 'Multi C');

    expect(await appendLive(vaultDir, socket, a.docId, 'A-DATA')).not.toBeNull();
    expect(await appendLive(vaultDir, socket, b.docId, 'B-DATA')).not.toBeNull();
    expect(await appendLive(vaultDir, socket, c.docId, 'C-DATA')).not.toBeNull();

    const notes: Array<[string, string]> = [
      ['Multi A', 'A-DATA'],
      ['Multi B', 'B-DATA'],
      ['Multi C', 'C-DATA'],
    ];
    for (const [title, own] of notes) {
      await noteItem(window, title).click();
      const active = window.locator('main:visible .ContentEditable__root');
      await expect(active).toContainText(own);
      for (const [otherTitle, other] of notes) {
        if (otherTitle !== title) await expect(active).not.toContainText(other);
      }
      await waitForContent(vaultDir, `${title}.md`, own);
    }
  });

  test('two collaborators on the same live note both appear and both edits land', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Shared Live');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    const one = await joinNoteAsPeer(socket, docId, { name: 'Agent One', settleMs: 250 });
    const two = await joinNoteAsPeer(socket, docId, { name: 'Agent Two', settleMs: 250 });
    expect(one && two).toBeTruthy();
    if (!one || !two) return;

    one.editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('FROM-ONE')));
      },
      { discrete: true },
    );
    one.publish();
    await expect(body).toContainText('FROM-ONE', { timeout: 10_000 });

    two.editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('FROM-TWO')));
      },
      { discrete: true },
    );
    two.publish();

    // Both edits land in the shared note, and both collaborators are present.
    await expect(body).toContainText('FROM-TWO', { timeout: 10_000 });
    await expect(body).toContainText('FROM-ONE');
    await waitForContent(vaultDir, 'Shared Live.md', 'FROM-ONE');
    await waitForContent(vaultDir, 'Shared Live.md', 'FROM-TWO');

    const overlay = window.locator('main:visible [data-yjs-cursors]');
    await expect(overlay).toContainText('Agent Two', { timeout: 10_000 });

    // Both collaborators are present on the note (awareness lists every peer,
    // independent of whether a caret happens to be rendered right now).
    await expect
      .poll(() =>
        window.evaluate(
          (id) =>
            ((window as any).__lycheeNoteSync?.awareness(id) ?? []).map(
              (state: { state?: { name?: string } }) => state.state?.name,
            ),
          docId,
        ),
      )
      .toEqual(expect.arrayContaining(['Agent One', 'Agent Two']));

    one.close();
    two.close();
  });
});
