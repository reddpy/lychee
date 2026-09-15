import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import type { IpcInvoke, IpcOn } from "./shared/ipc-types";

// ── IPC mock layer (E2E only) ───────────────────────────────────────
// Gated behind the same E2E=1 env flag used by `pnpm run test:e2e:build`.
// In production builds the env var is unset, the mocks Map is empty, and
// `invoke` falls through directly to ipcRenderer.invoke. The control
// surface (__mocks) is only exposed when E2E is on.

const isE2E = process.env.E2E === "1";

type MockSpec =
  | { resolve: unknown; delayMs?: number }
  | { reject: string; delayMs?: number };

const mocks = new Map<string, MockSpec>();

// E2E-only call log. Records every invoke (mocked or real) so tests can assert
// which channels fired with which payloads without stubbing the main process.
const invokeCalls: Array<{ channel: string; payload: unknown }> = [];

const invoke: IpcInvoke = (channel, payload) => {
  if (isE2E) {
    invokeCalls.push({ channel: channel as string, payload });
    const mock = mocks.get(channel as string);
    if (mock) {
      const settle = (): Promise<never> =>
        "reject" in mock
          ? Promise.reject(new Error(mock.reject))
          : Promise.resolve(mock.resolve as never);
      if (mock.delayMs && mock.delayMs > 0) {
        return new Promise<never>((resolve, reject) => {
          setTimeout(() => {
            settle().then(resolve, reject);
          }, mock.delayMs);
        });
      }
      return settle();
    }
  }
  return ipcRenderer.invoke(channel, payload);
};

const on: IpcOn = (channel, callback) => {
  const handler = (_event: IpcRendererEvent, payload: unknown) => {
    callback(payload as never);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

const exposed: Record<string, unknown> = {
  invoke,
  on,
  platform: process.platform,
  // Build/runtime feature flags the renderer needs synchronously.
  flags: {
    // Yjs-backed editor binding (off by default; enabled in the Yjs e2e run).
    yjs: process.env.LYCHEE_YJS === "1",
  },
  getImageDataUrl: (id: string): string | null => {
    try {
      const result = ipcRenderer.sendSync("images.getDataUrlSync", { id }) as
        | { ok: true; dataUrl: string }
        | { ok: false; error: string }
        | undefined;
      return result?.ok ? result.dataUrl : null;
    } catch {
      return null;
    }
  },
};

if (isE2E) {
  exposed.__mocks = {
    set: (channel: string, spec: MockSpec) => {
      mocks.set(channel, spec);
    },
    clear: (channel: string) => {
      mocks.delete(channel);
    },
    clearAll: () => {
      mocks.clear();
    },
    calls: () => invokeCalls.slice(),
    clearCalls: () => {
      invokeCalls.length = 0;
    },
  };
}

contextBridge.exposeInMainWorld("lychee", exposed);

declare global {
  interface Window {
    lychee: {
      invoke: IpcInvoke;
      on: IpcOn;
      platform: NodeJS.Platform;
      flags: { yjs: boolean };
      getImageDataUrl: (id: string) => string | null;
      __mocks?: {
        set: (
          channel: string,
          spec:
            | { resolve: unknown; delayMs?: number }
            | { reject: string; delayMs?: number },
        ) => void;
        clear: (channel: string) => void;
        clearAll: () => void;
        calls: () => Array<{ channel: string; payload: unknown }>;
        clearCalls: () => void;
      };
    };
  }
}
