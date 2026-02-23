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

/** Move a document via IPC (bypasses DnD UI, tests the full backend move stack). */
async function moveViaIpc(window: Page, id: string, parentId: string | null, sortOrder: number) {
  await window.evaluate(
    ({ id, parentId, sortOrder }) =>
      (window as any).lychee.invoke('documents.move', { id, parentId, sortOrder }),
    { id, parentId, sortOrder },
  );
  // Wait for the store to reload documents
  await window.waitForTimeout(500);
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

/** Simulate a native HTML5 drag from source note to target note. */
async function dragNote(
  window: Page,
  sourceId: string,
  targetId: string,
  position: 'before' | 'inside' | 'after',
) {
  await window.evaluate(
    ({ sourceId, targetId, position }) => {
      const source = document.querySelector(`[data-note-id="${sourceId}"]`);
      const target = document.querySelector(`[data-note-id="${targetId}"]`);
      if (!source || !target) throw new Error('Source or target not found');

      const dataTransfer = new DataTransfer();
      const targetRect = target.getBoundingClientRect();

      let clientY: number;
      if (position === 'before') {
        clientY = targetRect.top + 2;
      } else if (position === 'after') {
        clientY = targetRect.bottom - 2;
      } else {
        clientY = targetRect.top + targetRect.height / 2;
      }
      const clientX = targetRect.left + targetRect.width / 2;

      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));

      target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }));
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }));

      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
    },
    { sourceId, targetId, position },
  );
  await window.waitForTimeout(600);
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
  test('reorder siblings: move last note to first position via IPC', async ({ window }) => {
    const a = await createNote(window, 'DnD A');
    const b = await createNote(window, 'DnD B');
    const c = await createNote(window, 'DnD C');

    // Current order: C(0), B(1), A(2). Move A to position 0.
    await moveViaIpc(window, a, null, 0);

    const docs = await listDocumentsFromDb(window);
    const sorted = docs.sort((a, b) => a.sortOrder - b.sortOrder);
    expect(sorted.map((d) => d.title)).toEqual(['DnD A', 'DnD C', 'DnD B']);
  });

  test('nest a root note inside another via IPC and verify parentId', async ({ window }) => {
    const parent = await createNote(window, 'Nest Target');
    const child = await createNote(window, 'Will Be Nested');

    // Move "Will Be Nested" inside "Nest Target"
    await moveViaIpc(window, child, parent, 0);

    const childDoc = await getDocumentFromDb(window, child);
    expect(childDoc!.parentId).toBe(parent);
    expect(childDoc!.sortOrder).toBe(0);

    // The child should be visible under the parent in the sidebar
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Will Be Nested' })).toBeVisible();
  });

  test('un-nest: move a child to root level via IPC', async ({ window }) => {
    const parent = await createNote(window, 'Former Parent');
    const child = await createNote(window, 'Leaving Nest', parent);

    // Verify child is nested
    let childDoc = await getDocumentFromDb(window, child);
    expect(childDoc!.parentId).toBe(parent);

    // Move child to root level
    await moveViaIpc(window, child, null, 0);

    childDoc = await getDocumentFromDb(window, child);
    expect(childDoc!.parentId).toBeNull();

    // Both should be visible at root level
    const titles = await getVisibleNoteTitles(window);
    expect(titles).toContain('Former Parent');
    expect(titles).toContain('Leaving Nest');
  });

  test('move a note between two different parents', async ({ window }) => {
    const parentA = await createNote(window, 'Parent A');
    const parentB = await createNote(window, 'Parent B');
    const mover = await createNote(window, 'Moving Note', parentA);

    // Verify initial parent
    let doc = await getDocumentFromDb(window, mover);
    expect(doc!.parentId).toBe(parentA);

    // Move from Parent A to Parent B
    await moveViaIpc(window, mover, parentB, 0);

    doc = await getDocumentFromDb(window, mover);
    expect(doc!.parentId).toBe(parentB);

    // Verify Parent A has no children, Parent B has one
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

    // Try to move parent inside child — this should throw via IPC
    let errorThrown = false;
    try {
      await window.evaluate(
        ({ parentId, childId }) =>
          (window as any).lychee.invoke('documents.move', { id: parentId, parentId: childId, sortOrder: 0 }),
        { parentId: parent, childId: child },
      );
    } catch {
      errorThrown = true;
    }
    expect(errorThrown).toBe(true);

    // Parent should still be at root level
    const parentDoc = await getDocumentFromDb(window, parent);
    expect(parentDoc!.parentId).toBeNull();
  });

  test('reorder three siblings to reversed order via IPC', async ({ window }) => {
    const a = await createNote(window, 'Rev A');
    const b = await createNote(window, 'Rev B');
    const c = await createNote(window, 'Rev C');

    // Initial order: C(0), B(1), A(2). Reverse to A(0), B(1), C(2).
    await moveViaIpc(window, a, null, 0);
    await moveViaIpc(window, c, null, 2);

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots.map((d) => d.title)).toEqual(['Rev A', 'Rev B', 'Rev C']);
  });
});

test.describe('Sidebar Tree — Native Drag & Drop', () => {
  test('drag a note onto another to nest it (native DnD)', async ({ window }) => {
    const target = await createNote(window, 'Drop Target');
    const dragee = await createNote(window, 'Drag Me');

    // Perform native drag: drop "Drag Me" inside "Drop Target"
    await dragNote(window, dragee, target, 'inside');

    // Verify in the database that the dragged note is now a child
    const doc = await getDocumentFromDb(window, dragee);
    expect(doc!.parentId).toBe(target);
  });

  test('drag a note before another to reorder (native DnD)', async ({ window }) => {
    const a = await createNote(window, 'Drag A');
    const b = await createNote(window, 'Drag B');
    const c = await createNote(window, 'Drag C');

    // Initial order: C, B, A. Drag A before C.
    await dragNote(window, a, c, 'before');

    const docs = await listDocumentsFromDb(window);
    const roots = docs.filter((d) => d.parentId === null).sort((x, y) => x.sortOrder - y.sortOrder);
    // A should now be before C
    const aIdx = roots.findIndex((d) => d.title === 'Drag A');
    const cIdx = roots.findIndex((d) => d.title === 'Drag C');
    expect(aIdx).toBeLessThan(cIdx);
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

    // All 5 should be visible
    await expect(window.locator('[data-note-id]')).toHaveCount(5);

    // Verify the hierarchy in the database
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

    // Newest child should be first (sortOrder 0)
    expect(children.map((d) => d.title)).toEqual(['Child 3', 'Child 2', 'Child 1']);

    // All children should be visible under the parent
    const titles = await getVisibleNoteTitles(window);
    expect(titles).toContain('Child 1');
    expect(titles).toContain('Child 2');
    expect(titles).toContain('Child 3');
  });

  test('collapsing a deeply nested branch hides all descendants', async ({ window }) => {
    const root = await createNote(window, 'Deep Root');
    const mid = await createNote(window, 'Deep Mid', root);
    const leaf = await createNote(window, 'Deep Leaf', mid);

    // All visible
    await expect(window.locator('[data-note-id]')).toHaveCount(3);

    // Collapse root
    const rootEl = window.locator('[data-note-id]').filter({ hasText: 'Deep Root' });
    await rootEl.hover();
    await window.waitForTimeout(200);
    await rootEl.locator('[aria-label="Collapse"]').click();
    await window.waitForTimeout(300);

    // Only root visible; mid and leaf hidden
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Deep Root' })).toBeVisible();
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Deep Mid' })).not.toBeVisible();
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Deep Leaf' })).not.toBeVisible();
  });
});
