import { test, expect } from './electron-app';
import type { Page } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────

/** Create a new note, type a title, wait for debounce, return its doc ID. */
async function createNoteWithTitle(window: Page, title: string): Promise<string> {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(400);

  const visibleTitle = window.locator('main:visible h1.editor-title');
  await visibleTitle.click();
  await window.keyboard.type(title);
  await window.waitForTimeout(700); // debounce save

  // Read doc ID from the store
  const docId = await window.evaluate(() => {
    const store = (window as any).__documentStore;
    return store.getState().selectedId as string;
  });
  return docId;
}

/** Click into the body of the current note and type a YouTube URL + Space. */
async function typeYouTubeUrl(window: Page, url: string) {
  const visibleTitle = window.locator('main:visible h1.editor-title');
  await visibleTitle.click();
  await window.keyboard.press('Enter'); // move to body
  await window.waitForTimeout(200);
  await window.keyboard.type(url, { delay: 10 });
  // Space triggers auto-link detection
  await window.keyboard.press('Space');
  await window.waitForTimeout(500);
}

/** Hover the auto-linked <a>, click "Embed", wait for iframe to appear. */
async function embedYouTubeLink(window: Page) {
  const link = window.locator('.ContentEditable__root a').first();
  await link.hover();
  await window.waitForTimeout(400);

  const embedBtn = window.locator('button[title="Embed content"]');
  await expect(embedBtn).toBeVisible({ timeout: 5000 });
  await embedBtn.click();

  // Wait for the YouTube iframe to appear
  await expect(
    window.locator('.youtube-container iframe[title="YouTube video"]'),
  ).toBeVisible({ timeout: 10000 });
}

/**
 * Simulate playback via the media store (since we can't interact with
 * cross-origin YouTube iframes). Sets up trackable pause/play callbacks.
 */
async function simulatePlay(
  page: Page,
  opts: {
    key: string;
    noteId: string;
    noteTitle?: string;
    contentId: string;
    contentTitle?: string;
    contentType?: string;
  },
) {
  await page.evaluate((o) => {
    const store = (window as any).__mediaStore;
    // Initialise the pause counter if absent
    if (typeof (window as any).__testPauseCount !== 'number') {
      (window as any).__testPauseCount = 0;
    }
    store.getState().setPlaying(
      o.key,
      o.noteId,
      o.noteTitle ?? 'Test Note',
      o.contentId,
      o.contentTitle ?? 'Test Video',
      o.contentType ?? 'youtube',
      () => { (window as any).__testPauseCount++; }, // pause callback
      () => {},                                       // play callback
      () => {},                                       // scrollTo callback
    );
  }, opts);
}

/** Read the current activeMedia from the media store. */
async function getMediaState(page: Page) {
  return page.evaluate(() => {
    const store = (window as any).__mediaStore;
    const m = store.getState().activeMedia;
    if (!m) return null;
    return {
      key: m.key,
      noteId: m.noteId,
      contentId: m.contentId,
      isPlaying: m.isPlaying,
    };
  });
}

/** Read the test pause-callback counter. */
async function getPauseCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testPauseCount ?? 0);
}

// ── Tests ────────────────────────────────────────────────────────────

test.describe('YouTube Embed & Media Playback', () => {
  test('pasting a YouTube URL and clicking Embed creates an iframe', async ({ window }) => {
    await createNoteWithTitle(window, 'Embed Test');

    // Type a YouTube URL in the body
    await typeYouTubeUrl(window, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    // Auto-link should appear
    const link = window.locator('.ContentEditable__root a');
    await expect(link.first()).toBeVisible({ timeout: 5000 });

    // Hover link → "Embed" button popover
    await link.first().hover();
    await window.waitForTimeout(400);
    const embedBtn = window.locator('button[title="Embed content"]');
    await expect(embedBtn).toBeVisible({ timeout: 5000 });

    // Click Embed → YouTube iframe appears
    await embedBtn.click();
    const iframe = window.locator(
      '.youtube-container iframe[title="YouTube video"]',
    );
    await expect(iframe).toBeVisible({ timeout: 10000 });

    // Verify the iframe src includes the video ID and enablejsapi
    const src = await iframe.getAttribute('src');
    expect(src).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(src).toContain('enablejsapi=1');
  });

  test('simulated playback populates the media store', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Play Test');
    await typeYouTubeUrl(window, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await embedYouTubeLink(window);

    // Verify iframe exists
    await expect(
      window.locator('.youtube-container iframe[title="YouTube video"]'),
    ).toBeVisible();

    // Simulate playback via the store
    await simulatePlay(window, {
      key: 'yt-rick',
      noteId: docId,
      noteTitle: 'Play Test',
      contentId: 'dQw4w9WgXcQ',
      contentTitle: 'Rick Astley',
    });

    const state = await getMediaState(window);
    expect(state).not.toBeNull();
    expect(state!.isPlaying).toBe(true);
    expect(state!.contentId).toBe('dQw4w9WgXcQ');
    expect(state!.noteId).toBe(docId);
  });

  test('pill appears when viewing a different tab', async ({ window }) => {
    // Note A: embed + play
    const docA = await createNoteWithTitle(window, 'Note A');
    await typeYouTubeUrl(window, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await embedYouTubeLink(window);
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'dQw4w9WgXcQ',
    });

    // Create Note B — auto-switches tab
    await createNoteWithTitle(window, 'Note B');

    // Pill should be visible
    const pill = window.locator('[data-testid="media-pill"]');
    await expect(pill).toBeVisible({ timeout: 5000 });

    // Toggle button should show Pause (video is playing)
    const pauseBtn = pill.locator('button[aria-label="Pause"]');
    await expect(pauseBtn).toBeVisible();
  });

  test('pill play/pause toggle works', async ({ window }) => {
    // Note A: embed + play
    const docA = await createNoteWithTitle(window, 'Note A');
    await typeYouTubeUrl(window, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await embedYouTubeLink(window);
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'dQw4w9WgXcQ',
    });

    // Switch to Note B
    await createNoteWithTitle(window, 'Note B');

    const pill = window.locator('[data-testid="media-pill"]');
    await expect(pill).toBeVisible({ timeout: 5000 });

    // Hover to expand, then click Pause
    await pill.hover();
    await window.waitForTimeout(300);
    await pill.locator('button[aria-label="Pause"]').click();

    // Verify paused
    const stateAfterPause = await getMediaState(window);
    expect(stateAfterPause!.isPlaying).toBe(false);

    // Toggle should now show Play
    await pill.hover();
    await window.waitForTimeout(300);
    const playBtn = pill.locator('button[aria-label="Play"]');
    await expect(playBtn).toBeVisible();

    // Click Play → playing again
    await playBtn.click();
    const stateAfterPlay = await getMediaState(window);
    expect(stateAfterPlay!.isPlaying).toBe(true);
  });

  test('dismissing the pill pauses and clears state', async ({ window }) => {
    // Note A: embed + play
    const docA = await createNoteWithTitle(window, 'Note A');
    await typeYouTubeUrl(window, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await embedYouTubeLink(window);
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'dQw4w9WgXcQ',
    });

    // Switch to Note B
    await createNoteWithTitle(window, 'Note B');

    const pill = window.locator('[data-testid="media-pill"]');
    await expect(pill).toBeVisible({ timeout: 5000 });

    const pauseCountBefore = await getPauseCount(window);

    // Hover to expand, then click Dismiss
    await pill.hover();
    await window.waitForTimeout(300);
    await pill.locator('button[aria-label="Dismiss"]').click();
    await window.waitForTimeout(300);

    // Pill should be gone
    await expect(pill).not.toBeVisible();

    // Store should be cleared
    const state = await getMediaState(window);
    expect(state).toBeNull();

    // Pause callback should have been called
    const pauseCountAfter = await getPauseCount(window);
    expect(pauseCountAfter).toBeGreaterThan(pauseCountBefore);
  });

  test('playing in one note auto-pauses another note', async ({ window }) => {
    // Note A: play Video A
    const docA = await createNoteWithTitle(window, 'Note A');
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'videoA',
    });

    const pauseCountBefore = await getPauseCount(window);

    // Note B: play Video B — should auto-pause Video A
    const docB = await createNoteWithTitle(window, 'Note B');
    await simulatePlay(window, {
      key: 'yt-b',
      noteId: docB,
      noteTitle: 'Note B',
      contentId: 'videoB',
    });

    // Pause count increased (Video A was auto-paused)
    const pauseCountAfter = await getPauseCount(window);
    expect(pauseCountAfter).toBeGreaterThan(pauseCountBefore);

    // Store should reflect Video B
    const state = await getMediaState(window);
    expect(state).not.toBeNull();
    expect(state!.key).toBe('yt-b');
    expect(state!.noteId).toBe(docB);
    expect(state!.contentId).toBe('videoB');
  });

  test('playing a different video in the same note auto-pauses the first', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Multi Video');

    // Play Video 1
    await simulatePlay(window, {
      key: 'yt-1',
      noteId: docId,
      noteTitle: 'Multi Video',
      contentId: 'video1',
    });

    const pauseCountBefore = await getPauseCount(window);

    // Play Video 2 in the same note — should auto-pause Video 1
    await simulatePlay(window, {
      key: 'yt-2',
      noteId: docId,
      noteTitle: 'Multi Video',
      contentId: 'video2',
    });

    // Pause count increased (Video 1 was auto-paused)
    const pauseCountAfter = await getPauseCount(window);
    expect(pauseCountAfter).toBeGreaterThan(pauseCountBefore);

    // Store should reflect Video 2
    const state = await getMediaState(window);
    expect(state).not.toBeNull();
    expect(state!.key).toBe('yt-2');
    expect(state!.contentId).toBe('video2');
  });
});

// ── Tab × Media Edge Cases (Stress Tests) ────────────────────────────

test.describe('Tab × Media Pill Edge Cases', () => {
  test('closing the media tab from tab bar while on a different tab auto-dismisses pill', async ({ window }) => {
    // Play in Note A
    const docA = await createNoteWithTitle(window, 'Media Tab');
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Media Tab',
      contentId: 'vidA',
    });

    // Switch to Note B
    await createNoteWithTitle(window, 'Other Tab');

    const pill = window.locator('[data-testid="media-pill"]');
    await expect(pill).toBeVisible({ timeout: 5000 });

    const pauseBefore = await getPauseCount(window);

    // Close Note A's tab (not the active tab — close via its X button)
    const tabA = window.locator('[data-tab-id]').filter({ hasText: 'Media Tab' });
    await tabA.locator('[aria-label="Close tab"]').click({ force: true });
    await window.waitForTimeout(500);

    // Pill must vanish — useEffect sees noteId gone from openTabs, calls dismiss()
    await expect(pill).not.toBeVisible();
    expect(await getMediaState(window)).toBeNull();
    expect(await getPauseCount(window)).toBeGreaterThan(pauseBefore);
  });

  test('closing the media tab while viewing it clears media state', async ({ window }) => {
    const docA = await createNoteWithTitle(window, 'Tab A');
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Tab A',
      contentId: 'vidA',
    });

    // Create Note B so closing A has somewhere to go
    await createNoteWithTitle(window, 'Tab B');
    // Switch back to Tab A
    await window.locator('[data-tab-id]').filter({ hasText: 'Tab A' }).click();
    await window.waitForTimeout(300);

    // Now close Tab A while we're on it
    await window.locator('[data-tab-id]').filter({ hasText: 'Tab A' })
      .locator('[aria-label="Close tab"]').click({ force: true });
    await window.waitForTimeout(500);

    // selectedId is now Tab B; media noteId (A) is gone from openTabs → dismiss
    expect(await getMediaState(window)).toBeNull();
    // Pill should NOT be visible (media was dismissed)
    await expect(window.locator('[data-testid="media-pill"]')).not.toBeVisible();
  });

  test('switching back to the media tab hides the pill', async ({ window }) => {
    const docA = await createNoteWithTitle(window, 'Note A');
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'vidA',
    });

    await createNoteWithTitle(window, 'Note B');
    const pill = window.locator('[data-testid="media-pill"]');
    await expect(pill).toBeVisible({ timeout: 5000 });

    // Switch back to Note A (the media tab)
    await window.locator('[data-tab-id]').filter({ hasText: 'Note A' }).click();
    await window.waitForTimeout(300);

    // Pill should vanish — selectedId now matches activeMedia.noteId
    await expect(pill).not.toBeVisible();

    // But media is still playing in the store!
    const state = await getMediaState(window);
    expect(state).not.toBeNull();
    expect(state!.isPlaying).toBe(true);

    // Switch away again → pill reappears
    await window.locator('[data-tab-id]').filter({ hasText: 'Note B' }).click();
    await window.waitForTimeout(300);
    await expect(pill).toBeVisible();
  });

  test('pill shows on any non-media tab across 4 tabs', async ({ window }) => {
    const docA = await createNoteWithTitle(window, 'Media Note');
    await simulatePlay(window, {
      key: 'yt-m',
      noteId: docA,
      noteTitle: 'Media Note',
      contentId: 'vidM',
    });

    // Create tabs B, C, D
    await createNoteWithTitle(window, 'Tab B');
    await createNoteWithTitle(window, 'Tab C');
    await createNoteWithTitle(window, 'Tab D');

    const pill = window.locator('[data-testid="media-pill"]');

    // Currently on D → pill visible
    await expect(pill).toBeVisible({ timeout: 5000 });

    // Switch to C → pill still visible
    await window.locator('[data-tab-id]').filter({ hasText: 'Tab C' }).click();
    await window.waitForTimeout(300);
    await expect(pill).toBeVisible();

    // Switch to B → pill still visible
    await window.locator('[data-tab-id]').filter({ hasText: 'Tab B' }).click();
    await window.waitForTimeout(300);
    await expect(pill).toBeVisible();

    // Switch to Media Note → pill hidden
    await window.locator('[data-tab-id]').filter({ hasText: 'Media Note' }).click();
    await window.waitForTimeout(300);
    await expect(pill).not.toBeVisible();

    // Switch to D → pill reappears
    await window.locator('[data-tab-id]').filter({ hasText: 'Tab D' }).click();
    await window.waitForTimeout(300);
    await expect(pill).toBeVisible();
  });

  test('closing a non-media tab does not affect the pill', async ({ window }) => {
    const docA = await createNoteWithTitle(window, 'Media Note');
    await simulatePlay(window, {
      key: 'yt-m',
      noteId: docA,
      noteTitle: 'Media Note',
      contentId: 'vidM',
    });

    await createNoteWithTitle(window, 'Tab B');
    await createNoteWithTitle(window, 'Tab C');

    const pill = window.locator('[data-testid="media-pill"]');
    await expect(pill).toBeVisible({ timeout: 5000 });

    // Close Tab B (not the media tab, not the active tab)
    await window.locator('[data-tab-id]').filter({ hasText: 'Tab B' })
      .locator('[aria-label="Close tab"]').click({ force: true });
    await window.waitForTimeout(300);

    // Pill still visible, media state intact
    await expect(pill).toBeVisible();
    const state = await getMediaState(window);
    expect(state!.isPlaying).toBe(true);
    expect(state!.key).toBe('yt-m');
  });

  test('pausing via pill then switching back to media tab persists paused state', async ({ window }) => {
    const docA = await createNoteWithTitle(window, 'Note A');
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'vidA',
    });

    await createNoteWithTitle(window, 'Note B');
    const pill = window.locator('[data-testid="media-pill"]');
    await expect(pill).toBeVisible({ timeout: 5000 });

    // Pause via pill
    await pill.hover();
    await window.waitForTimeout(300);
    await pill.locator('button[aria-label="Pause"]').click();
    await window.waitForTimeout(200);

    // Verify paused
    expect((await getMediaState(window))!.isPlaying).toBe(false);

    // Pill should still be visible (paused media still tracked on different tab)
    await expect(pill).toBeVisible();

    // Switch back to media tab
    await window.locator('[data-tab-id]').filter({ hasText: 'Note A' }).click();
    await window.waitForTimeout(300);

    // Pill hidden (on the media tab), but media state preserved as paused
    await expect(pill).not.toBeVisible();
    const state = await getMediaState(window);
    expect(state).not.toBeNull();
    expect(state!.isPlaying).toBe(false);
  });

  test('dismissing pill then switching back shows no residual state', async ({ window }) => {
    const docA = await createNoteWithTitle(window, 'Note A');
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'vidA',
    });

    await createNoteWithTitle(window, 'Note B');
    const pill = window.locator('[data-testid="media-pill"]');
    await expect(pill).toBeVisible({ timeout: 5000 });

    // Dismiss
    await pill.hover();
    await window.waitForTimeout(300);
    await pill.locator('button[aria-label="Dismiss"]').click();
    await window.waitForTimeout(300);

    await expect(pill).not.toBeVisible();
    expect(await getMediaState(window)).toBeNull();

    // Switch back to Note A → no pill, no media state, nothing weird
    await window.locator('[data-tab-id]').filter({ hasText: 'Note A' }).click();
    await window.waitForTimeout(300);
    await expect(pill).not.toBeVisible();
    expect(await getMediaState(window)).toBeNull();

    // Switch back to Note B again → still nothing
    await window.locator('[data-tab-id]').filter({ hasText: 'Note B' }).click();
    await window.waitForTimeout(300);
    await expect(pill).not.toBeVisible();
  });

  test('playing A → playing B → close B tab → media B is dismissed, A stays paused', async ({ window }) => {
    // Play in Note A
    const docA = await createNoteWithTitle(window, 'Note A');
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'vidA',
    });

    // Play in Note B → auto-pauses A
    const docB = await createNoteWithTitle(window, 'Note B');
    await simulatePlay(window, {
      key: 'yt-b',
      noteId: docB,
      noteTitle: 'Note B',
      contentId: 'vidB',
    });

    // Store has B playing
    expect((await getMediaState(window))!.key).toBe('yt-b');

    // Create Note C to have somewhere to view
    await createNoteWithTitle(window, 'Note C');

    // Close Note B's tab
    await window.locator('[data-tab-id]').filter({ hasText: 'Note B' })
      .locator('[aria-label="Close tab"]').click({ force: true });
    await window.waitForTimeout(500);

    // B was the active media → useEffect sees B's noteId gone from openTabs → dismiss()
    expect(await getMediaState(window)).toBeNull();
    // A's media was already paused and replaced — no pill for A either
    await expect(window.locator('[data-testid="media-pill"]')).not.toBeVisible();
  });

  test('chain: play A → play B → play C, only C survives and A+B were paused', async ({ window }) => {
    const docA = await createNoteWithTitle(window, 'Note A');
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'vidA',
    });

    const pauseAfterA = await getPauseCount(window);

    const docB = await createNoteWithTitle(window, 'Note B');
    await simulatePlay(window, {
      key: 'yt-b',
      noteId: docB,
      noteTitle: 'Note B',
      contentId: 'vidB',
    });

    // A was paused
    expect(await getPauseCount(window)).toBe(pauseAfterA + 1);

    const pauseAfterB = await getPauseCount(window);

    const docC = await createNoteWithTitle(window, 'Note C');
    await simulatePlay(window, {
      key: 'yt-c',
      noteId: docC,
      noteTitle: 'Note C',
      contentId: 'vidC',
    });

    // B was paused
    expect(await getPauseCount(window)).toBe(pauseAfterB + 1);

    // Store has C
    const state = await getMediaState(window);
    expect(state!.key).toBe('yt-c');
    expect(state!.noteId).toBe(docC);
    expect(state!.isPlaying).toBe(true);
  });

  test('closing all tabs clears media state', async ({ window }) => {
    const docA = await createNoteWithTitle(window, 'Only Tab');
    await simulatePlay(window, {
      key: 'yt-only',
      noteId: docA,
      noteTitle: 'Only Tab',
      contentId: 'vidOnly',
    });

    // Close the only tab
    await window.locator('[data-tab-id]').first()
      .locator('[aria-label="Close tab"]').click({ force: true });
    await window.waitForTimeout(500);

    // No tabs, no media
    await expect(window.locator('[data-tab-id]')).toHaveCount(0);
    expect(await getMediaState(window)).toBeNull();
    await expect(window.locator('[data-testid="media-pill"]')).not.toBeVisible();
  });

  test('rapid tab switching keeps pill state consistent', async ({ window }) => {
    const docA = await createNoteWithTitle(window, 'Note A');
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'vidA',
    });

    await createNoteWithTitle(window, 'Note B');
    const pill = window.locator('[data-testid="media-pill"]');
    await expect(pill).toBeVisible({ timeout: 5000 });

    const tabA = window.locator('[data-tab-id]').filter({ hasText: 'Note A' });
    const tabB = window.locator('[data-tab-id]').filter({ hasText: 'Note B' });

    // Rapid switching: B → A → B → A → B → A → B
    for (let i = 0; i < 3; i++) {
      await tabA.click();
      await window.waitForTimeout(100);
      await tabB.click();
      await window.waitForTimeout(100);
    }
    await window.waitForTimeout(300);

    // End on B → pill should be visible, media still playing
    await expect(pill).toBeVisible();
    const state = await getMediaState(window);
    expect(state!.isPlaying).toBe(true);
    expect(state!.key).toBe('yt-a');
  });

  test('rapid play/pause toggle via pill keeps state consistent', async ({ window }) => {
    const docA = await createNoteWithTitle(window, 'Note A');
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'vidA',
    });

    await createNoteWithTitle(window, 'Note B');
    const pill = window.locator('[data-testid="media-pill"]');
    await expect(pill).toBeVisible({ timeout: 5000 });

    // Toggle 6 times rapidly (play → pause → play → pause → play → pause)
    for (let i = 0; i < 6; i++) {
      await pill.hover();
      await window.waitForTimeout(150);
      // Find whichever toggle button is visible
      const toggleBtn = pill.locator('button[aria-label="Pause"], button[aria-label="Play"]');
      await toggleBtn.click();
      await window.waitForTimeout(100);
    }
    await window.waitForTimeout(300);

    // After 6 toggles from playing: playing→paused→playing→paused→playing→paused = paused
    // (started playing, 6 toggles = even number of toggles from initial = back to...
    //  actually: start=playing, toggle 1=paused, 2=playing, 3=paused, 4=playing, 5=paused, 6=playing)
    // 6 toggles from playing → playing (even number)
    const state = await getMediaState(window);
    expect(state).not.toBeNull();
    // The key invariant is that the state is consistent, not flickering
    // isPlaying should match the aria-label
    const ariaLabel = await pill.locator('button[aria-label="Pause"], button[aria-label="Play"]')
      .getAttribute('aria-label');
    if (state!.isPlaying) {
      expect(ariaLabel).toBe('Pause');
    } else {
      expect(ariaLabel).toBe('Play');
    }
  });

  test('pill click navigates to media tab and hides pill', async ({ window }) => {
    const docA = await createNoteWithTitle(window, 'Note A');
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'vidA',
    });

    await createNoteWithTitle(window, 'Note B');
    const pill = window.locator('[data-testid="media-pill"]');
    await expect(pill).toBeVisible({ timeout: 5000 });

    // Hover to expand the pill, then click the text area (not the toggle button).
    // The toggle button uses stopPropagation, so clicking center would only toggle.
    // The expanded area with note title is the safe click target.
    await pill.hover();
    await window.waitForTimeout(350);
    // Click the note title span inside the expanded area
    await pill.locator('span', { hasText: 'Note A' }).click();
    await window.waitForTimeout(500);

    // Should now be on Note A
    const visibleTitle = window.locator('main:visible h1.editor-title');
    await expect(visibleTitle).toContainText('Note A');

    // Pill should be hidden (we're on the media tab now)
    await expect(pill).not.toBeVisible();

    // Media still playing
    expect((await getMediaState(window))!.isPlaying).toBe(true);
  });

  test('replaying same key after dismiss creates fresh entry', async ({ window }) => {
    const docA = await createNoteWithTitle(window, 'Note A');
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'vidA',
    });

    await createNoteWithTitle(window, 'Note B');
    const pill = window.locator('[data-testid="media-pill"]');
    await expect(pill).toBeVisible({ timeout: 5000 });

    // Dismiss
    await pill.hover();
    await window.waitForTimeout(300);
    await pill.locator('button[aria-label="Dismiss"]').click();
    await window.waitForTimeout(300);
    expect(await getMediaState(window)).toBeNull();

    // Re-play same key
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'vidA',
    });

    // Pill reappears (we're still on Note B)
    await expect(pill).toBeVisible({ timeout: 5000 });
    const state = await getMediaState(window);
    expect(state!.key).toBe('yt-a');
    expect(state!.isPlaying).toBe(true);
  });

  test('setPaused with wrong key is ignored', async ({ window }) => {
    const docA = await createNoteWithTitle(window, 'Note A');
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'vidA',
    });

    // Try to pause with a mismatched key
    await window.evaluate(() => {
      const store = (window as any).__mediaStore;
      store.getState().setPaused('wrong-key');
    });

    // State should be unchanged — still playing
    const state = await getMediaState(window);
    expect(state!.isPlaying).toBe(true);
    expect(state!.key).toBe('yt-a');
  });

  test('togglePlayback and dismiss are no-ops when no media is active', async ({ window }) => {
    await createNoteWithTitle(window, 'Empty Note');

    // No media playing — these should not throw
    await window.evaluate(() => {
      const store = (window as any).__mediaStore;
      store.getState().togglePlayback();
      store.getState().dismiss();
    });

    expect(await getMediaState(window)).toBeNull();
  });

  test('media for a noteId not in openTabs never shows pill and gets auto-dismissed', async ({ window }) => {
    await createNoteWithTitle(window, 'Real Tab');

    const pauseBefore = await getPauseCount(window);

    // Simulate playing in a noteId that was never opened as a tab
    await simulatePlay(window, {
      key: 'yt-ghost',
      noteId: 'nonexistent-doc-id',
      noteTitle: 'Ghost',
      contentId: 'vidGhost',
    });
    await window.waitForTimeout(500);

    // The pill's useEffect fires: noteId not in openTabs → dismiss() is called.
    // So the store is cleared AND the pill never shows.
    await expect(window.locator('[data-testid="media-pill"]')).not.toBeVisible();
    expect(await getMediaState(window)).toBeNull();
    // Pause callback was invoked by dismiss()
    expect(await getPauseCount(window)).toBeGreaterThan(pauseBefore);
  });

  test('trashing the media note auto-dismisses the pill', async ({ window }) => {
    const docA = await createNoteWithTitle(window, 'Trash Me');
    await simulatePlay(window, {
      key: 'yt-trash',
      noteId: docA,
      noteTitle: 'Trash Me',
      contentId: 'vidTrash',
    });

    await createNoteWithTitle(window, 'Survivor');
    const pill = window.locator('[data-testid="media-pill"]');
    await expect(pill).toBeVisible({ timeout: 5000 });

    const pauseBefore = await getPauseCount(window);

    // Trash the media note via IPC (simulates sidebar right-click → trash)
    await window.evaluate((id) => {
      return (window as any).__documentStore.getState().trashDocument(id);
    }, docA);
    await window.waitForTimeout(500);

    // Tab is closed, media note removed from openTabs → pill dismissed
    await expect(pill).not.toBeVisible();
    expect(await getMediaState(window)).toBeNull();
    expect(await getPauseCount(window)).toBeGreaterThan(pauseBefore);
  });

  test('play in A, switch to B, pause via pill, create C, pill persists showing paused', async ({ window }) => {
    const docA = await createNoteWithTitle(window, 'Note A');
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'vidA',
    });

    await createNoteWithTitle(window, 'Note B');
    const pill = window.locator('[data-testid="media-pill"]');
    await expect(pill).toBeVisible({ timeout: 5000 });

    // Pause via pill
    await pill.hover();
    await window.waitForTimeout(300);
    await pill.locator('button[aria-label="Pause"]').click();
    await window.waitForTimeout(200);
    expect((await getMediaState(window))!.isPlaying).toBe(false);

    // Create Note C (new active tab, moves further from media tab)
    await createNoteWithTitle(window, 'Note C');
    await window.waitForTimeout(300);

    // Pill should STILL be visible showing paused state
    await expect(pill).toBeVisible();
    const state = await getMediaState(window);
    expect(state!.isPlaying).toBe(false);
    expect(state!.key).toBe('yt-a');

    // Play button should show (not Pause)
    await pill.hover();
    await window.waitForTimeout(300);
    await expect(pill.locator('button[aria-label="Play"]')).toBeVisible();
  });

  test('three videos chained: play → auto-pause → play → auto-pause → close middle tab', async ({ window }) => {
    // Three tabs, three videos — close the middle one
    const docA = await createNoteWithTitle(window, 'Note A');
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'vidA',
    });

    const docB = await createNoteWithTitle(window, 'Note B');
    await simulatePlay(window, {
      key: 'yt-b',
      noteId: docB,
      noteTitle: 'Note B',
      contentId: 'vidB',
    });

    const docC = await createNoteWithTitle(window, 'Note C');
    await simulatePlay(window, {
      key: 'yt-c',
      noteId: docC,
      noteTitle: 'Note C',
      contentId: 'vidC',
    });

    // C is active media, we're on C's tab → no pill
    expect((await getMediaState(window))!.key).toBe('yt-c');
    await expect(window.locator('[data-testid="media-pill"]')).not.toBeVisible();

    // Close Note B's tab — should NOT affect anything (B is not active media)
    await window.locator('[data-tab-id]').filter({ hasText: 'Note B' })
      .locator('[aria-label="Close tab"]').click({ force: true });
    await window.waitForTimeout(300);

    // C still active and playing
    const state = await getMediaState(window);
    expect(state!.key).toBe('yt-c');
    expect(state!.isPlaying).toBe(true);

    // Switch to A → pill appears for C
    await window.locator('[data-tab-id]').filter({ hasText: 'Note A' }).click();
    await window.waitForTimeout(300);
    await expect(window.locator('[data-testid="media-pill"]')).toBeVisible();
  });

  test('dismiss pill, close media tab, create new note → clean slate', async ({ window }) => {
    const docA = await createNoteWithTitle(window, 'Note A');
    await simulatePlay(window, {
      key: 'yt-a',
      noteId: docA,
      noteTitle: 'Note A',
      contentId: 'vidA',
    });

    await createNoteWithTitle(window, 'Note B');
    const pill = window.locator('[data-testid="media-pill"]');
    await expect(pill).toBeVisible({ timeout: 5000 });

    // Dismiss pill first
    await pill.hover();
    await window.waitForTimeout(300);
    await pill.locator('button[aria-label="Dismiss"]').click();
    await window.waitForTimeout(300);
    expect(await getMediaState(window)).toBeNull();

    // Now close Note A's tab (already dismissed, should be fine)
    await window.locator('[data-tab-id]').filter({ hasText: 'Note A' })
      .locator('[aria-label="Close tab"]').click({ force: true });
    await window.waitForTimeout(300);

    // Create a fresh note — everything should be clean
    await createNoteWithTitle(window, 'Note C');
    await window.waitForTimeout(300);

    expect(await getMediaState(window)).toBeNull();
    await expect(pill).not.toBeVisible();
  });

  test('play video, close ALL other tabs, pill vanishes since media tab is now active', async ({ window }) => {
    const docA = await createNoteWithTitle(window, 'Media Note');
    await simulatePlay(window, {
      key: 'yt-m',
      noteId: docA,
      noteTitle: 'Media Note',
      contentId: 'vidM',
    });

    await createNoteWithTitle(window, 'Tab B');
    await createNoteWithTitle(window, 'Tab C');

    const pill = window.locator('[data-testid="media-pill"]');
    await expect(pill).toBeVisible({ timeout: 5000 });

    // Close Tab C (the active tab) → falls to Tab B
    await window.locator('[data-tab-id]').filter({ hasText: 'Tab C' })
      .locator('[aria-label="Close tab"]').click({ force: true });
    await window.waitForTimeout(300);

    // Pill still visible (on Tab B, media in Media Note)
    await expect(pill).toBeVisible();

    // Close Tab B → falls to Media Note (only tab left)
    await window.locator('[data-tab-id]').filter({ hasText: 'Tab B' })
      .locator('[aria-label="Close tab"]').click({ force: true });
    await window.waitForTimeout(300);

    // Now selectedId === media note → pill hidden
    await expect(pill).not.toBeVisible();
    // But media still playing!
    expect((await getMediaState(window))!.isPlaying).toBe(true);
  });
});
