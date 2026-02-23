import { test, expect, listDocumentsFromDb, getDocumentFromDb } from './electron-app';
import type { Page } from '@playwright/test';

// ── Helpers ─────────────────────────────────────────────────────────

/** Create a note with a title via the UI. Returns the data-note-id. */
async function createNote(window: Page, title: string, parentId?: string): Promise<string> {
  if (parentId) {
    const parent = window.locator(`[data-note-id="${parentId}"]`);
    await parent.click({ button: 'right' });
    await window.getByText('Add page inside').click();
  } else {
    await window.locator('[aria-label="New note"]').click();
  }
  await window.waitForTimeout(400);

  const visibleTitle = window.locator('main:visible h1.editor-title');
  await visibleTitle.click();
  await window.keyboard.type(title);
  await window.waitForTimeout(600);

  const noteEl = window.locator('[data-note-id]').filter({ hasText: title });
  const id = await noteEl.getAttribute('data-note-id');
  return id!;
}

/** Get visible note IDs in top-to-bottom order from the sidebar. */
async function getVisibleNoteIds(window: Page): Promise<string[]> {
  const items = window.locator('[data-note-id]');
  const count = await items.count();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = await items.nth(i).getAttribute('data-note-id');
    if (id) ids.push(id);
  }
  return ids;
}

/** Get visible note titles in top-to-bottom order from the sidebar. */
async function getVisibleNoteTitles(window: Page): Promise<string[]> {
  const items = window.locator('[data-note-id]');
  const count = await items.count();
  const titles: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = await items.nth(i).innerText();
    titles.push(text.trim());
  }
  return titles;
}

/**
 * Perform a real mouse-driven drag from one note to another.
 * Uses Playwright's mouse API so the drag is visually visible and
 * triggers the browser's native HTML5 drag flow on `draggable` elements
 * (which is what @atlaskit/pragmatic-drag-and-drop listens for).
 */
async function dragNote(
  window: Page,
  sourceId: string,
  targetId: string,
  position: 'before' | 'inside' | 'after',
) {
  const source = window.locator(`[data-note-id="${sourceId}"]`);
  const target = window.locator(`[data-note-id="${targetId}"]`);

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('Source or target bounding box not found');

  const srcX = sourceBox.x + sourceBox.width / 2;
  const srcY = sourceBox.y + sourceBox.height / 2;

  let destY: number;
  if (position === 'before') {
    destY = targetBox.y + 3;
  } else if (position === 'after') {
    destY = targetBox.y + targetBox.height - 3;
  } else {
    destY = targetBox.y + targetBox.height / 2;
  }
  const destX = targetBox.x + targetBox.width / 2;

  // Hover source, then press and hold
  await window.mouse.move(srcX, srcY);
  await window.mouse.down();

  // Small initial move to trigger the browser's drag initiation threshold
  await window.mouse.move(srcX + 5, srcY + 5, { steps: 3 });
  await window.waitForTimeout(150);

  // Glide to the target position so the user can see the drag
  await window.mouse.move(destX, destY, { steps: 15 });
  await window.waitForTimeout(200);

  // Drop
  await window.mouse.up();
  await window.waitForTimeout(800);
}

/** Scroll the notes sidebar container to top or bottom. */
async function scrollNotesTo(window: Page, where: 'top' | 'bottom') {
  const scrollEl = window.locator('.notes-scroll').first();
  await scrollEl.evaluate((el, w) => {
    const container = el as HTMLElement;
    container.scrollTop = w === 'bottom' ? container.scrollHeight : 0;
  }, where);
  await window.waitForTimeout(300);
}

/**
 * Drag when source and target may be far apart (overflow). Scrolls each into view
 * as needed so the drag works in a long list.
 */
async function dragNoteInLongList(
  window: Page,
  sourceId: string,
  targetId: string,
  position: 'before' | 'inside' | 'after',
) {
  const source = window.locator(`[data-note-id="${sourceId}"]`);
  const target = window.locator(`[data-note-id="${targetId}"]`);

  await source.scrollIntoViewIfNeeded();
  await window.waitForTimeout(200);
  const sourceBox = await source.boundingBox();
  if (!sourceBox) throw new Error('Source bounding box not found');

  const srcX = sourceBox.x + sourceBox.width / 2;
  const srcY = sourceBox.y + sourceBox.height / 2;

  await window.mouse.move(srcX, srcY);
  await window.mouse.down();
  await window.mouse.move(srcX + 5, srcY + 5, { steps: 3 });
  await window.waitForTimeout(150);

  await target.scrollIntoViewIfNeeded();
  await window.waitForTimeout(300);
  const targetBox = await target.boundingBox();
  if (!targetBox) throw new Error('Target bounding box not found');

  let destY: number;
  if (position === 'before') {
    destY = targetBox.y + 3;
  } else if (position === 'after') {
    destY = targetBox.y + targetBox.height - 3;
  } else {
    destY = targetBox.y + targetBox.height / 2;
  }
  const destX = targetBox.x + targetBox.width / 2;

  await window.mouse.move(destX, destY, { steps: 15 });
  await window.waitForTimeout(200);
  await window.mouse.up();
  await window.waitForTimeout(800);
}

// ── Tests ───────────────────────────────────────────────────────────

test.describe('Sidebar Tree — Structure & Nesting', () => {
  test('build a 3-level deep tree and verify hierarchy in DB', async ({ window }) => {
    const root = await createNote(window, 'Root Note');
    const child = await createNote(window, 'Child Note', root);
    const grandchild = await createNote(window, 'Grandchild', child);

    // All 3 should be visible (parent auto-expands)
    await expect(window.locator('[data-note-id]')).toHaveCount(3);

    // Verify hierarchy in database
    const docs = await listDocumentsFromDb(window);
    expect(docs).toHaveLength(3);

    const rootDoc = docs.find((d) => d.title === 'Root Note')!;
    const childDoc = docs.find((d) => d.title === 'Child Note')!;
    const grandchildDoc = docs.find((d) => d.title === 'Grandchild')!;

    expect(rootDoc.parentId).toBeNull();
    expect(childDoc.parentId).toBe(rootDoc.id);
    expect(grandchildDoc.parentId).toBe(childDoc.id);
  });

  test('new notes appear at the top of their sibling group (sortOrder 0)', async ({ window }) => {
    const a = await createNote(window, 'First Created');
    const b = await createNote(window, 'Second Created');
    const c = await createNote(window, 'Third Created');

    const docs = await listDocumentsFromDb(window);
    const first = docs.find((d) => d.title === 'First Created')!;
    const second = docs.find((d) => d.title === 'Second Created')!;
    const third = docs.find((d) => d.title === 'Third Created')!;

    // Newest note has sortOrder 0 (appears first)
    expect(third.sortOrder).toBe(0);
    expect(second.sortOrder).toBe(1);
    expect(first.sortOrder).toBe(2);

    // Verify the sidebar shows them in this order (newest first)
    const titles = await getVisibleNoteTitles(window);
    expect(titles).toEqual(['Third Created', 'Second Created', 'First Created']);
  });

  test('creating nested note auto-expands the parent', async ({ window }) => {
    const parent = await createNote(window, 'Parent');

    // Collapse parent (click the Notes header, no—expand toggle doesn't exist yet since no children)
    // At this point parent has no children, so there's no expand toggle

    // Add a child
    const child = await createNote(window, 'Auto-Shown Child', parent);

    // Child should be visible (parent auto-expanded)
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Auto-Shown Child' })).toBeVisible();
  });

  test('expand and collapse individual tree nodes', async ({ window }) => {
    const parent = await createNote(window, 'Collapsible');
    const child = await createNote(window, 'Hidden Child', parent);

    // Child is visible (parent auto-expanded)
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Hidden Child' })).toBeVisible();

    // Hover the parent to reveal the collapse chevron, then click it
    const parentEl = window.locator('[data-note-id]').filter({ hasText: 'Collapsible' });
    await parentEl.hover();
    await window.waitForTimeout(200);
    const collapseBtn = parentEl.locator('[aria-label="Collapse"]');
    await collapseBtn.click();
    await window.waitForTimeout(300);

    // Child should be hidden
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Hidden Child' })).not.toBeVisible();

    // Expand again
    await parentEl.hover();
    await window.waitForTimeout(200);
    const expandBtn = parentEl.locator('[aria-label="Expand"]');
    await expandBtn.click();
    await window.waitForTimeout(300);

    // Child visible again
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Hidden Child' })).toBeVisible();
  });

  test('trashing a parent also trashes all its children', async ({ window }) => {
    const parent = await createNote(window, 'Parent To Trash');
    const child = await createNote(window, 'Child Goes Too', parent);

    // Trash the parent
    const parentEl = window.locator('[data-note-id]').filter({ hasText: 'Parent To Trash' });
    await parentEl.click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

    // Both should be gone from sidebar
    await expect(window.locator('[data-note-id]')).toHaveCount(0);

    // Both should be trashed in database
    const parentDoc = await getDocumentFromDb(window, parent);
    const childDoc = await getDocumentFromDb(window, child);
    expect(parentDoc!.deletedAt).toBeTruthy();
    expect(childDoc!.deletedAt).toBeTruthy();
  });

  test('multiple siblings maintain correct sort order', async ({ window }) => {
    await createNote(window, 'Sib A');
    await createNote(window, 'Sib B');
    await createNote(window, 'Sib C');

    const docs = await listDocumentsFromDb(window);
    const sorted = docs
      .filter((d) => d.parentId === null)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // sortOrder 0 = most recent = Sib C
    expect(sorted.map((d) => d.title)).toEqual(['Sib C', 'Sib B', 'Sib A']);
  });
});

test.describe('Sidebar Tree — Drag & Drop Reordering', () => {
  test('reorder siblings: move last note to first position', async ({ window }) => {
    const a = await createNote(window, 'DnD A');
    const b = await createNote(window, 'DnD B');
    const c = await createNote(window, 'DnD C');

    // Current order: C(0), B(1), A(2). Drag A before C (first).
    await dragNote(window, a, c, 'before');

    const docs = await listDocumentsFromDb(window);
    const sorted = docs
      .filter((d) => d.parentId === null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    expect(sorted.map((d) => d.title)).toEqual(['DnD A', 'DnD C', 'DnD B']);
  });

  test('nest a root note inside another and verify parentId', async ({ window }) => {
    const parent = await createNote(window, 'Nest Target');
    const child = await createNote(window, 'Will Be Nested');

    await dragNote(window, child, parent, 'inside');

    const childDoc = await getDocumentFromDb(window, child);
    expect(childDoc!.parentId).toBe(parent);
    expect(childDoc!.sortOrder).toBe(0);

    await expect(window.locator('[data-note-id]').filter({ hasText: 'Will Be Nested' })).toBeVisible();
  });

  test('un-nest: move a child to root level', async ({ window }) => {
    const parent = await createNote(window, 'Former Parent');
    const child = await createNote(window, 'Leaving Nest', parent);

    let childDoc = await getDocumentFromDb(window, child);
    expect(childDoc!.parentId).toBe(parent);

    // Drag child before parent (at root level)
    await dragNote(window, child, parent, 'before');

    childDoc = await getDocumentFromDb(window, child);
    expect(childDoc!.parentId).toBeNull();

    const titles = await getVisibleNoteTitles(window);
    expect(titles).toContain('Former Parent');
    expect(titles).toContain('Leaving Nest');
  });

  test('move a note between two different parents', async ({ window }) => {
    const parentA = await createNote(window, 'Parent A');
    const parentB = await createNote(window, 'Parent B');
    const mover = await createNote(window, 'Moving Note', parentA);

    let doc = await getDocumentFromDb(window, mover);
    expect(doc!.parentId).toBe(parentA);

    await dragNote(window, mover, parentB, 'inside');

    doc = await getDocumentFromDb(window, mover);
    expect(doc!.parentId).toBe(parentB);

    const docs = await listDocumentsFromDb(window);
    const aChildren = docs.filter((d) => d.parentId === parentA);
    const bChildren = docs.filter((d) => d.parentId === parentB);
    expect(aChildren).toHaveLength(0);
    expect(bChildren).toHaveLength(1);
    expect(bChildren[0].title).toBe('Moving Note');
  });

  test('circular reference prevention: cannot move parent into its own child', async ({ window }) => {
    const parent = await createNote(window, 'Circ Parent');
    const child = await createNote(window, 'Circ Child', parent);

    // Try to drag parent into child — DnD/backend should reject
    await dragNote(window, parent, child, 'inside');

    const parentDoc = await getDocumentFromDb(window, parent);
    expect(parentDoc!.parentId).toBeNull();
  });

  test('reorder three siblings to reversed order', async ({ window }) => {
    const a = await createNote(window, 'Rev A');
    const b = await createNote(window, 'Rev B');
    const c = await createNote(window, 'Rev C');

    // Initial order: C, B, A. Reverse to A, B, C.
    await dragNote(window, a, c, 'before');
    await dragNote(window, c, b, 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots.map((d) => d.title)).toEqual(['Rev A', 'Rev B', 'Rev C']);
  });

  test('drag a note before another to reorder', async ({ window }) => {
    const a = await createNote(window, 'Drag A');
    const b = await createNote(window, 'Drag B');
    const c = await createNote(window, 'Drag C');

    await dragNote(window, a, c, 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((x, y) => x.sortOrder - y.sortOrder);
    const aIdx = roots.findIndex((d) => d.title === 'Drag A');
    const cIdx = roots.findIndex((d) => d.title === 'Drag C');
    expect(aIdx).toBeLessThan(cIdx);
  });

  test('drag a note after another to reorder', async ({ window }) => {
    const a = await createNote(window, 'ND A');
    const b = await createNote(window, 'ND B');
    const c = await createNote(window, 'ND C');

    // Order: C, B, A. Drag A after C (so A moves up to be right after C).
    await dragNote(window, a, c, 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((x, y) => x.sortOrder - y.sortOrder);
    const aIdx = roots.findIndex((d) => d.title === 'ND A');
    const cIdx = roots.findIndex((d) => d.title === 'ND C');
    expect(aIdx).toBe(cIdx + 1);
  });

  test('drag a nested child to root level — un-nest', async ({ window }) => {
    const parent = await createNote(window, 'ND Parent');
    const child = await createNote(window, 'ND Child', parent);
    const rootSib = await createNote(window, 'ND Root Sib');

    // Drag child and drop before root sibling → becomes root-level
    await dragNote(window, child, rootSib, 'before');

    const doc = await getDocumentFromDb(window, child);
    expect(doc!.parentId).toBeNull();
  });

  test('drag a note from one parent to another', async ({ window }) => {
    const parentA = await createNote(window, 'ND Parent A');
    const parentB = await createNote(window, 'ND Parent B');
    const mover = await createNote(window, 'ND Mover', parentA);

    await dragNote(window, mover, parentB, 'inside');

    const doc = await getDocumentFromDb(window, mover);
    expect(doc!.parentId).toBe(parentB);
  });

  test('drag to reorder siblings within same parent', async ({ window }) => {
    const parent = await createNote(window, 'ND Sib Parent');
    const c1 = await createNote(window, 'ND Sib 1', parent);
    const c2 = await createNote(window, 'ND Sib 2', parent);
    const c3 = await createNote(window, 'ND Sib 3', parent);

    // Order: Sib 3, Sib 2, Sib 1. Drag Sib 1 before Sib 3 (to first).
    await dragNote(window, c1, c3, 'before');

    const docs = await listDocumentsFromDb(window);
    const children = docs.filter((d) => d.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(children[0].title).toBe('ND Sib 1');
  });

  test('drag root note into another root to nest', async ({ window }) => {
    const target = await createNote(window, 'ND Nest Target');
    const dragee = await createNote(window, 'ND Root Nester');

    await dragNote(window, dragee, target, 'inside');

    const doc = await getDocumentFromDb(window, dragee);
    expect(doc!.parentId).toBe(target);
  });

  test('drag child after sibling to reorder', async ({ window }) => {
    const parent = await createNote(window, 'ND After Parent');
    const first = await createNote(window, 'ND First', parent);
    const last = await createNote(window, 'ND Last', parent);

    // Order: Last, First. Drag First after Last (so First becomes last).
    await dragNote(window, first, last, 'after');

    const docs = await listDocumentsFromDb(window);
    const children = docs.filter((d) => d.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(children[children.length - 1].title).toBe('ND First');
  });
});

test.describe('Sidebar Tree — Ordering Variability', () => {
  test('bottom to top: move last of 5 to first', async ({ window }) => {
    const a = await createNote(window, 'Ord A');
    const b = await createNote(window, 'Ord B');
    const c = await createNote(window, 'Ord C');
    const d = await createNote(window, 'Ord D');
    const e = await createNote(window, 'Ord E');
    const ids = [a, b, c, d, e];
    // Order: E, D, C, B, A. Drag A (last) before E (first).
    await dragNote(window, ids[0], ids[4], 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('Ord A');
    expect(roots[roots.length - 1].title).toBe('Ord E');
  });

  test('top to bottom: move first of 5 to last', async ({ window }) => {
    const a = await createNote(window, 'Ord2 A');
    const b = await createNote(window, 'Ord2 B');
    const c = await createNote(window, 'Ord2 C');
    const d = await createNote(window, 'Ord2 D');
    const e = await createNote(window, 'Ord2 E');
    const ids = [a, b, c, d, e];
    // Order: E, D, C, B, A. Drag E (first) after A (last).
    await dragNote(window, ids[4], ids[0], 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('Ord2 D');
    expect(roots[roots.length - 1].title).toBe('Ord2 E');
  });

  test('middle to top: move 3rd of 5 to first', async ({ window }) => {
    const a = await createNote(window, 'Mid A');
    const b = await createNote(window, 'Mid B');
    const c = await createNote(window, 'Mid C');
    const d = await createNote(window, 'Mid D');
    const e = await createNote(window, 'Mid E');
    const ids = [a, b, c, d, e];
    // Order: E, D, C, B, A. C is middle (index 2). Drag C before E (first).
    await dragNote(window, ids[2], ids[4], 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('Mid C');
  });

  test('middle to bottom: move 3rd of 5 to last', async ({ window }) => {
    const a = await createNote(window, 'Mid2 A');
    const b = await createNote(window, 'Mid2 B');
    const c = await createNote(window, 'Mid2 C');
    const d = await createNote(window, 'Mid2 D');
    const e = await createNote(window, 'Mid2 E');
    const ids = [a, b, c, d, e];
    // Order: E, D, C, B, A. C is middle. Drag C after A (last).
    await dragNote(window, ids[2], ids[0], 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[roots.length - 1].title).toBe('Mid2 C');
  });

  test('middle to second: move 4th of 5 to position 2', async ({ window }) => {
    const a = await createNote(window, 'M2 A');
    const b = await createNote(window, 'M2 B');
    const c = await createNote(window, 'M2 C');
    const d = await createNote(window, 'M2 D');
    const e = await createNote(window, 'M2 E');
    const ids = [a, b, c, d, e];
    // Order: E, D, C, B, A. B is 4th from top. Drag B before C (so B becomes 3rd, between D and C).
    await dragNote(window, ids[1], ids[2], 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    const bIdx = roots.findIndex((d) => d.title === 'M2 B');
    const cIdx = roots.findIndex((d) => d.title === 'M2 C');
    expect(bIdx).toBe(cIdx - 1);
  });

  test('second to second-last: move 2nd of 5 to 4th', async ({ window }) => {
    const a = await createNote(window, 'S2 A');
    const b = await createNote(window, 'S2 B');
    const c = await createNote(window, 'S2 C');
    const d = await createNote(window, 'S2 D');
    const e = await createNote(window, 'S2 E');
    const ids = [a, b, c, d, e];
    // Order: E, D, C, B, A. D is 2nd. Drag D after B (so D becomes 4th).
    await dragNote(window, ids[3], ids[1], 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    const dIdx = roots.findIndex((d) => d.title === 'S2 D');
    const bIdx = roots.findIndex((d) => d.title === 'S2 B');
    expect(dIdx).toBe(bIdx + 1);
  });

  test('7 items: move 5th from top to 1st', async ({ window }) => {
    const ids: string[] = [];
    for (const name of ['L7 A', 'L7 B', 'L7 C', 'L7 D', 'L7 E', 'L7 F', 'L7 G']) {
      ids.push(await createNote(window, name));
    }
    // Order: G, F, E, D, C, B, A. C is 5th from top. Drag C before G (first).
    await dragNote(window, ids[2], ids[6], 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('L7 C');
  });

  test('7 items: move 2nd from top to 6th', async ({ window }) => {
    const ids: string[] = [];
    for (const name of ['L72 A', 'L72 B', 'L72 C', 'L72 D', 'L72 E', 'L72 F', 'L72 G']) {
      ids.push(await createNote(window, name));
    }
    // Order: G, F, E, D, C, B, A. F is 2nd. Drag F after B (so F becomes 6th).
    await dragNote(window, ids[5], ids[1], 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    const fIdx = roots.findIndex((d) => d.title === 'L72 F');
    expect(fIdx).toBe(5);
  });

  test('nested: middle child to first within parent', async ({ window }) => {
    const parent = await createNote(window, 'NestOrd Parent');
    const c1 = await createNote(window, 'NestOrd 1', parent);
    const c2 = await createNote(window, 'NestOrd 2', parent);
    const c3 = await createNote(window, 'NestOrd 3', parent);
    const c4 = await createNote(window, 'NestOrd 4', parent);
    const c5 = await createNote(window, 'NestOrd 5', parent);

    // Order: 5, 4, 3, 2, 1. Drag 3 (middle) before 5 (first).
    await dragNote(window, c3, c5, 'before');

    const docs = await listDocumentsFromDb(window);
    const children = docs.filter((d) => d.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(children[0].title).toBe('NestOrd 3');
  });

  test('nested: middle child to last within parent', async ({ window }) => {
    const parent = await createNote(window, 'NestOrd2 Parent');
    const c1 = await createNote(window, 'NestOrd2 1', parent);
    const c2 = await createNote(window, 'NestOrd2 2', parent);
    const c3 = await createNote(window, 'NestOrd2 3', parent);
    const c4 = await createNote(window, 'NestOrd2 4', parent);
    const c5 = await createNote(window, 'NestOrd2 5', parent);

    // Order: 5, 4, 3, 2, 1. Drag 3 after 1 (last).
    await dragNote(window, c3, c1, 'after');

    const docs = await listDocumentsFromDb(window);
    const children = docs.filter((d) => d.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(children[children.length - 1].title).toBe('NestOrd2 3');
  });
});

test.describe('Sidebar Tree — Edge Positions (Top/Bottom)', () => {
  test('full span: top of 7 to absolute bottom', async ({ window }) => {
    const ids: string[] = [];
    for (const name of ['Edge A', 'Edge B', 'Edge C', 'Edge D', 'Edge E', 'Edge F', 'Edge G']) {
      ids.push(await createNote(window, name));
    }
    // Order: G, F, E, D, C, B, A. G is top. Drag G after A (absolute bottom).
    await dragNote(window, ids[6], ids[0], 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('Edge F');
    expect(roots[roots.length - 1].title).toBe('Edge G');
  });

  test('full span: bottom of 7 to absolute top', async ({ window }) => {
    const ids: string[] = [];
    for (const name of ['Edge2 A', 'Edge2 B', 'Edge2 C', 'Edge2 D', 'Edge2 E', 'Edge2 F', 'Edge2 G']) {
      ids.push(await createNote(window, name));
    }
    // Order: G, F, E, D, C, B, A. A is bottom. Drag A before G (absolute top).
    await dragNote(window, ids[0], ids[6], 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('Edge2 A');
    expect(roots[roots.length - 1].title).toBe('Edge2 G');
  });

  test('edge: first to second (down one)', async ({ window }) => {
    const a = await createNote(window, 'E1 A');
    const b = await createNote(window, 'E1 B');
    const c = await createNote(window, 'E1 C');
    const d = await createNote(window, 'E1 D');
    const e = await createNote(window, 'E1 E');
    // Order: E, D, C, B, A. E is first. Drag E after D (second position).
    await dragNote(window, e, d, 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('E1 D');
    expect(roots[1].title).toBe('E1 E');
  });

  test('edge: last to second-last (up one)', async ({ window }) => {
    const a = await createNote(window, 'E2 A');
    const b = await createNote(window, 'E2 B');
    const c = await createNote(window, 'E2 C');
    const d = await createNote(window, 'E2 D');
    const e = await createNote(window, 'E2 E');
    // Order: E, D, C, B, A. A is last. Drag A before B (second-last).
    await dragNote(window, a, b, 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[roots.length - 2].title).toBe('E2 A');
    expect(roots[roots.length - 1].title).toBe('E2 B');
  });

  test('edge: second to first (up one)', async ({ window }) => {
    const a = await createNote(window, 'E3 A');
    const b = await createNote(window, 'E3 B');
    const c = await createNote(window, 'E3 C');
    const d = await createNote(window, 'E3 D');
    const e = await createNote(window, 'E3 E');
    // Order: E, D, C, B, A. D is second. Drag D before E (first).
    await dragNote(window, d, e, 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('E3 D');
    expect(roots[1].title).toBe('E3 E');
  });

  test('edge: second-last to last (down one)', async ({ window }) => {
    const a = await createNote(window, 'E4 A');
    const b = await createNote(window, 'E4 B');
    const c = await createNote(window, 'E4 C');
    const d = await createNote(window, 'E4 D');
    const e = await createNote(window, 'E4 E');
    // Order: E, D, C, B, A. B is second-last. Drag B after A (last).
    await dragNote(window, b, a, 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[roots.length - 2].title).toBe('E4 A');
    expect(roots[roots.length - 1].title).toBe('E4 B');
  });

  test('nested: top child to bottom within parent', async ({ window }) => {
    const parent = await createNote(window, 'EdgeN Parent');
    const c1 = await createNote(window, 'EdgeN 1', parent);
    const c2 = await createNote(window, 'EdgeN 2', parent);
    const c3 = await createNote(window, 'EdgeN 3', parent);
    const c4 = await createNote(window, 'EdgeN 4', parent);
    const c5 = await createNote(window, 'EdgeN 5', parent);
    // Order: 5, 4, 3, 2, 1. 5 is top. Drag 5 after 1 (bottom).
    await dragNote(window, c5, c1, 'after');

    const docs = await listDocumentsFromDb(window);
    const children = docs.filter((d) => d.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(children[0].title).toBe('EdgeN 4');
    expect(children[children.length - 1].title).toBe('EdgeN 5');
  });

  test('nested: bottom child to top within parent', async ({ window }) => {
    const parent = await createNote(window, 'EdgeN2 Parent');
    const c1 = await createNote(window, 'EdgeN2 1', parent);
    const c2 = await createNote(window, 'EdgeN2 2', parent);
    const c3 = await createNote(window, 'EdgeN2 3', parent);
    const c4 = await createNote(window, 'EdgeN2 4', parent);
    const c5 = await createNote(window, 'EdgeN2 5', parent);
    // Order: 5, 4, 3, 2, 1. 1 is bottom. Drag 1 before 5 (top).
    await dragNote(window, c1, c5, 'before');

    const docs = await listDocumentsFromDb(window);
    const children = docs.filter((d) => d.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(children[0].title).toBe('EdgeN2 1');
    expect(children[children.length - 1].title).toBe('EdgeN2 5');
  });
});

test.describe('Sidebar Tree — Overflow (Long List with Scroll)', () => {
  test('25 root notes: scroll to bottom, drag last to first-visible', async ({ window }) => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      ids.push(await createNote(window, `Over A${i}`));
    }
    // Order: A24..A0. Scroll to bottom. Last visible ≈ A4. Drag A0 (last) before A5.
    await scrollNotesTo(window, 'bottom');
    await dragNote(window, ids[0], ids[5], 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    const a0Idx = roots.findIndex((d) => d.title === 'Over A0');
    const a5Idx = roots.findIndex((d) => d.title === 'Over A5');
    expect(a0Idx).toBeLessThan(a5Idx);
  });

  test('25 root notes: scroll to top, drag first down within visible', async ({ window }) => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      ids.push(await createNote(window, `Over2 A${i}`));
    }
    // Order: A24..A0. Scroll to top. A24 first, A20 visible. Drag A24 after A20.
    await scrollNotesTo(window, 'top');
    await dragNote(window, ids[24], ids[20], 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    const a24Idx = roots.findIndex((d) => d.title === 'Over2 A24');
    const a20Idx = roots.findIndex((d) => d.title === 'Over2 A20');
    expect(a24Idx).toBe(a20Idx + 1);
  });

  test('25 root notes: full span — top to absolute bottom (with scroll)', async ({ window }) => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      ids.push(await createNote(window, `Over3 A${i}`));
    }
    // A24 is top, A0 is bottom. Drag A24 to after A0 (absolute bottom).
    await dragNoteInLongList(window, ids[24], ids[0], 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[roots.length - 1].title).toBe('Over3 A24');
  });

  test('25 root notes: full span — bottom to absolute top (with scroll)', async ({ window }) => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      ids.push(await createNote(window, `Over4 A${i}`));
    }
    // A0 is bottom, A24 is top. Drag A0 to before A24 (absolute top).
    await dragNoteInLongList(window, ids[0], ids[24], 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('Over4 A0');
  });

  test('20 nested children: scroll to bottom, drag last child to first-visible', async ({ window }) => {
    const parent = await createNote(window, 'OverN Parent');
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      ids.push(await createNote(window, `OverN C${i}`, parent));
    }
    // Order: C19..C0. Scroll to bottom. Drag C0 before C5.
    await scrollNotesTo(window, 'bottom');
    await dragNote(window, ids[0], ids[5], 'before');

    const docs = await listDocumentsFromDb(window);
    const children = docs.filter((d) => d.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder);
    const c0Idx = children.findIndex((d) => d.title === 'OverN C0');
    const c5Idx = children.findIndex((d) => d.title === 'OverN C5');
    expect(c0Idx).toBeLessThan(c5Idx);
  });

  test('20 nested children: full span — bottom to top (with scroll)', async ({ window }) => {
    const parent = await createNote(window, 'OverN2 Parent');
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      ids.push(await createNote(window, `OverN2 C${i}`, parent));
    }
    // C0 is bottom, C19 is top. Drag C0 to before C19 (top).
    await dragNoteInLongList(window, ids[0], ids[19], 'before');

    const docs = await listDocumentsFromDb(window);
    const children = docs.filter((d) => d.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(children[0].title).toBe('OverN2 C0');
  });
});

test.describe('Sidebar Tree — Selection & Interaction', () => {
  test('selected note has active styling (font-extrabold)', async ({ window }) => {
    const id = await createNote(window, 'Active Note');

    const noteEl = window.locator(`[data-note-id="${id}"]`);
    const titleSpan = noteEl.locator('span.font-extrabold');
    await expect(titleSpan).toBeVisible();
    await expect(titleSpan).toContainText('Active Note');
  });

  test('Cmd/Ctrl+Click opens note in a new tab instead of replacing', async ({ window }) => {
    const a = await createNote(window, 'Tab One');
    const b = await createNote(window, 'Tab Two');

    // Currently Tab Two is open. Cmd+Click Tab One to open it in a NEW tab.
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const noteA = window.locator('[data-note-id]').filter({ hasText: 'Tab One' });
    await noteA.click({ modifiers: [modifier] });
    await window.waitForTimeout(300);

    // Should have at least 2 tabs open
    const tabCount = await window.locator('[data-tab-id]').count();
    expect(tabCount).toBeGreaterThanOrEqual(2);

    // Both tabs should exist
    await expect(window.locator('[data-tab-id]').filter({ hasText: 'Tab One' })).toHaveCount(1);
    await expect(window.locator('[data-tab-id]').filter({ hasText: 'Tab Two' })).toHaveCount(1);
  });

  test('hover shows action buttons (⋯ and +)', async ({ window }) => {
    const id = await createNote(window, 'Hover Me');

    const noteEl = window.locator(`[data-note-id="${id}"]`);

    // Before hover, action buttons should not be visible (opacity-0)
    await noteEl.hover();
    await window.waitForTimeout(200);

    // The ⋯ options button should be visible on hover
    const optionsBtn = noteEl.locator('span[role="button"]').first();
    await expect(optionsBtn).toBeVisible();
  });

  test('dropdown menu ⋯ button opens menu with correct options', async ({ window }) => {
    const id = await createNote(window, 'Menu Note');

    const noteEl = window.locator(`[data-note-id="${id}"]`);
    await noteEl.hover();
    await window.waitForTimeout(200);

    // Click the ⋯ button (it's the MoreHorizontal icon)
    const moreBtn = noteEl.locator('span[role="button"]').first();
    await moreBtn.click();
    await window.waitForTimeout(200);

    // Dropdown menu should show
    await expect(window.getByText('Open in new tab')).toBeVisible();
    await expect(window.getByText('Add page inside')).toBeVisible();
    await expect(window.getByText('Move to Trash Bin')).toBeVisible();
  });

  test('+ button creates a child note inside the hovered note', async ({ window }) => {
    const parentId = await createNote(window, 'Plus Parent');

    const noteEl = window.locator(`[data-note-id="${parentId}"]`);
    await noteEl.hover();
    await window.waitForTimeout(200);

    // Click the + button (second role="button" in action buttons)
    const plusBtns = noteEl.locator('span[role="button"]');
    const plusBtn = plusBtns.last();
    await plusBtn.click();
    await window.waitForTimeout(500);

    // A child should exist
    const docs = await listDocumentsFromDb(window);
    const children = docs.filter((d) => d.parentId === parentId);
    expect(children).toHaveLength(1);

    // Child should be visible (parent auto-expanded)
    await expect(window.locator('[data-note-id]')).toHaveCount(2);
  });
});

test.describe('Sidebar Tree — Deep Nesting', () => {
  test('build a 5-level deep tree (max depth)', async ({ window }) => {
    const l0 = await createNote(window, 'Level 0');
    const l1 = await createNote(window, 'Level 1', l0);
    const l2 = await createNote(window, 'Level 2', l1);
    const l3 = await createNote(window, 'Level 3', l2);
    const l4 = await createNote(window, 'Level 4', l3);

    await expect(window.locator('[data-note-id]')).toHaveCount(5);

    const docs = await listDocumentsFromDb(window);
    expect(docs).toHaveLength(5);

    const d0 = docs.find((d) => d.title === 'Level 0')!;
    const d1 = docs.find((d) => d.title === 'Level 1')!;
    const d2 = docs.find((d) => d.title === 'Level 2')!;
    const d3 = docs.find((d) => d.title === 'Level 3')!;
    const d4 = docs.find((d) => d.title === 'Level 4')!;

    expect(d0.parentId).toBeNull();
    expect(d1.parentId).toBe(d0.id);
    expect(d2.parentId).toBe(d1.id);
    expect(d3.parentId).toBe(d2.id);
    expect(d4.parentId).toBe(d3.id);
  });

  test('multiple children under the same parent maintain order', async ({ window }) => {
    const parent = await createNote(window, 'Multi Parent');
    const c1 = await createNote(window, 'Child 1', parent);
    const c2 = await createNote(window, 'Child 2', parent);
    const c3 = await createNote(window, 'Child 3', parent);

    const docs = await listDocumentsFromDb(window);
    const children = docs
      .filter((d) => d.parentId === parent)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    expect(children.map((d) => d.title)).toEqual(['Child 3', 'Child 2', 'Child 1']);

    const titles = await getVisibleNoteTitles(window);
    expect(titles).toContain('Child 1');
    expect(titles).toContain('Child 2');
    expect(titles).toContain('Child 3');
  });

  test('collapsing a deeply nested branch hides all descendants', async ({ window }) => {
    const root = await createNote(window, 'Deep Root');
    const mid = await createNote(window, 'Deep Mid', root);
    const leaf = await createNote(window, 'Deep Leaf', mid);

    await expect(window.locator('[data-note-id]')).toHaveCount(3);

    const rootEl = window.locator('[data-note-id]').filter({ hasText: 'Deep Root' });
    await rootEl.hover();
    await window.waitForTimeout(200);
    await rootEl.locator('[aria-label="Collapse"]').click();
    await window.waitForTimeout(300);

    await expect(window.locator('[data-note-id]').filter({ hasText: 'Deep Root' })).toBeVisible();
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Deep Mid' })).not.toBeVisible();
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Deep Leaf' })).not.toBeVisible();
  });
});

// ── Circular dependency stress tests ────────────────────────────────

test.describe('Sidebar Tree — Circular Reference Prevention', () => {
  test('cannot move a note into itself', async ({ window }) => {
    const note = await createNote(window, 'Self Mover');

    let threw = false;
    try {
      await window.evaluate(
        ({ id }) => (window as any).lychee.invoke('documents.move', { id, parentId: id, sortOrder: 0 }),
        { id: note },
      );
    } catch { threw = true; }
    expect(threw).toBe(true);

    const doc = await getDocumentFromDb(window, note);
    expect(doc!.parentId).toBeNull();
  });

  test('cannot move parent into its grandchild', async ({ window }) => {
    const gp = await createNote(window, 'Grandparent');
    const p = await createNote(window, 'Parent CRP', gp);
    const gc = await createNote(window, 'Grandchild CRP', p);

    let threw = false;
    try {
      await window.evaluate(
        ({ id, parentId }) => (window as any).lychee.invoke('documents.move', { id, parentId, sortOrder: 0 }),
        { id: gp, parentId: gc },
      );
    } catch { threw = true; }
    expect(threw).toBe(true);

    const doc = await getDocumentFromDb(window, gp);
    expect(doc!.parentId).toBeNull();
  });

  test('cannot move parent into its great-grandchild (deep circular)', async ({ window }) => {
    const a = await createNote(window, 'Anc A');
    const b = await createNote(window, 'Anc B', a);
    const c = await createNote(window, 'Anc C', b);
    const d = await createNote(window, 'Anc D', c);

    let threw = false;
    try {
      await window.evaluate(
        ({ id, parentId }) => (window as any).lychee.invoke('documents.move', { id, parentId, sortOrder: 0 }),
        { id: a, parentId: d },
      );
    } catch { threw = true; }
    expect(threw).toBe(true);

    const doc = await getDocumentFromDb(window, a);
    expect(doc!.parentId).toBeNull();
  });

  test('cannot move mid-chain node into its own descendant', async ({ window }) => {
    const a = await createNote(window, 'Chain A');
    const b = await createNote(window, 'Chain B', a);
    const c = await createNote(window, 'Chain C', b);

    let threw = false;
    try {
      await window.evaluate(
        ({ id, parentId }) => (window as any).lychee.invoke('documents.move', { id, parentId, sortOrder: 0 }),
        { id: b, parentId: c },
      );
    } catch { threw = true; }
    expect(threw).toBe(true);

    const doc = await getDocumentFromDb(window, b);
    expect(doc!.parentId).toBe(a);
  });

  test('valid sibling-to-sibling move does NOT throw circular error', async ({ window }) => {
    const a = await createNote(window, 'Sib X');
    const b = await createNote(window, 'Sib Y');

    await dragNote(window, a, b, 'inside');

    const doc = await getDocumentFromDb(window, a);
    expect(doc!.parentId).toBe(b);
  });

  test('moving a subtree to a non-descendant is allowed', async ({ window }) => {
    const root1 = await createNote(window, 'Tree1 Root');
    const root2 = await createNote(window, 'Tree2 Root');
    const child1 = await createNote(window, 'Tree1 Child', root1);

    await dragNote(window, root1, root2, 'inside');

    const doc = await getDocumentFromDb(window, root1);
    expect(doc!.parentId).toBe(root2);

    // child1 should still be under root1
    const childDoc = await getDocumentFromDb(window, child1);
    expect(childDoc!.parentId).toBe(root1);
  });
});

// ── Cross-parent & subtree move stress tests ────────────────────────

test.describe('Sidebar Tree — Subtree Moves', () => {
  test('moving a parent preserves its children (subtree stays intact)', async ({ window }) => {
    const oldParent = await createNote(window, 'Old Home');
    const mover = await createNote(window, 'Subtree Root', oldParent);
    const child = await createNote(window, 'Subtree Child', mover);
    const grandchild = await createNote(window, 'Subtree GC', child);
    const newParent = await createNote(window, 'New Home');

    await dragNote(window, mover, newParent, 'inside');

    // Subtree root moved
    const moverDoc = await getDocumentFromDb(window, mover);
    expect(moverDoc!.parentId).toBe(newParent);

    // Children still point to their original parents within the subtree
    const childDoc = await getDocumentFromDb(window, child);
    expect(childDoc!.parentId).toBe(mover);
    const gcDoc = await getDocumentFromDb(window, grandchild);
    expect(gcDoc!.parentId).toBe(child);
  });

  test('move a deep child to root level', async ({ window }) => {
    const r = await createNote(window, 'DR');
    const c = await createNote(window, 'DC', r);
    const gc = await createNote(window, 'DGC', c);

    await dragNote(window, gc, r, 'before');

    const doc = await getDocumentFromDb(window, gc);
    expect(doc!.parentId).toBeNull();

    // r and c still linked
    const cDoc = await getDocumentFromDb(window, c);
    expect(cDoc!.parentId).toBe(r);
  });

  test('move note back and forth between parents preserves data', async ({ window }) => {
    const p1 = await createNote(window, 'Ping');
    const p2 = await createNote(window, 'Pong');
    const ball = await createNote(window, 'Ball', p1);

    await dragNote(window, ball, p2, 'inside');
    let doc = await getDocumentFromDb(window, ball);
    expect(doc!.parentId).toBe(p2);

    await dragNote(window, ball, p1, 'inside');
    doc = await getDocumentFromDb(window, ball);
    expect(doc!.parentId).toBe(p1);

    await dragNote(window, ball, p1, 'before');
    doc = await getDocumentFromDb(window, ball);
    expect(doc!.parentId).toBeNull();

    await dragNote(window, ball, p2, 'inside');
    doc = await getDocumentFromDb(window, ball);
    expect(doc!.parentId).toBe(p2);
  });

  test('swap two subtrees between parents', async ({ window }) => {
    const p1 = await createNote(window, 'Parent 1');
    const p2 = await createNote(window, 'Parent 2');
    const c1 = await createNote(window, 'Child of 1', p1);
    const c2 = await createNote(window, 'Child of 2', p2);

    await dragNote(window, c1, p2, 'inside');
    await dragNote(window, c2, p1, 'inside');

    const d1 = await getDocumentFromDb(window, c1);
    const d2 = await getDocumentFromDb(window, c2);
    expect(d1!.parentId).toBe(p2);
    expect(d2!.parentId).toBe(p1);
  });
});

// ── Sort order integrity stress tests ───────────────────────────────

test.describe('Sidebar Tree — Sort Order Integrity', () => {
  test('5 siblings: move first to last, verify no gaps', async ({ window }) => {
    const ids: string[] = [];
    for (const name of ['S1', 'S2', 'S3', 'S4', 'S5']) {
      ids.push(await createNote(window, name));
    }
    // Order: S5, S4, S3, S2, S1. Drag S5 after S1 (to last).
    await dragNote(window, ids[4], ids[0], 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    const orders = roots.map((d) => d.sortOrder);

    // No gaps: should be consecutive
    for (let i = 0; i < orders.length; i++) {
      expect(orders[i]).toBe(i);
    }
  });

  test('5 siblings: move last to first, verify no gaps', async ({ window }) => {
    const ids: string[] = [];
    for (const name of ['M1', 'M2', 'M3', 'M4', 'M5']) {
      ids.push(await createNote(window, name));
    }
    // Order: M5, M4, M3, M2, M1. Drag M1 before M5 (to first).
    await dragNote(window, ids[0], ids[4], 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    const orders = roots.map((d) => d.sortOrder);
    for (let i = 0; i < orders.length; i++) {
      expect(orders[i]).toBe(i);
    }
    expect(roots[0].title).toBe('M1');
  });

  test('sort order stays intact after nesting and un-nesting', async ({ window }) => {
    const a = await createNote(window, 'SO-A');
    const b = await createNote(window, 'SO-B');
    const c = await createNote(window, 'SO-C');

    await dragNote(window, b, a, 'inside');

    // Root siblings should still have consecutive sortOrder
    let docs = await listDocumentsFromDb(window);
    let roots = docs.filter((d) => d.parentId === null).sort((x, y) => x.sortOrder - y.sortOrder);
    expect(roots).toHaveLength(2); // A and C
    expect(roots[0].sortOrder).toBe(0);
    expect(roots[1].sortOrder).toBe(1);

    await dragNote(window, b, a, 'before');

    docs = await listDocumentsFromDb(window);
    roots = docs.filter((d) => d.parentId === null).sort((x, y) => x.sortOrder - y.sortOrder);
    expect(roots).toHaveLength(3);
    for (let i = 0; i < roots.length; i++) {
      expect(roots[i].sortOrder).toBe(i);
    }
  });

  test('child sort order is independent from root sort order', async ({ window }) => {
    const parent = await createNote(window, 'Iso Parent');
    const rootSib = await createNote(window, 'Iso Root Sib');
    const c1 = await createNote(window, 'Iso C1', parent);
    const c2 = await createNote(window, 'Iso C2', parent);
    const c3 = await createNote(window, 'Iso C3', parent);

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null);
    const children = docs.filter((d) => d.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder);

    // Root and child sort orders are independent namespaces
    expect(children.map((d) => d.sortOrder)).toEqual([0, 1, 2]);
    for (const r of roots) {
      expect(r.sortOrder).toBeGreaterThanOrEqual(0);
    }
  });

  test('rapid sequential reorders produce consistent sort order', async ({ window }) => {
    const a = await createNote(window, 'Rap A');
    const b = await createNote(window, 'Rap B');
    const c = await createNote(window, 'Rap C');
    const d = await createNote(window, 'Rap D');

    // Order: D, C, B, A. Reorder to A, D, B, C.
    await dragNote(window, a, d, 'before');
    await dragNote(window, b, c, 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((x) => x.parentId === null).sort((x, y) => x.sortOrder - y.sortOrder);

    // Should be A, D, B, C with consecutive sort orders
    expect(roots.map((d) => d.title)).toEqual(['Rap A', 'Rap D', 'Rap B', 'Rap C']);
    expect(roots.map((d) => d.sortOrder)).toEqual([0, 1, 2, 3]);
  });
});

// ── Trash & restore with nesting ────────────────────────────────────

test.describe('Sidebar Tree — Trash Cascading & Restore', () => {
  test('trashing a 3-deep root cascades deletedAt to all descendants', async ({ window }) => {
    const r = await createNote(window, 'Trash Root');
    const c = await createNote(window, 'Trash Mid', r);
    const gc = await createNote(window, 'Trash Leaf', c);

    const parentEl = window.locator('[data-note-id]').filter({ hasText: 'Trash Root' });
    await parentEl.click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

    for (const id of [r, c, gc]) {
      const doc = await getDocumentFromDb(window, id);
      expect(doc!.deletedAt).toBeTruthy();
    }
  });

  test('restoring a trashed parent also restores its children', async ({ window }) => {
    const r = await createNote(window, 'Rest Root');
    const c = await createNote(window, 'Rest Child', r);

    // Trash
    const el = window.locator('[data-note-id]').filter({ hasText: 'Rest Root' });
    await el.click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

    // Open trash and restore
    await window.locator('[aria-label="Trash Bin"]').click();
    await window.waitForTimeout(500);
    await window.locator('[aria-label="Restore"]').first().click();
    await window.waitForTimeout(500);
    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);

    // Both should be restored
    const rDoc = await getDocumentFromDb(window, r);
    const cDoc = await getDocumentFromDb(window, c);
    expect(rDoc!.deletedAt).toBeNull();
    expect(cDoc!.deletedAt).toBeNull();

    // Parent should appear in sidebar
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Rest Root' })).toBeVisible();

    // Expand the parent to reveal the restored child
    const parentEl = window.locator('[data-note-id]').filter({ hasText: 'Rest Root' });
    await parentEl.hover();
    await window.waitForTimeout(200);
    await parentEl.locator('[aria-label="Expand"]').click();
    await window.waitForTimeout(300);

    await expect(window.locator('[data-note-id]').filter({ hasText: 'Rest Child' })).toBeVisible();
  });

  test('trashing a nested child leaves parent intact', async ({ window }) => {
    const parent = await createNote(window, 'Surv Parent');
    const child = await createNote(window, 'Surv Child', parent);

    const childEl = window.locator('[data-note-id]').filter({ hasText: 'Surv Child' });
    await childEl.click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

    const pDoc = await getDocumentFromDb(window, parent);
    const cDoc = await getDocumentFromDb(window, child);
    expect(pDoc!.deletedAt).toBeNull();
    expect(cDoc!.deletedAt).toBeTruthy();

    await expect(window.locator('[data-note-id]').filter({ hasText: 'Surv Parent' })).toBeVisible();
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Surv Child' })).not.toBeVisible();
  });

  test('trash and restore preserves parentId', async ({ window }) => {
    const parent = await createNote(window, 'Pres Parent');
    const child = await createNote(window, 'Pres Child', parent);

    // Trash child only
    const childEl = window.locator('[data-note-id]').filter({ hasText: 'Pres Child' });
    await childEl.click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

    // Restore from trash
    await window.locator('[aria-label="Trash Bin"]').click();
    await window.waitForTimeout(500);
    await window.locator('[aria-label="Restore"]').first().click();
    await window.waitForTimeout(500);
    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);

    // parentId should be preserved after restore
    const doc = await getDocumentFromDb(window, child);
    expect(doc!.parentId).toBe(parent);
    expect(doc!.deletedAt).toBeNull();
  });

  test('permanent delete of a parent removes all descendants from DB', async ({ window }) => {
    const r = await createNote(window, 'Perm Root');
    const c = await createNote(window, 'Perm Child', r);
    const gc = await createNote(window, 'Perm GC', c);

    // Trash the root
    const el = window.locator('[data-note-id]').filter({ hasText: 'Perm Root' });
    await el.click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

    // Permanently delete from trash
    await window.locator('[aria-label="Trash Bin"]').click();
    await window.waitForTimeout(500);
    await window.locator('[aria-label="Permanently delete"]').first().click();
    await window.waitForTimeout(300);
    await window.getByRole('button', { name: 'Delete page' }).click();
    await window.waitForTimeout(500);

    // All 3 should be completely gone
    for (const id of [r, c, gc]) {
      const doc = await getDocumentFromDb(window, id);
      expect(doc).toBeNull();
    }
  });
});

// ── Large tree stress test ──────────────────────────────────────────

test.describe('Sidebar Tree — Stress', () => {
  test('create 10 root notes and verify all exist with correct order', async ({ window }) => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(await createNote(window, `Bulk ${i}`));
    }

    await expect(window.locator('[data-note-id]')).toHaveCount(10);

    const docs = await listDocumentsFromDb(window);
    expect(docs).toHaveLength(10);

    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    // Most recent (Bulk 9) should be first
    expect(roots[0].title).toBe('Bulk 9');
    expect(roots[9].title).toBe('Bulk 0');
  });

  test('wide + deep tree: 3 roots each with 3 children', async ({ window }) => {
    const roots: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await createNote(window, `WD Root ${i}`);
      roots.push(r);
      for (let j = 0; j < 3; j++) {
        await createNote(window, `WD R${i} C${j}`, r);
      }
    }

    const docs = await listDocumentsFromDb(window);
    expect(docs).toHaveLength(12);

    for (const r of roots) {
      const children = docs.filter((d) => d.parentId === r);
      expect(children).toHaveLength(3);
    }

    // All 12 should be visible (parents auto-expand)
    await expect(window.locator('[data-note-id]')).toHaveCount(12);
  });

  test('move notes across a large tree and verify no orphans', async ({ window }) => {
    const r1 = await createNote(window, 'Big R1');
    const r2 = await createNote(window, 'Big R2');
    const c1a = await createNote(window, 'C1a', r1);
    const c1b = await createNote(window, 'C1b', r1);
    const c2a = await createNote(window, 'C2a', r2);

    await dragNote(window, c1a, r2, 'inside');
    await dragNote(window, c2a, r1, 'before');
    await dragNote(window, r1, r2, 'inside');

    const docs = await listDocumentsFromDb(window);

    // r2 should have 3 children now: c1a, r1, and the original c2a is at root
    const r2Children = docs.filter((d) => d.parentId === r2);
    expect(r2Children.length).toBeGreaterThanOrEqual(2);

    // c2a should be at root
    const c2aDoc = await getDocumentFromDb(window, c2a);
    expect(c2aDoc!.parentId).toBeNull();

    // c1b should still be under r1 (moved with r1 into r2)
    const c1bDoc = await getDocumentFromDb(window, c1b);
    expect(c1bDoc!.parentId).toBe(r1);

    // No document should point to a parent that doesn't exist
    const allIds = new Set(docs.map((d) => d.id));
    for (const d of docs) {
      if (d.parentId !== null) {
        expect(allIds.has(d.parentId)).toBe(true);
      }
    }
  });

  test('move same note to every position among 4 siblings', async ({ window }) => {
    const a = await createNote(window, 'Pos A');
    const b = await createNote(window, 'Pos B');
    const c = await createNote(window, 'Pos C');
    const d = await createNote(window, 'Pos D');

    // Order: D, C, B, A. Cycle A through positions 0, 1, 2, 3.
    const targets: Array<{ id: string; pos: 'before' | 'after' }> = [
      { id: d, pos: 'before' }, // A first
      { id: d, pos: 'after' },  // A second
      { id: c, pos: 'after' },  // A third
      { id: b, pos: 'after' },  // A last
    ];
    for (let pos = 0; pos < 4; pos++) {
      await dragNote(window, a, targets[pos].id, targets[pos].pos);

      const docs = await listDocumentsFromDb(window);
      const roots = docs.filter((x) => x.parentId === null).sort((x, y) => x.sortOrder - y.sortOrder);

      for (let i = 0; i < roots.length; i++) {
        expect(roots[i].sortOrder).toBe(i);
      }

      const aDoc = roots.find((x) => x.title === 'Pos A')!;
      expect(aDoc.sortOrder).toBe(pos);
    }
  });
});
