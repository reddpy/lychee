/**
 * IPC mock helpers for e2e tests.
 *
 * The preload script exposes a `window.lychee.__mocks` control surface when
 * the Electron process is launched with `E2E=1` (the `test:e2e:build` script
 * sets this). Registered mocks short-circuit `window.lychee.invoke` and
 * either resolve with a canned response or reject with an Error.
 *
 * Always call `clearIpcMocks(window)` in a teardown / afterEach to avoid
 * mocks leaking across tests.
 */

import type { Page } from '@playwright/test';

export type MockSpec =
  | { resolve: unknown; delayMs?: number }
  | { reject: string; delayMs?: number };

/** Make `channel` resolve with `value`. Optional `delayMs` defers settlement —
 *  useful for staging "in flight" scenarios where you want to inspect editor
 *  state mid-hydration. */
export async function mockIpcResolve(
  window: Page,
  channel: string,
  value: unknown,
  delayMs?: number,
): Promise<void> {
  await window.evaluate(
    ({ ch, v, d }: { ch: string; v: unknown; d?: number }) => {
      const mocks = (window as unknown as { lychee?: { __mocks?: { set: (c: string, s: unknown) => void } } }).lychee?.__mocks;
      if (!mocks) throw new Error('IPC mocks unavailable — was Electron launched with E2E=1?');
      mocks.set(ch, d !== undefined ? { resolve: v, delayMs: d } : { resolve: v });
    },
    { ch: channel, v: value, d: delayMs },
  );
}

/** Make `channel` reject with an Error whose message is `errorMessage`. */
export async function mockIpcReject(
  window: Page,
  channel: string,
  errorMessage: string,
  delayMs?: number,
): Promise<void> {
  await window.evaluate(
    ({ ch, m, d }: { ch: string; m: string; d?: number }) => {
      const mocks = (window as unknown as { lychee?: { __mocks?: { set: (c: string, s: unknown) => void } } }).lychee?.__mocks;
      if (!mocks) throw new Error('IPC mocks unavailable — was Electron launched with E2E=1?');
      mocks.set(ch, d !== undefined ? { reject: m, delayMs: d } : { reject: m });
    },
    { ch: channel, m: errorMessage, d: delayMs },
  );
}

/** Remove a single channel's mock. */
export async function clearIpcMock(window: Page, channel: string): Promise<void> {
  await window.evaluate(
    (ch: string) => {
      const mocks = (window as unknown as { lychee?: { __mocks?: { clear: (c: string) => void } } }).lychee?.__mocks;
      mocks?.clear(ch);
    },
    channel,
  );
}

/** Remove all registered mocks. Call in afterEach to keep tests isolated. */
export async function clearIpcMocks(window: Page): Promise<void> {
  await window.evaluate(() => {
    const mocks = (window as unknown as { lychee?: { __mocks?: { clearAll: () => void } } }).lychee?.__mocks;
    mocks?.clearAll();
  });
}
