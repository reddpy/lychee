/**
 * Tests for the renderer update store (src/renderer/update-store.ts).
 *
 * The store reads `window.lychee` at module-evaluation time, so we install a
 * stub global before each fresh import. Verifies the hasUpdate derivation that
 * drives the Settings red-dot, the initial fetch, and live status pushes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UpdateStatus } from '../../shared/ipc-types';

type PushHandler = (status: UpdateStatus) => void;

const invoke = vi.fn();
let pushHandler: PushHandler | null = null;

function installLycheeStub() {
  pushHandler = null;
  invoke.mockReset();
  (globalThis as unknown as { window: unknown }).window = {
    lychee: {
      platform: 'linux',
      invoke,
      on: (channel: string, cb: PushHandler) => {
        if (channel === 'update:status') pushHandler = cb;
        return () => {};
      },
    },
  };
}

function status(partial: Partial<UpdateStatus>): UpdateStatus {
  return {
    state: 'unsupported',
    currentVersion: '0.1.0',
    releaseUrl: 'https://example.test/releases',
    ...partial,
  };
}

async function loadStore() {
  vi.resetModules();
  return import('../update-store');
}

beforeEach(() => {
  installLycheeStub();
});

describe('useUpdateStore', () => {
  it('starts with no update and fetches the initial status', async () => {
    invoke.mockResolvedValue(status({ state: 'up-to-date' }));
    const { useUpdateStore } = await loadStore();

    // Subscribing the creator runs on first access.
    expect(useUpdateStore.getState().hasUpdate).toBe(false);
    expect(invoke).toHaveBeenCalledWith('update.getStatus', {});

    await vi.waitFor(() =>
      expect(useUpdateStore.getState().status.state).toBe('up-to-date'),
    );
    expect(useUpdateStore.getState().hasUpdate).toBe(false);
  });

  it('derives hasUpdate=true only for actionable states', async () => {
    invoke.mockResolvedValue(status({ state: 'unsupported' }));
    const { useUpdateStore } = await loadStore();
    await vi.waitFor(() => expect(pushHandler).not.toBeNull());

    const cases: Array<[UpdateStatus['state'], boolean]> = [
      ['unsupported', false],
      ['checking', false],
      ['downloading', false],
      ['up-to-date', false],
      ['error', false],
      ['available', true],
      ['ready', true],
    ];
    for (const [state, expected] of cases) {
      pushHandler!(status({ state, newVersion: '0.2.0' }));
      expect(useUpdateStore.getState().hasUpdate, `state=${state}`).toBe(expected);
    }
  });

  it('applies pushed status updates live', async () => {
    invoke.mockResolvedValue(status({ state: 'checking' }));
    const { useUpdateStore } = await loadStore();
    await vi.waitFor(() => expect(pushHandler).not.toBeNull());

    pushHandler!(status({ state: 'ready', newVersion: '1.2.3' }));
    expect(useUpdateStore.getState().status).toMatchObject({ state: 'ready', newVersion: '1.2.3' });
    expect(useUpdateStore.getState().hasUpdate).toBe(true);
  });

  it('check() and install() invoke their channels and swallow rejections', async () => {
    invoke.mockResolvedValue(status({ state: 'up-to-date' }));
    const { useUpdateStore } = await loadStore();

    invoke.mockRejectedValue(new Error('ipc boom'));
    expect(() => useUpdateStore.getState().check()).not.toThrow();
    expect(() => useUpdateStore.getState().install()).not.toThrow();
    expect(invoke).toHaveBeenCalledWith('update.check', {});
    expect(invoke).toHaveBeenCalledWith('update.install', {});
    // Let the rejected promises settle without an unhandled rejection.
    await Promise.resolve();
  });

  it('survives a failed initial getStatus', async () => {
    invoke.mockRejectedValue(new Error('no handler'));
    const { useUpdateStore } = await loadStore();
    // Stays at the safe default rather than throwing.
    expect(useUpdateStore.getState().status.state).toBe('unsupported');
    expect(useUpdateStore.getState().hasUpdate).toBe(false);
  });
});
