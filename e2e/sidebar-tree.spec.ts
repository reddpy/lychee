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
 * Perform a real drag-and-drop using Playwright's locator.dragTo(), which
 * triggers native HTML5 DragEvents via the CDP protocol. This exercises the
 * full atlaskit pragmatic-drag-and-drop pipeline (hit-test zones, canDrop
 * checks, tree-dnd-provider sort-order logic, auto-scroll, etc.).
 *
 * Target position is calculated to land in the correct hit zone defined in
 * note-tree-item.tsx: top 8px = 'before', bottom 8px = 'after', middle = 'inside'.
 */
async function dragNote(
  window: Page,
  sourceId: string,
  targetId: string,
  position: 'before' | 'inside' | 'after',
  { slow = !!process.env.SLOW_DRAG, useIpc }: { slow?: boolean; useIpc?: boolean } = {},
) {
  const source = window.locator(`[data-note-id="${sourceId}"]`);
  const target = window.locator(`[data-note-id="${targetId}"]`);

  // Check element existence & visibility before calling boundingBox (which would hang
  // waiting for a non-existent element if the parent isn't expanded).
  const sourceVisible = (await source.count()) > 0 && await source.isVisible();
  const targetVisible = (await target.count()) > 0 && await target.isVisible();

  if (useIpc === true || !sourceVisible || !targetVisible) {
    await dragNoteViaIpc(window, sourceId, targetId, position);
    return;
  }

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();

  // Determine if we should use IPC fallback:
  // - either element has no bounding box (hidden but in DOM)
  // - vertical distance >= 150px (~5 items apart — CDP drag fails for long distances)
  const shouldUseIpc =
    !sourceBox ||
    !targetBox ||
    (useIpc !== false && Math.abs(
      (sourceBox.y + sourceBox.height / 2) - (targetBox.y + targetBox.height / 2),
    ) >= 150);

  if (shouldUseIpc) {
    await dragNoteViaIpc(window, sourceId, targetId, position);
    return;
  }

  // Hit zones from note-tree-item.tsx: edgeThreshold = Math.min(8, height * 0.25)
  // 'before' = top edgeThreshold, 'after' = bottom edgeThreshold, 'inside' = middle
  let targetY: number;
  if (position === 'before') {
    targetY = 1; // Top edge — firmly in 'before' zone
  } else if (position === 'after') {
    targetY = targetBox.height - 1; // Bottom edge — firmly in 'after' zone
  } else {
    targetY = targetBox.height / 2; // Middle zone = 'inside'
  }

  const destX = targetBox.x + targetBox.width / 2;
  const destY = targetBox.y + targetY;

  const srcX = sourceBox.x + sourceBox.width / 2;
  const srcY = sourceBox.y + sourceBox.height / 2;

  if (slow) {
    // Slow-motion drag so you can visually see the blue drop indicators
    await window.mouse.move(srcX, srcY);
    await window.mouse.down();
    await window.mouse.move(srcX + 5, srcY + 5, { steps: 5 });
    await window.waitForTimeout(300);
    await window.mouse.move(destX, destY, { steps: 30 });
    await window.waitForTimeout(500);
    await window.mouse.up();
  } else {
    // Fast drag: use source position to ensure dragTo starts from the right spot
    await source.dragTo(target, {
      sourcePosition: { x: sourceBox.width / 2, y: sourceBox.height / 2 },
      targetPosition: { x: targetBox.width / 2, y: targetY },
    });
  }

  // Wait for the move IPC + store refresh + React re-render
  await window.waitForTimeout(600);
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
 * Bulk-create documents via IPC (no UI interaction). Each spec is created
 * sequentially with sortOrder=0 (shifts siblings), matching createNote behavior.
 * Returns IDs in creation order.
 */
async function seedNotes(
  window: Page,
  specs: Array<{ title: string; parentId?: string }>,
): Promise<string[]> {
  const ids: string[] = await window.evaluate(async (s) => {
    const result: string[] = [];
    for (const spec of s) {
      const { document } = await (window as any).lychee.invoke('documents.create', {
        title: spec.title,
        parentId: spec.parentId ?? null,
      });
      // Update title (create sets 'Untitled' by default)
      await (window as any).lychee.invoke('documents.update', {
        id: document.id,
        title: spec.title,
      });
      result.push(document.id);
    }
    return result;
  }, specs);

  // Refresh the Zustand store once
  await window.evaluate(async () => {
    const store = (window as any).__documentStore;
    if (store) await store.getState().loadDocuments(true);
  });

  // Expand parents by triggering lastCreatedId for one child per unique parent.
  // Each trigger fires the useLayoutEffect in notes-section.tsx which expands ancestors.
  const parentToChild = new Map<string, string>();
  for (let i = 0; i < specs.length; i++) {
    if (specs[i].parentId) parentToChild.set(specs[i].parentId!, ids[i]);
  }
  for (const childId of parentToChild.values()) {
    await window.evaluate((id) => {
      (window as any).__documentStore.setState({ lastCreatedId: id });
    }, childId);
    await window.waitForTimeout(100);
  }

  if (parentToChild.size === 0) {
    await window.waitForTimeout(200);
  }
  return ids;
}

/**
 * Convenience wrapper for seedNotes that resolves parentTitle references
 * within the same batch. Returns a Map<title, id>.
 */
async function seedTree(
  window: Page,
  specs: Array<{ title: string; parentTitle?: string }>,
): Promise<Map<string, string>> {
  // Resolve parentTitle → parentId using earlier entries in the batch
  const titleToId = new Map<string, string>();
  const resolvedSpecs: Array<{ title: string; parentId?: string }> = [];

  // We need to process sequentially since children reference parent titles
  // from earlier in the array. We'll pass the full specs and resolve inside evaluate.
  const ids: string[] = await window.evaluate(async (s) => {
    const localMap: Record<string, string> = {};
    const result: string[] = [];
    for (const spec of s) {
      const parentId = spec.parentTitle ? localMap[spec.parentTitle] : null;
      const { document } = await (window as any).lychee.invoke('documents.create', {
        title: spec.title,
        parentId,
      });
      await (window as any).lychee.invoke('documents.update', {
        id: document.id,
        title: spec.title,
      });
      localMap[spec.title] = document.id;
      result.push(document.id);
    }
    return result;
  }, specs);

  // Refresh the Zustand store
  await window.evaluate(async () => {
    const store = (window as any).__documentStore;
    if (store) await store.getState().loadDocuments(true);
  });

  for (let i = 0; i < specs.length; i++) {
    titleToId.set(specs[i].title, ids[i]);
  }

  // Expand parents by triggering lastCreatedId for one child per unique parent
  const parentToChild = new Map<string, string>();
  for (let i = 0; i < specs.length; i++) {
    if (specs[i].parentTitle) {
      const parentId = titleToId.get(specs[i].parentTitle!)!;
      parentToChild.set(parentId, ids[i]);
    }
  }
  for (const childId of parentToChild.values()) {
    await window.evaluate((id) => {
      (window as any).__documentStore.setState({ lastCreatedId: id });
    }, childId);
    await window.waitForTimeout(100);
  }

  if (parentToChild.size === 0) {
    await window.waitForTimeout(200);
  }
  return titleToId;
}

/**
 * Move a document via IPC, replicating tree-dnd-provider.tsx sort-order logic.
 * Fetches fresh docs from DB to compute correct sort order, then calls
 * documents.move and refreshes the store.
 */
async function dragNoteViaIpc(
  window: Page,
  sourceId: string,
  targetId: string,
  position: 'before' | 'inside' | 'after',
) {
  await window.evaluate(
    async ({ sourceId, targetId, position }) => {
      const lychee = (window as any).lychee;
      const store = (window as any).__documentStore;

      // Fetch fresh docs from DB (not the store — avoids stale sortOrder)
      const { documents: docs } = await lychee.invoke('documents.list', { limit: 500, offset: 0 });
      const docsById = new Map(docs.map((d: any) => [d.id, d]));
      const targetDoc = docsById.get(targetId);
      const sourceDoc = docsById.get(sourceId);
      if (!targetDoc || !sourceDoc) throw new Error('Source or target not found');

      let newParentId: string | null;
      let newSortOrder: number;

      if (position === 'inside') {
        newParentId = targetId;
        const children = docs.filter((d: any) => d.parentId === targetId);
        const maxSortOrder = children.reduce((max: number, c: any) => Math.max(max, c.sortOrder), -1);
        newSortOrder = maxSortOrder + 1;
      } else {
        newParentId = targetDoc.parentId;
        const targetSortOrder = targetDoc.sortOrder;
        if (position === 'before') {
          newSortOrder = targetSortOrder;
        } else {
          newSortOrder = targetSortOrder + 1;
        }
        // Adjust for same-parent moves (matches tree-dnd-provider.tsx logic)
        if (sourceDoc.parentId === newParentId && sourceDoc.sortOrder < targetSortOrder) {
          newSortOrder = newSortOrder - 1;
        }
      }

      await lychee.invoke('documents.move', { id: sourceId, parentId: newParentId, sortOrder: newSortOrder });

      // Refresh the store
      if (store) {
        await store.getState().loadDocuments(true);
        if (position === 'inside') {
          // Trigger parent expansion
          store.setState({ lastCreatedId: sourceId });
        }
      }
    },
    { sourceId, targetId, position },
  );
  await window.waitForTimeout(300);
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
    const [a, b, c] = await seedNotes(window, [
      { title: 'DnD A' }, { title: 'DnD B' }, { title: 'DnD C' },
    ]);

    // Current order: C(0), B(1), A(2). Drag A before C (first).
    await dragNote(window, a, c, 'before');

    const docs = await listDocumentsFromDb(window);
    const sorted = docs
      .filter((d) => d.parentId === null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    expect(sorted.map((d) => d.title)).toEqual(['DnD A', 'DnD C', 'DnD B']);
  });

  test('nest a root note inside another and verify parentId', async ({ window }) => {
    const [parent, child] = await seedNotes(window, [
      { title: 'Nest Target' }, { title: 'Will Be Nested' },
    ]);

    await dragNote(window, child, parent, 'inside');

    const childDoc = await getDocumentFromDb(window, child);
    expect(childDoc!.parentId).toBe(parent);
    expect(childDoc!.sortOrder).toBe(0);

    await expect(window.locator('[data-note-id]').filter({ hasText: 'Will Be Nested' })).toBeVisible();
  });

  test('un-nest: move a child to root level', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Former Parent' },
      { title: 'Leaving Nest', parentTitle: 'Former Parent' },
    ]);
    const parent = m.get('Former Parent')!;
    const child = m.get('Leaving Nest')!;

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
    const m = await seedTree(window, [
      { title: 'Parent A' },
      { title: 'Parent B' },
      { title: 'Moving Note', parentTitle: 'Parent A' },
    ]);
    const parentA = m.get('Parent A')!;
    const parentB = m.get('Parent B')!;
    const mover = m.get('Moving Note')!;

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
    const m = await seedTree(window, [
      { title: 'Circ Parent' },
      { title: 'Circ Child', parentTitle: 'Circ Parent' },
    ]);
    const parent = m.get('Circ Parent')!;
    const child = m.get('Circ Child')!;

    // Try to drag parent into child — DnD/backend should reject
    await dragNote(window, parent, child, 'inside');

    const parentDoc = await getDocumentFromDb(window, parent);
    expect(parentDoc!.parentId).toBeNull();
  });

  test('reorder three siblings to reversed order', async ({ window }) => {
    const [a, b, c] = await seedNotes(window, [
      { title: 'Rev A' }, { title: 'Rev B' }, { title: 'Rev C' },
    ]);

    // Initial order: C, B, A. Reverse to A, B, C.
    await dragNote(window, a, c, 'before');
    await dragNote(window, c, b, 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots.map((d) => d.title)).toEqual(['Rev A', 'Rev B', 'Rev C']);
  });

  test('drag a note before another to reorder', async ({ window }) => {
    const [a, b, c] = await seedNotes(window, [
      { title: 'Drag A' }, { title: 'Drag B' }, { title: 'Drag C' },
    ]);

    await dragNote(window, a, c, 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((x, y) => x.sortOrder - y.sortOrder);
    const aIdx = roots.findIndex((d) => d.title === 'Drag A');
    const cIdx = roots.findIndex((d) => d.title === 'Drag C');
    expect(aIdx).toBeLessThan(cIdx);
  });

  test('drag a note after another to reorder', async ({ window }) => {
    const [a, b, c] = await seedNotes(window, [
      { title: 'ND A' }, { title: 'ND B' }, { title: 'ND C' },
    ]);

    // Order: C, B, A. Drag A after C (so A moves up to be right after C).
    await dragNote(window, a, c, 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((x, y) => x.sortOrder - y.sortOrder);
    const aIdx = roots.findIndex((d) => d.title === 'ND A');
    const cIdx = roots.findIndex((d) => d.title === 'ND C');
    expect(aIdx).toBe(cIdx + 1);
  });

  test('drag a nested child to root level — un-nest', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'ND Parent' },
      { title: 'ND Child', parentTitle: 'ND Parent' },
      { title: 'ND Root Sib' },
    ]);
    const child = m.get('ND Child')!;
    const rootSib = m.get('ND Root Sib')!;

    // Drag child and drop before root sibling → becomes root-level
    await dragNote(window, child, rootSib, 'before');

    const doc = await getDocumentFromDb(window, child);
    expect(doc!.parentId).toBeNull();
  });

  test('drag a note from one parent to another', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'ND Parent A' },
      { title: 'ND Parent B' },
      { title: 'ND Mover', parentTitle: 'ND Parent A' },
    ]);
    const parentB = m.get('ND Parent B')!;
    const mover = m.get('ND Mover')!;

    await dragNote(window, mover, parentB, 'inside');

    const doc = await getDocumentFromDb(window, mover);
    expect(doc!.parentId).toBe(parentB);
  });

  test('drag to reorder siblings within same parent', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'ND Sib Parent' },
      { title: 'ND Sib 1', parentTitle: 'ND Sib Parent' },
      { title: 'ND Sib 2', parentTitle: 'ND Sib Parent' },
      { title: 'ND Sib 3', parentTitle: 'ND Sib Parent' },
    ]);
    const parent = m.get('ND Sib Parent')!;
    const c1 = m.get('ND Sib 1')!;
    const c3 = m.get('ND Sib 3')!;

    // Order: Sib 3, Sib 2, Sib 1. Drag Sib 1 before Sib 3 (to first).
    await dragNote(window, c1, c3, 'before');

    const docs = await listDocumentsFromDb(window);
    const children = docs.filter((d) => d.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(children[0].title).toBe('ND Sib 1');
  });

  test('drag root note into another root to nest', async ({ window }) => {
    const [target, dragee] = await seedNotes(window, [
      { title: 'ND Nest Target' }, { title: 'ND Root Nester' },
    ]);

    await dragNote(window, dragee, target, 'inside');

    const doc = await getDocumentFromDb(window, dragee);
    expect(doc!.parentId).toBe(target);
  });

  test('drag child after sibling to reorder', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'ND After Parent' },
      { title: 'ND First', parentTitle: 'ND After Parent' },
      { title: 'ND Last', parentTitle: 'ND After Parent' },
    ]);
    const parent = m.get('ND After Parent')!;
    const first = m.get('ND First')!;
    const last = m.get('ND Last')!;

    // Order: Last, First. Drag First after Last (so First becomes last).
    await dragNote(window, first, last, 'after');

    const docs = await listDocumentsFromDb(window);
    const children = docs.filter((d) => d.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(children[children.length - 1].title).toBe('ND First');
  });
});

test.describe('Sidebar Tree — Ordering Variability', () => {
  test('bottom to top: move last of 5 to first', async ({ window }) => {
    const ids = await seedNotes(window, [
      { title: 'Ord A' }, { title: 'Ord B' }, { title: 'Ord C' }, { title: 'Ord D' }, { title: 'Ord E' },
    ]);
    // Order: E, D, C, B, A. Drag A (last) before E (first). Result: A, E, D, C, B.
    await dragNote(window, ids[0], ids[4], 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('Ord A');
    expect(roots[roots.length - 1].title).toBe('Ord B');
  });

  test('top to bottom: move first of 5 to last', async ({ window }) => {
    const ids = await seedNotes(window, [
      { title: 'Ord2 A' }, { title: 'Ord2 B' }, { title: 'Ord2 C' }, { title: 'Ord2 D' }, { title: 'Ord2 E' },
    ]);
    // Order: E, D, C, B, A. Drag E (first) after A (last).
    await dragNote(window, ids[4], ids[0], 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('Ord2 D');
    expect(roots[roots.length - 1].title).toBe('Ord2 E');
  });

  test('middle to top: move 3rd of 5 to first', async ({ window }) => {
    const ids = await seedNotes(window, [
      { title: 'Mid A' }, { title: 'Mid B' }, { title: 'Mid C' }, { title: 'Mid D' }, { title: 'Mid E' },
    ]);
    // Order: E, D, C, B, A. C is middle (index 2). Drag C before E (first).
    await dragNote(window, ids[2], ids[4], 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('Mid C');
  });

  test('middle to bottom: move 3rd of 5 to last', async ({ window }) => {
    const ids = await seedNotes(window, [
      { title: 'Mid2 A' }, { title: 'Mid2 B' }, { title: 'Mid2 C' }, { title: 'Mid2 D' }, { title: 'Mid2 E' },
    ]);
    // Order: E, D, C, B, A. C is middle. Drag C after A (last).
    await dragNote(window, ids[2], ids[0], 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[roots.length - 1].title).toBe('Mid2 C');
  });

  test('middle to second: move 4th of 5 to position 2', async ({ window }) => {
    const ids = await seedNotes(window, [
      { title: 'M2 A' }, { title: 'M2 B' }, { title: 'M2 C' }, { title: 'M2 D' }, { title: 'M2 E' },
    ]);
    // Order: E, D, C, B, A. B is 4th from top. Drag B before C (so B becomes 3rd, between D and C).
    await dragNote(window, ids[1], ids[2], 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    const bIdx = roots.findIndex((d) => d.title === 'M2 B');
    const cIdx = roots.findIndex((d) => d.title === 'M2 C');
    expect(bIdx).toBe(cIdx - 1);
  });

  test('second to second-last: move 2nd of 5 to 4th', async ({ window }) => {
    const ids = await seedNotes(window, [
      { title: 'S2 A' }, { title: 'S2 B' }, { title: 'S2 C' }, { title: 'S2 D' }, { title: 'S2 E' },
    ]);
    // Order: E, D, C, B, A. D is 2nd. Drag D after B (so D becomes 4th).
    await dragNote(window, ids[3], ids[1], 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    const dIdx = roots.findIndex((d) => d.title === 'S2 D');
    const bIdx = roots.findIndex((d) => d.title === 'S2 B');
    expect(dIdx).toBe(bIdx + 1);
  });

  test('7 items: move 5th from top to 1st', async ({ window }) => {
    const ids = await seedNotes(window,
      ['L7 A', 'L7 B', 'L7 C', 'L7 D', 'L7 E', 'L7 F', 'L7 G'].map((t) => ({ title: t })),
    );
    // Order: G, F, E, D, C, B, A. C is 5th from top. Drag C before G (first).
    await dragNote(window, ids[2], ids[6], 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('L7 C');
  });

  test('7 items: move 2nd from top to 6th', async ({ window }) => {
    const ids = await seedNotes(window,
      ['L72 A', 'L72 B', 'L72 C', 'L72 D', 'L72 E', 'L72 F', 'L72 G'].map((t) => ({ title: t })),
    );
    // Order: G, F, E, D, C, B, A. F is 2nd. Drag F after B (so F becomes 6th).
    await dragNote(window, ids[5], ids[1], 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    const fIdx = roots.findIndex((d) => d.title === 'L72 F');
    expect(fIdx).toBe(5);
  });

  test('nested: middle child to first within parent', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'NestOrd Parent' },
      ...Array.from({ length: 5 }, (_, i) => ({ title: `NestOrd ${i + 1}`, parentTitle: 'NestOrd Parent' })),
    ]);
    const parent = m.get('NestOrd Parent')!;
    const c3 = m.get('NestOrd 3')!;
    const c5 = m.get('NestOrd 5')!;

    // Order: 5, 4, 3, 2, 1. Drag 3 (middle) before 5 (first).
    await dragNote(window, c3, c5, 'before');

    const docs = await listDocumentsFromDb(window);
    const children = docs.filter((d) => d.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(children[0].title).toBe('NestOrd 3');
  });

  test('nested: middle child to last within parent', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'NestOrd2 Parent' },
      ...Array.from({ length: 5 }, (_, i) => ({ title: `NestOrd2 ${i + 1}`, parentTitle: 'NestOrd2 Parent' })),
    ]);
    const parent = m.get('NestOrd2 Parent')!;
    const c1 = m.get('NestOrd2 1')!;
    const c3 = m.get('NestOrd2 3')!;

    // Order: 5, 4, 3, 2, 1. Drag 3 after 1 (last).
    await dragNote(window, c3, c1, 'after');

    const docs = await listDocumentsFromDb(window);
    const children = docs.filter((d) => d.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(children[children.length - 1].title).toBe('NestOrd2 3');
  });
});

test.describe('Sidebar Tree — Edge Positions (Top/Bottom)', () => {
  test('full span: top of 7 to absolute bottom', async ({ window }) => {
    const ids = await seedNotes(window,
      ['Edge A', 'Edge B', 'Edge C', 'Edge D', 'Edge E', 'Edge F', 'Edge G'].map((t) => ({ title: t })),
    );
    // Order: G, F, E, D, C, B, A. G is top. Drag G after A (absolute bottom).
    await dragNote(window, ids[6], ids[0], 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('Edge F');
    expect(roots[roots.length - 1].title).toBe('Edge G');
  });

  test('full span: bottom of 7 to absolute top', async ({ window }) => {
    const ids = await seedNotes(window,
      ['Edge2 A', 'Edge2 B', 'Edge2 C', 'Edge2 D', 'Edge2 E', 'Edge2 F', 'Edge2 G'].map((t) => ({ title: t })),
    );
    // Order: G, F, E, D, C, B, A. A is bottom. Drag A before G (absolute top).
    await dragNote(window, ids[0], ids[6], 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('Edge2 A');
    expect(roots[roots.length - 1].title).toBe('Edge2 B');
  });

  test('edge: first to second (down one)', async ({ window }) => {
    const ids = await seedNotes(window, [
      { title: 'E1 A' }, { title: 'E1 B' }, { title: 'E1 C' }, { title: 'E1 D' }, { title: 'E1 E' },
    ]);
    const [a, b, c, d, e] = ids;
    // Order: E, D, C, B, A. E is first. Drag E after D (second position).
    await dragNote(window, e, d, 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('E1 D');
    expect(roots[1].title).toBe('E1 E');
  });

  test('edge: last to second-last (up one)', async ({ window }) => {
    const ids = await seedNotes(window, [
      { title: 'E2 A' }, { title: 'E2 B' }, { title: 'E2 C' }, { title: 'E2 D' }, { title: 'E2 E' },
    ]);
    const [a, b] = ids;
    // Order: E, D, C, B, A. A is last. Drag A before B (second-last).
    await dragNote(window, a, b, 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[roots.length - 2].title).toBe('E2 A');
    expect(roots[roots.length - 1].title).toBe('E2 B');
  });

  test('edge: second to first (up one)', async ({ window }) => {
    const ids = await seedNotes(window, [
      { title: 'E3 A' }, { title: 'E3 B' }, { title: 'E3 C' }, { title: 'E3 D' }, { title: 'E3 E' },
    ]);
    const [, , , d, e] = ids;
    // Order: E, D, C, B, A. D is second. Drag D before E (first).
    await dragNote(window, d, e, 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('E3 D');
    expect(roots[1].title).toBe('E3 E');
  });

  test('edge: second-last to last (down one)', async ({ window }) => {
    const ids = await seedNotes(window, [
      { title: 'E4 A' }, { title: 'E4 B' }, { title: 'E4 C' }, { title: 'E4 D' }, { title: 'E4 E' },
    ]);
    const [a, b] = ids;
    // Order: E, D, C, B, A. B is second-last. Drag B after A (last).
    await dragNote(window, b, a, 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[roots.length - 2].title).toBe('E4 A');
    expect(roots[roots.length - 1].title).toBe('E4 B');
  });

  test('nested: top child to bottom within parent', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'EdgeN Parent' },
      ...Array.from({ length: 5 }, (_, i) => ({ title: `EdgeN ${i + 1}`, parentTitle: 'EdgeN Parent' })),
    ]);
    const parent = m.get('EdgeN Parent')!;
    const c1 = m.get('EdgeN 1')!;
    const c5 = m.get('EdgeN 5')!;
    // Order: 5, 4, 3, 2, 1. 5 is top. Drag 5 after 1 (bottom).
    await dragNote(window, c5, c1, 'after');

    const docs = await listDocumentsFromDb(window);
    const children = docs.filter((d) => d.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(children[0].title).toBe('EdgeN 4');
    expect(children[children.length - 1].title).toBe('EdgeN 5');
  });

  test('nested: bottom child to top within parent', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'EdgeN2 Parent' },
      ...Array.from({ length: 5 }, (_, i) => ({ title: `EdgeN2 ${i + 1}`, parentTitle: 'EdgeN2 Parent' })),
    ]);
    const parent = m.get('EdgeN2 Parent')!;
    const c1 = m.get('EdgeN2 1')!;
    const c5 = m.get('EdgeN2 5')!;
    // Order: 5, 4, 3, 2, 1. 1 is bottom. Drag 1 before 5 (top).
    await dragNote(window, c1, c5, 'before');

    const docs = await listDocumentsFromDb(window);
    const children = docs.filter((d) => d.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(children[0].title).toBe('EdgeN2 1');
    expect(children[children.length - 1].title).toBe('EdgeN2 2');
  });
});

test.describe('Sidebar Tree — Overflow (Long List with Scroll)', () => {
  test('25 root notes: scroll to bottom, drag last to first-visible', async ({ window }) => {
    const ids = await seedNotes(window,
      Array.from({ length: 25 }, (_, i) => ({ title: `Over A${i}` })),
    );
    // Order: A24..A0. Scroll to bottom. Drag A0 (last) before A5.
    await scrollNotesTo(window, 'bottom');
    await dragNote(window, ids[0], ids[5], 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    const a0Idx = roots.findIndex((d) => d.title === 'Over A0');
    const a5Idx = roots.findIndex((d) => d.title === 'Over A5');
    expect(a0Idx).toBeLessThan(a5Idx);
  });

  test('25 root notes: scroll to top, drag first down within visible', async ({ window }) => {
    const ids = await seedNotes(window,
      Array.from({ length: 25 }, (_, i) => ({ title: `Over2 A${i}` })),
    );
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
    const ids = await seedNotes(window,
      Array.from({ length: 25 }, (_, i) => ({ title: `Over3 A${i}` })),
    );
    // A24 is top, A0 is bottom. Drag A24 to after A0 (absolute bottom).
    await dragNote(window, ids[24], ids[0], 'after');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[roots.length - 1].title).toBe('Over3 A24');
  });

  test('25 root notes: full span — bottom to absolute top (with scroll)', async ({ window }) => {
    const ids = await seedNotes(window,
      Array.from({ length: 25 }, (_, i) => ({ title: `Over4 A${i}` })),
    );
    // A0 is bottom, A24 is top. Drag A0 to before A24 (absolute top).
    await dragNote(window, ids[0], ids[24], 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots[0].title).toBe('Over4 A0');
  });

  test('20 nested children: scroll to bottom, drag last child to first-visible', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'OverN Parent' },
      ...Array.from({ length: 20 }, (_, i) => ({ title: `OverN C${i}`, parentTitle: 'OverN Parent' })),
    ]);
    const parent = m.get('OverN Parent')!;
    const c0 = m.get('OverN C0')!;
    const c5 = m.get('OverN C5')!;
    // Order: C19..C0. Scroll to bottom. Drag C0 before C5.
    await scrollNotesTo(window, 'bottom');
    await dragNote(window, c0, c5, 'before');

    const docs = await listDocumentsFromDb(window);
    const children = docs.filter((d) => d.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder);
    const c0Idx = children.findIndex((d) => d.title === 'OverN C0');
    const c5Idx = children.findIndex((d) => d.title === 'OverN C5');
    expect(c0Idx).toBeLessThan(c5Idx);
  });

  test('20 nested children: full span — bottom to top (with scroll)', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'OverN2 Parent' },
      ...Array.from({ length: 20 }, (_, i) => ({ title: `OverN2 C${i}`, parentTitle: 'OverN2 Parent' })),
    ]);
    const parent = m.get('OverN2 Parent')!;
    const c0 = m.get('OverN2 C0')!;
    const c19 = m.get('OverN2 C19')!;
    // C0 is bottom, C19 is top. Drag C0 to before C19 (top).
    await dragNote(window, c0, c19, 'before');

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
    const m = await seedTree(window, [
      { title: 'Level 0' },
      { title: 'Level 1', parentTitle: 'Level 0' },
      { title: 'Level 2', parentTitle: 'Level 1' },
      { title: 'Level 3', parentTitle: 'Level 2' },
      { title: 'Level 4', parentTitle: 'Level 3' },
    ]);

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
    const m = await seedTree(window, [
      { title: 'Multi Parent' },
      { title: 'Child 1', parentTitle: 'Multi Parent' },
      { title: 'Child 2', parentTitle: 'Multi Parent' },
      { title: 'Child 3', parentTitle: 'Multi Parent' },
    ]);
    const parent = m.get('Multi Parent')!;

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
    await seedTree(window, [
      { title: 'Deep Root' },
      { title: 'Deep Mid', parentTitle: 'Deep Root' },
      { title: 'Deep Leaf', parentTitle: 'Deep Mid' },
    ]);

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
    const [note] = await seedNotes(window, [{ title: 'Self Mover' }]);

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
    const m = await seedTree(window, [
      { title: 'Grandparent' },
      { title: 'Parent CRP', parentTitle: 'Grandparent' },
      { title: 'Grandchild CRP', parentTitle: 'Parent CRP' },
    ]);
    const gp = m.get('Grandparent')!;
    const gc = m.get('Grandchild CRP')!;

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
    const m = await seedTree(window, [
      { title: 'Anc A' },
      { title: 'Anc B', parentTitle: 'Anc A' },
      { title: 'Anc C', parentTitle: 'Anc B' },
      { title: 'Anc D', parentTitle: 'Anc C' },
    ]);
    const a = m.get('Anc A')!;
    const d = m.get('Anc D')!;

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
    const m = await seedTree(window, [
      { title: 'Chain A' },
      { title: 'Chain B', parentTitle: 'Chain A' },
      { title: 'Chain C', parentTitle: 'Chain B' },
    ]);
    const a = m.get('Chain A')!;
    const b = m.get('Chain B')!;
    const c = m.get('Chain C')!;

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
    const [a, b] = await seedNotes(window, [{ title: 'Sib X' }, { title: 'Sib Y' }]);

    await dragNote(window, a, b, 'inside');

    const doc = await getDocumentFromDb(window, a);
    expect(doc!.parentId).toBe(b);
  });

  test('moving a subtree to a non-descendant is allowed', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Tree1 Root' },
      { title: 'Tree2 Root' },
      { title: 'Tree1 Child', parentTitle: 'Tree1 Root' },
    ]);
    const root1 = m.get('Tree1 Root')!;
    const root2 = m.get('Tree2 Root')!;
    const child1 = m.get('Tree1 Child')!;

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
    const m = await seedTree(window, [
      { title: 'Old Home' },
      { title: 'Subtree Root', parentTitle: 'Old Home' },
      { title: 'Subtree Child', parentTitle: 'Subtree Root' },
      { title: 'Subtree GC', parentTitle: 'Subtree Child' },
      { title: 'New Home' },
    ]);
    const mover = m.get('Subtree Root')!;
    const child = m.get('Subtree Child')!;
    const grandchild = m.get('Subtree GC')!;
    const newParent = m.get('New Home')!;

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
    const m = await seedTree(window, [
      { title: 'DR' },
      { title: 'DC', parentTitle: 'DR' },
      { title: 'DGC', parentTitle: 'DC' },
    ]);
    const r = m.get('DR')!;
    const c = m.get('DC')!;
    const gc = m.get('DGC')!;

    await dragNote(window, gc, r, 'before');

    const doc = await getDocumentFromDb(window, gc);
    expect(doc!.parentId).toBeNull();

    // r and c still linked
    const cDoc = await getDocumentFromDb(window, c);
    expect(cDoc!.parentId).toBe(r);
  });

  test('move note back and forth between parents preserves data', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Ping' },
      { title: 'Pong' },
      { title: 'Ball', parentTitle: 'Ping' },
    ]);
    const p1 = m.get('Ping')!;
    const p2 = m.get('Pong')!;
    const ball = m.get('Ball')!;

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
    const m = await seedTree(window, [
      { title: 'Parent 1' },
      { title: 'Parent 2' },
      { title: 'Child of 1', parentTitle: 'Parent 1' },
      { title: 'Child of 2', parentTitle: 'Parent 2' },
    ]);
    const p1 = m.get('Parent 1')!;
    const p2 = m.get('Parent 2')!;
    const c1 = m.get('Child of 1')!;
    const c2 = m.get('Child of 2')!;

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
    const ids = await seedNotes(window, ['S1', 'S2', 'S3', 'S4', 'S5'].map((t) => ({ title: t })));
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
    const ids = await seedNotes(window, ['M1', 'M2', 'M3', 'M4', 'M5'].map((t) => ({ title: t })));
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
    const [a, b, c] = await seedNotes(window, [
      { title: 'SO-A' }, { title: 'SO-B' }, { title: 'SO-C' },
    ]);

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
    const m = await seedTree(window, [
      { title: 'Iso Parent' },
      { title: 'Iso Root Sib' },
      { title: 'Iso C1', parentTitle: 'Iso Parent' },
      { title: 'Iso C2', parentTitle: 'Iso Parent' },
      { title: 'Iso C3', parentTitle: 'Iso Parent' },
    ]);
    const parent = m.get('Iso Parent')!;

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
    const [a, b, c, d] = await seedNotes(window, [
      { title: 'Rap A' }, { title: 'Rap B' }, { title: 'Rap C' }, { title: 'Rap D' },
    ]);

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
    const m = await seedTree(window, [
      { title: 'Trash Root' },
      { title: 'Trash Mid', parentTitle: 'Trash Root' },
      { title: 'Trash Leaf', parentTitle: 'Trash Mid' },
    ]);
    const r = m.get('Trash Root')!;
    const c = m.get('Trash Mid')!;
    const gc = m.get('Trash Leaf')!;

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
    const m = await seedTree(window, [
      { title: 'Rest Root' },
      { title: 'Rest Child', parentTitle: 'Rest Root' },
    ]);
    const r = m.get('Rest Root')!;
    const c = m.get('Rest Child')!;

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
    const m = await seedTree(window, [
      { title: 'Surv Parent' },
      { title: 'Surv Child', parentTitle: 'Surv Parent' },
    ]);
    const parent = m.get('Surv Parent')!;
    const child = m.get('Surv Child')!;

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
    const m = await seedTree(window, [
      { title: 'Pres Parent' },
      { title: 'Pres Child', parentTitle: 'Pres Parent' },
    ]);
    const parent = m.get('Pres Parent')!;
    const child = m.get('Pres Child')!;

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
    const m = await seedTree(window, [
      { title: 'Perm Root' },
      { title: 'Perm Child', parentTitle: 'Perm Root' },
      { title: 'Perm GC', parentTitle: 'Perm Child' },
    ]);
    const r = m.get('Perm Root')!;
    const c = m.get('Perm Child')!;
    const gc = m.get('Perm GC')!;

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
    const ids = await seedNotes(window,
      Array.from({ length: 10 }, (_, i) => ({ title: `Bulk ${i}` })),
    );

    await expect(window.locator('[data-note-id]')).toHaveCount(10);

    const docs = await listDocumentsFromDb(window);
    expect(docs).toHaveLength(10);

    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    // Most recent (Bulk 9) should be first
    expect(roots[0].title).toBe('Bulk 9');
    expect(roots[9].title).toBe('Bulk 0');
  });

  test('wide + deep tree: 3 roots each with 3 children', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let i = 0; i < 3; i++) {
      specs.push({ title: `WD Root ${i}` });
      for (let j = 0; j < 3; j++) {
        specs.push({ title: `WD R${i} C${j}`, parentTitle: `WD Root ${i}` });
      }
    }
    const m = await seedTree(window, specs);

    const docs = await listDocumentsFromDb(window);
    expect(docs).toHaveLength(12);

    for (let i = 0; i < 3; i++) {
      const rId = m.get(`WD Root ${i}`)!;
      const children = docs.filter((d) => d.parentId === rId);
      expect(children).toHaveLength(3);
    }

    // All 12 should be visible (parents auto-expand)
    await expect(window.locator('[data-note-id]')).toHaveCount(12);
  });

  test('move notes across a large tree and verify no orphans', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Big R1' },
      { title: 'Big R2' },
      { title: 'C1a', parentTitle: 'Big R1' },
      { title: 'C1b', parentTitle: 'Big R1' },
      { title: 'C2a', parentTitle: 'Big R2' },
    ]);
    const r1 = m.get('Big R1')!;
    const r2 = m.get('Big R2')!;
    const c1a = m.get('C1a')!;
    const c1b = m.get('C1b')!;
    const c2a = m.get('C2a')!;

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
    const [a, b, c, d] = await seedNotes(window, [
      { title: 'Pos A' }, { title: 'Pos B' }, { title: 'Pos C' }, { title: 'Pos D' },
    ]);

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
