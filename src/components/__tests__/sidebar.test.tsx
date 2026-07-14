// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Sidebar, SidebarProvider } from '../ui/sidebar';
import { SIDEBAR_PREFERENCES_SETTING_KEY } from '../../renderer/sidebar-preferences';

let container: HTMLDivElement;
let root: Root;
const invoke = vi.fn().mockResolvedValue({ ok: true });

beforeEach(() => {
  invoke.mockClear();
  window.lychee = { invoke } as unknown as Window['lychee'];
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderSidebar(defaultOpen = true, defaultWidth = 288) {
  act(() => {
    root.render(
      <SidebarProvider defaultOpen={defaultOpen} defaultWidth={defaultWidth}>
        <Sidebar>content</Sidebar>
      </SidebarProvider>,
    );
  });
}

describe('SidebarProvider', () => {
  it('applies restored open and width preferences on the first render', () => {
    renderSidebar(false, 352);

    expect(container.querySelector('aside')?.dataset.state).toBe('collapsed');
    expect(
      container
        .querySelector<HTMLElement>('[data-sidebar-provider="true"]')
        ?.style.getPropertyValue('--sidebar-width'),
    ).toBe('352px');
  });

  it('places the resize indicator on the sidebar outer edge', () => {
    renderSidebar();

    const rail = container.querySelector<HTMLButtonElement>('[aria-label="Resize sidebar"]')!;
    expect(rail.className).toContain('-right-1');
    expect(rail.querySelector('span')?.className).toContain('left-1/2');
    expect(rail.querySelector('span')?.className).toContain('w-1');
    expect(rail.querySelector('span')?.className).toContain('h-full');
  });

  it('extends the visual rail to full content height in floating mode', () => {
    renderSidebar(false);
    const aside = container.querySelector<HTMLElement>('aside')!;

    act(() => {
      aside.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    const indicator = container.querySelector<HTMLElement>(
      '[aria-label="Resize sidebar"] span',
    )!;
    expect(indicator.style.top).toBe('calc(-4rem - 1px)');
    expect(indicator.style.bottom).toBe('calc(-6rem - 1px)');
    expect(indicator.className).toContain('pointer-events-none');
    expect(indicator.className).not.toContain('h-full');
  });

  it('resizes with the keyboard and writes versioned metadata through settings IPC', () => {
    renderSidebar(true, 288);
    const rail = container.querySelector<HTMLButtonElement>('[aria-label="Resize sidebar"]')!;

    act(() => {
      rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });

    expect(
      container
        .querySelector<HTMLElement>('[data-sidebar-provider="true"]')
        ?.style.getPropertyValue('--sidebar-width'),
    ).toBe('296px');
    expect(invoke).toHaveBeenLastCalledWith('settings.set', {
      key: SIDEBAR_PREFERENCES_SETTING_KEY,
      value: JSON.stringify({ version: 1, open: true, width: 296 }),
    });
  });

  it('persists the hidden state when the rail is clicked', () => {
    renderSidebar(true, 288);
    const rail = container.querySelector<HTMLButtonElement>('[aria-label="Resize sidebar"]')!;

    act(() => rail.click());

    expect(container.querySelector('aside')?.dataset.state).toBe('collapsed');
    expect(invoke).toHaveBeenLastCalledWith('settings.set', {
      key: SIDEBAR_PREFERENCES_SETTING_KEY,
      value: JSON.stringify({ version: 1, open: false, width: 288 }),
    });
  });

  it.each([
    ['static', true],
    ['floating', false],
  ] as const)('supports pointer resizing in %s mode', (_mode, defaultOpen) => {
    renderSidebar(defaultOpen, 288);
    const aside = container.querySelector<HTMLElement>('aside')!;
    const rail = container.querySelector<HTMLButtonElement>('[aria-label="Resize sidebar"]')!;
    rail.setPointerCapture = vi.fn();
    rail.hasPointerCapture = vi.fn(() => false);

    if (!defaultOpen) {
      act(() => {
        aside.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      });
      expect(aside.className).toContain('translate-x-0');
    }

    act(() => {
      rail.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 288, pointerId: 1 }),
      );
      rail.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: 360, pointerId: 1 }),
      );
      rail.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, clientX: 360, pointerId: 1 }),
      );
      // Browsers synthesize click after pointerup. A completed resize must not
      // also toggle the sidebar.
      rail.click();
    });

    expect(
      container
        .querySelector<HTMLElement>('[data-sidebar-provider="true"]')
        ?.style.getPropertyValue('--sidebar-width'),
    ).toBe('360px');
    expect(aside.dataset.state).toBe(defaultOpen ? 'expanded' : 'collapsed');
    expect(invoke).toHaveBeenLastCalledWith('settings.set', {
      key: SIDEBAR_PREFERENCES_SETTING_KEY,
      value: JSON.stringify({ version: 1, open: defaultOpen, width: 360 }),
    });
  });
});
