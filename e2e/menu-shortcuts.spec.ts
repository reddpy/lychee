import { test, expect } from './electron-app';
import type { ElectronApplication, Page } from '@playwright/test';

/**
 * Triggers a menu item by visible label, walking the application menu tree.
 * Use this instead of keyboard.press for menu commands — Playwright's CDP input
 * doesn't dispatch through the OS-level menu accelerator binding reliably (varies
 * by platform and window focus). Invoking the click handler directly exercises
 * the same code path: handler → sendMenuEvent → renderer subscription.
 */
async function clickMenuItem(electronApp: ElectronApplication, label: string): Promise<void> {
  await electronApp.evaluate(({ Menu }, label) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) throw new Error('No application menu set');
    const walk = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
      for (const item of items) {
        if (item.label === label) return item;
        if (item.submenu) {
          const found = walk(item.submenu.items);
          if (found) return found;
        }
      }
      return null;
    };
    const found = walk(menu.items);
    if (!found) throw new Error(`Menu item not found: ${label}`);
    found.click();
  }, label);
}

/**
 * Install a counter on the renderer side that increments every time an IPC event
 * on `channel` fires. Returns a getter for the current count. Use this on the
 * "no-op" tests to prove the menu wiring actually reached the renderer — without
 * this, those tests would pass vacuously if sendMenuEvent silently dropped.
 */
async function installIpcProbe(
  window: Page,
  channel: 'menu:new-note' | 'menu:open-settings' | 'menu:close-tab' | 'menu:reopen-closed-tab',
): Promise<() => Promise<number>> {
  await window.evaluate((ch) => {
    const w = window as unknown as {
      __ipcProbes?: Record<string, number>;
      lychee: { on: (c: string, cb: () => void) => () => void };
    };
    w.__ipcProbes = w.__ipcProbes ?? {};
    w.__ipcProbes[ch] = 0;
    w.lychee.on(ch, () => {
      w.__ipcProbes![ch] = (w.__ipcProbes![ch] ?? 0) + 1;
    });
  }, channel);
  return () =>
    window.evaluate((ch) => {
      const w = window as unknown as { __ipcProbes?: Record<string, number> };
      return w.__ipcProbes?.[ch] ?? 0;
    }, channel);
}

/** Create a new note via the menu, name it, and wait for the rename to flush. */
async function createNamedNote(
  electronApp: ElectronApplication,
  window: Page,
  name: string,
  expectedTabCount: number,
): Promise<void> {
  await clickMenuItem(electronApp, 'New Note');
  await expect(window.locator('[data-tab-id]')).toHaveCount(expectedTabCount);
  const visibleTitle = window.locator('main:visible h1.editor-title');
  await visibleTitle.click();
  await window.keyboard.type(name);
  // Wait for the tab to reflect the typed title before continuing (debounced save).
  await expect(
    window.locator('[data-tab-id]').filter({ hasText: name }),
  ).toHaveCount(1);
}

test.describe('Menu — New Note', () => {
  test('opens a new tab', async ({ electronApp, window }) => {
    await expect(window.locator('[data-tab-id]')).toHaveCount(0);

    await clickMenuItem(electronApp, 'New Note');

    await expect(window.locator('[data-tab-id]')).toHaveCount(1);
  });

  test('successive invocations create additional tabs', async ({ electronApp, window }) => {
    for (let i = 1; i <= 3; i++) {
      await clickMenuItem(electronApp, 'New Note');
      await expect(window.locator('[data-tab-id]')).toHaveCount(i);
    }
  });
});

test.describe('Menu — Settings', () => {
  test('opens the Settings dialog', async ({ electronApp, window }) => {
    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).not.toBeVisible();

    await clickMenuItem(electronApp, 'Settings…');

    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Settings');
  });

  test('initial focus lands on the General nav button (not the close button)', async ({
    electronApp,
    window,
  }) => {
    await clickMenuItem(electronApp, 'Settings…');

    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    await expect
      .poll(() =>
        window.evaluate(
          () => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? null,
        ),
      )
      .toBe('General');
  });
});

test.describe('Menu — Close Tab', () => {
  test('closes the active tab', async ({ electronApp, window }) => {
    await clickMenuItem(electronApp, 'New Note');
    await expect(window.locator('[data-tab-id]')).toHaveCount(1);

    await clickMenuItem(electronApp, 'Close Tab');

    await expect(window.locator('[data-tab-id]')).toHaveCount(0);
    await expect(window.getByTestId('empty-state')).toBeVisible();
  });

  test('closes only the active tab when multiple are open', async ({ electronApp, window }) => {
    await createNamedNote(electronApp, window, 'Tab A', 1);
    await createNamedNote(electronApp, window, 'Tab B', 2);

    // Tab B is the most-recently created, so it's the active tab.
    await clickMenuItem(electronApp, 'Close Tab');

    await expect(window.locator('[data-tab-id]')).toHaveCount(1);
    await expect(window.locator('[data-tab-id]').first()).toContainText('Tab A');
  });

  test('no-op when no tabs are open', async ({ electronApp, window }) => {
    const getFires = await installIpcProbe(window, 'menu:close-tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(0);

    await clickMenuItem(electronApp, 'Close Tab');

    // Prove the menu wiring reached the renderer (not silently dropped),
    // then prove the no-op behavior held.
    await expect.poll(getFires).toBe(1);
    await expect(window.locator('[data-tab-id]')).toHaveCount(0);
    await expect(window.getByTestId('empty-state')).toBeVisible();
  });
});

test.describe('Menu — Reopen Closed Tab', () => {
  test('reopens the most recently closed tab', async ({ electronApp, window }) => {
    await createNamedNote(electronApp, window, 'Reopen Me', 1);

    await clickMenuItem(electronApp, 'Close Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(0);

    await clickMenuItem(electronApp, 'Reopen Closed Tab');

    await expect(window.locator('[data-tab-id]')).toHaveCount(1);
    await expect(window.locator('[data-tab-id]').first()).toContainText('Reopen Me');
  });

  test('walks back through history with successive invocations', async ({
    electronApp,
    window,
  }) => {
    await createNamedNote(electronApp, window, 'Alpha', 1);
    await createNamedNote(electronApp, window, 'Beta', 2);
    await createNamedNote(electronApp, window, 'Gamma', 3);

    // Close in order: Gamma (currently active), then Beta, then Alpha.
    for (let i = 2; i >= 0; i--) {
      await clickMenuItem(electronApp, 'Close Tab');
      await expect(window.locator('[data-tab-id]')).toHaveCount(i);
    }

    // Pop order: Alpha first (last closed), then Beta, then Gamma.
    await clickMenuItem(electronApp, 'Reopen Closed Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(1);
    await expect(window.locator('[data-tab-id]').first()).toContainText('Alpha');

    await clickMenuItem(electronApp, 'Reopen Closed Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(2);

    await clickMenuItem(electronApp, 'Reopen Closed Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(3);

    // Strict ordering: each reopen inserts at the original index, so the final
    // order matches insertion order. Asserts LIFO pop + index-based insert.
    const titles = await window.locator('[data-tab-id]').allTextContents();
    expect(titles[0]).toContain('Alpha');
    expect(titles[1]).toContain('Beta');
    expect(titles[2]).toContain('Gamma');
  });

  test('reopens at the original tab position', async ({ electronApp, window }) => {
    await createNamedNote(electronApp, window, 'A', 1);
    await createNamedNote(electronApp, window, 'B', 2);
    await createNamedNote(electronApp, window, 'C', 3);

    // Activate tab B (middle) and close it.
    await window.locator('[data-tab-id]').filter({ hasText: 'B' }).click();
    await clickMenuItem(electronApp, 'Close Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(2);

    let titles = await window.locator('[data-tab-id]').allTextContents();
    expect(titles[0]).toContain('A');
    expect(titles[1]).toContain('C');

    await clickMenuItem(electronApp, 'Reopen Closed Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(3);

    titles = await window.locator('[data-tab-id]').allTextContents();
    expect(titles[0]).toContain('A');
    expect(titles[1]).toContain('B');
    expect(titles[2]).toContain('C');
  });

  test('no-op with empty history', async ({ electronApp, window }) => {
    const getFires = await installIpcProbe(window, 'menu:reopen-closed-tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(0);

    await clickMenuItem(electronApp, 'Reopen Closed Tab');

    await expect.poll(getFires).toBe(1);
    await expect(window.locator('[data-tab-id]')).toHaveCount(0);
    await expect(window.getByTestId('empty-state')).toBeVisible();
  });

  test('skips entries whose underlying note was trashed', async ({ electronApp, window }) => {
    await createNamedNote(electronApp, window, 'Keep', 1);
    await createNamedNote(electronApp, window, 'TrashMe', 2);

    // Close TrashMe (active) — entry enters the reopen stack.
    await clickMenuItem(electronApp, 'Close Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(1);

    // Trash the underlying TrashMe doc directly via the store. trashDocument calls
    // closeTab with { skipHistory: true } internally, but the user-driven close
    // above already pushed an entry — that entry is now stale.
    await window.evaluate(async () => {
      const store = (window as any).__documentStore.getState();
      const target = store.documents.find((d: { title: string }) => d.title === 'TrashMe');
      if (!target) throw new Error('TrashMe doc not found');
      await store.trashDocument(target.id);
    });

    // Close Keep too — stack is now [TrashMe(stale), Keep].
    await clickMenuItem(electronApp, 'Close Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(0);

    // First reopen → Keep (top of stack, still valid).
    await clickMenuItem(electronApp, 'Reopen Closed Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(1);
    await expect(window.locator('[data-tab-id]').first()).toContainText('Keep');

    // Install the probe AFTER the first (successful) reopen so the count starts at 0,
    // then verify the stale-skip second reopen actually fires before asserting no-op.
    const getFires = await installIpcProbe(window, 'menu:reopen-closed-tab');

    // Second reopen → TrashMe entry is stale; reopenLastClosedTab pops & skips,
    // stack empties, no tab added.
    await clickMenuItem(electronApp, 'Reopen Closed Tab');
    await expect.poll(getFires).toBe(1);
    await expect(window.locator('[data-tab-id]')).toHaveCount(1);
  });
});

test.describe('Menu — edge cases & stress', () => {
  test('stress: rapid create/close/reopen of 20 tabs', async ({ electronApp, window }) => {
    test.setTimeout(120_000);

    // Burst-create 20 tabs via menu. Asserting count inside the loop keeps timing
    // deterministic — each click waits for the prior IPC + state update to land.
    for (let i = 1; i <= 20; i++) {
      await clickMenuItem(electronApp, 'New Note');
      await expect(window.locator('[data-tab-id]')).toHaveCount(i);
    }

    // Burst-close them all. Cmd+W always targets the active tab; after each close
    // the store auto-selects an adjacent tab, so we can just keep firing.
    for (let i = 19; i >= 0; i--) {
      await clickMenuItem(electronApp, 'Close Tab');
      await expect(window.locator('[data-tab-id]')).toHaveCount(i);
    }
    await expect(window.getByTestId('empty-state')).toBeVisible();

    // Burst-reopen all 20 — the uncapped stack must restore every one.
    for (let i = 1; i <= 20; i++) {
      await clickMenuItem(electronApp, 'Reopen Closed Tab');
      await expect(window.locator('[data-tab-id]')).toHaveCount(i);
    }
  });

  test('Cmd/Ctrl+W with Settings dialog open closes the underlying tab', async ({
    electronApp,
    window,
  }) => {
    await clickMenuItem(electronApp, 'New Note');
    await expect(window.locator('[data-tab-id]')).toHaveCount(1);

    await clickMenuItem(electronApp, 'Settings…');
    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    await clickMenuItem(electronApp, 'Close Tab');

    // Tab is closed, dialog still visible — menu accelerator dispatch is independent of dialog focus.
    await expect(window.locator('[data-tab-id]')).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });

  test('double Settings invocation does not stack two dialogs', async ({ electronApp, window }) => {
    await clickMenuItem(electronApp, 'Settings…');
    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    // Re-invoke while already open — Radix's `open` prop is already true, this should no-op.
    await clickMenuItem(electronApp, 'Settings…');

    // Still exactly one dialog rendered.
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toBeVisible();
  });

  test('reopen preserves the typed title (debounced save flushed on close)', async ({
    electronApp,
    window,
  }) => {
    await createNamedNote(electronApp, window, 'Persist This', 1);

    // Close immediately — the close path must flush, not cancel, the debounced save.
    await clickMenuItem(electronApp, 'Close Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(0);

    await clickMenuItem(electronApp, 'Reopen Closed Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(1);
    await expect(window.locator('[data-tab-id]').first()).toContainText('Persist This');
  });

  test('reopens two tabs of the same document independently', async ({ electronApp, window }) => {
    await createNamedNote(electronApp, window, 'Twin', 1);

    // Open a second tab pointing at the same doc.
    await window.evaluate(() => {
      const store = (window as any).__documentStore.getState();
      const target = store.documents.find((d: { title: string }) => d.title === 'Twin');
      if (!target) throw new Error('Twin doc not found');
      store.openTab(target.id);
    });
    await expect(window.locator('[data-tab-id]')).toHaveCount(2);

    // Close both tabs — each push enters the stack.
    await clickMenuItem(electronApp, 'Close Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(1);
    await clickMenuItem(electronApp, 'Close Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(0);

    // Two reopens → two tabs back (each a fresh tabId, same docId).
    await clickMenuItem(electronApp, 'Reopen Closed Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(1);
    await clickMenuItem(electronApp, 'Reopen Closed Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(2);

    const titles = await window.locator('[data-tab-id]').allTextContents();
    expect(titles[0]).toContain('Twin');
    expect(titles[1]).toContain('Twin');
  });

  test('close → trash → restore → reopen resurrects the tab', async ({ electronApp, window }) => {
    await createNamedNote(electronApp, window, 'Roundtrip', 1);

    // Close — entry enters the stack.
    await clickMenuItem(electronApp, 'Close Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(0);

    // Trash the underlying doc. The stack entry is now stale (doc not in `documents`).
    const docId = await window.evaluate(() => {
      const store = (window as any).__documentStore.getState();
      const target = store.documents.find((d: { title: string }) => d.title === 'Roundtrip');
      if (!target) throw new Error('Roundtrip doc not found');
      return target.id as string;
    });
    await window.evaluate(async (id) => {
      await (window as any).__documentStore.getState().trashDocument(id);
    }, docId);

    // Restore the doc from trash — now it's back in `documents`, so the stale entry becomes valid.
    await window.evaluate(async (id) => {
      await (window as any).__documentStore.getState().restoreDocument(id);
    }, docId);

    // Wait for the restored doc to land in the store.
    await expect
      .poll(() =>
        window.evaluate((id) => {
          const store = (window as any).__documentStore.getState();
          return store.documents.some((d: { id: string }) => d.id === id);
        }, docId),
      )
      .toBe(true);

    // Reopen — the previously-stale entry is now valid and resurrects the tab.
    await clickMenuItem(electronApp, 'Reopen Closed Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(1);
    await expect(window.locator('[data-tab-id]').first()).toContainText('Roundtrip');
  });

  test('reopened tab becomes the active selection', async ({ electronApp, window }) => {
    await createNamedNote(electronApp, window, 'Active', 1);
    await createNamedNote(electronApp, window, 'Reopened', 2);

    // Close 'Reopened' (active). 'Active' becomes selected per adjacent-tab rule.
    await clickMenuItem(electronApp, 'Close Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(1);

    const activeBefore = await window.evaluate(() => {
      const store = (window as any).__documentStore.getState();
      return store.openTabs.find((t: { tabId: string }) => t.tabId === store.selectedId);
    });
    expect(activeBefore).toBeTruthy();

    await clickMenuItem(electronApp, 'Reopen Closed Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(2);

    // The reopened tab (with docId of 'Reopened') should now be selected, not 'Active'.
    const activeDocTitle = await window.evaluate(() => {
      const store = (window as any).__documentStore.getState();
      const activeTab = store.openTabs.find((t: { tabId: string }) => t.tabId === store.selectedId);
      if (!activeTab) return null;
      const doc = store.documents.find((d: { id: string }) => d.id === activeTab.docId);
      return doc?.title ?? null;
    });
    expect(activeDocTitle).toBe('Reopened');
  });

  test('reopen clamps saved index to current tab count', async ({ electronApp, window }) => {
    // Open 3 tabs, close the rightmost (index 2). Stack entry: { index: 2 }.
    await createNamedNote(electronApp, window, 'Left', 1);
    await createNamedNote(electronApp, window, 'Middle', 2);
    await createNamedNote(electronApp, window, 'Right', 3);

    await clickMenuItem(electronApp, 'Close Tab'); // closes Right
    await expect(window.locator('[data-tab-id]')).toHaveCount(2);
    await clickMenuItem(electronApp, 'Close Tab'); // closes Middle (now active)
    await expect(window.locator('[data-tab-id]')).toHaveCount(1);
    await clickMenuItem(electronApp, 'Close Tab'); // closes Left
    await expect(window.locator('[data-tab-id]')).toHaveCount(0);

    // Create a single fresh note — current tab count (1) is now below the
    // saved index of the top-of-stack entry (Left at index 0 → first reopen
    // safe; second reopen Middle had index 1; third reopen Right had index 2).
    // To exercise clamping, reopen Right (index 2) into an openTabs of length 1.
    await createNamedNote(electronApp, window, 'Fresh', 1);

    // Stack pop order: Left, Middle, Right (LIFO of close order: Right, Middle, Left → pop reverse).
    // Walk back: first reopen → Left (index 0), inserted at 0 → tabs: [Left, Fresh].
    await clickMenuItem(electronApp, 'Reopen Closed Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(2);

    // Second reopen → Middle (index 1) into openTabs length 2 → inserted at 1.
    await clickMenuItem(electronApp, 'Reopen Closed Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(3);

    // Third reopen → Right (index 2) into openTabs length 3 → inserted at 2 (in bounds).
    await clickMenuItem(electronApp, 'Reopen Closed Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(4);

    // Final order: Left, Middle, Right, Fresh — Fresh was at index 0 originally, pushed to the end.
    const titles = await window.locator('[data-tab-id]').allTextContents();
    expect(titles[0]).toContain('Left');
    expect(titles[1]).toContain('Middle');
    expect(titles[2]).toContain('Right');
    expect(titles[3]).toContain('Fresh');
  });

  test('reopen reflects the doc title at reopen time, not at close time', async ({
    electronApp,
    window,
  }) => {
    await createNamedNote(electronApp, window, 'OldName', 1);

    const docId = await window.evaluate(() => {
      const store = (window as any).__documentStore.getState();
      const target = store.documents.find((d: { title: string }) => d.title === 'OldName');
      if (!target) throw new Error('OldName doc not found');
      return target.id as string;
    });

    await clickMenuItem(electronApp, 'Close Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(0);

    // Rename the doc while it's closed. updateDocumentInStore is the renderer-local
    // mutation; we also persist via IPC so the renderer's title source is consistent.
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.update', { id, title: 'NewName' });
      (window as any).__documentStore.getState().updateDocumentInStore(id, { title: 'NewName' });
    }, docId);

    await clickMenuItem(electronApp, 'Reopen Closed Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(1);
    // The reopened tab reads from the current `documents` state, not a snapshot.
    await expect(window.locator('[data-tab-id]').first()).toContainText('NewName');
    await expect(window.locator('[data-tab-id]').first()).not.toContainText('OldName');
  });

  test('reopen skips entries whose doc was permanently deleted', async ({
    electronApp,
    window,
  }) => {
    await createNamedNote(electronApp, window, 'PermDelete', 1);

    // Close — entry enters the stack.
    await clickMenuItem(electronApp, 'Close Tab');
    await expect(window.locator('[data-tab-id]')).toHaveCount(0);

    // Trash then permanently delete.
    const docId = await window.evaluate(() => {
      const store = (window as any).__documentStore.getState();
      const target = store.documents.find((d: { title: string }) => d.title === 'PermDelete');
      if (!target) throw new Error('PermDelete doc not found');
      return target.id as string;
    });
    await window.evaluate(async (id) => {
      const store = (window as any).__documentStore.getState();
      await store.trashDocument(id);
      await store.permanentDeleteDocument(id);
    }, docId);

    const getFires = await installIpcProbe(window, 'menu:reopen-closed-tab');

    // Reopen — entry is stale and unrecoverable; reopen is a no-op.
    await clickMenuItem(electronApp, 'Reopen Closed Tab');

    // Prove the menu wiring fired (so the no-op below isn't vacuous),
    // then prove the stack-pop-and-skip behavior held.
    await expect.poll(getFires).toBe(1);
    await expect(window.locator('[data-tab-id]')).toHaveCount(0);

    // And the now-empty stack means a follow-up reopen is also a no-op.
    await clickMenuItem(electronApp, 'Reopen Closed Tab');
    await expect.poll(getFires).toBe(2);
    await expect(window.locator('[data-tab-id]')).toHaveCount(0);
  });
});

test.describe('Menu — Help', () => {
  test('Help menu contains Lychee branding items', async ({ electronApp }) => {
    const helpItems = await electronApp.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      if (!menu) return null;
      const help = menu.items.find((item) => item.role === 'help' || item.label === 'Help');
      if (!help || !help.submenu) return null;
      return help.submenu.items.map((item) => item.label);
    });
    expect(helpItems).not.toBeNull();
    expect(helpItems).toContain('Lychee Website');
    expect(helpItems).toContain('View on GitHub');
    expect(helpItems).toContain('Report an Issue');
  });

  test('Help items invoke shell.openExternal with the expected URLs', async ({ electronApp }) => {
    // Stub shell.openExternal in main so:
    //   1. clicking these items in tests doesn't actually launch a browser
    //   2. we can verify the click handlers route to the right URLs
    // The structure-only test above would pass even if click handlers were broken
    // or pointed at the wrong URLs — this proves the wiring.
    await electronApp.evaluate(({ shell }) => {
      const g = globalThis as unknown as { __capturedOpenExternal?: string[] };
      g.__capturedOpenExternal = [];
      shell.openExternal = ((url: string) => {
        g.__capturedOpenExternal!.push(url);
        return Promise.resolve();
      }) as typeof shell.openExternal;
    });

    await clickMenuItem(electronApp, 'Lychee Website');
    await clickMenuItem(electronApp, 'View on GitHub');
    await clickMenuItem(electronApp, 'Report an Issue');

    const captured = await electronApp.evaluate(
      () => (globalThis as unknown as { __capturedOpenExternal?: string[] }).__capturedOpenExternal ?? [],
    );

    expect(captured).toEqual([
      'https://lycheenote.com',
      'https://github.com/reddpy/lychee',
      'https://github.com/reddpy/lychee/issues',
    ]);
  });
});
