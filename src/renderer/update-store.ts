import { create } from 'zustand';
import type { UpdateStatus } from '../shared/ipc-types';

type UpdateStore = {
  status: UpdateStatus;
  // True when there's something actionable for the user: a downloaded build to
  // restart into (mac/win) or a newer release to download (linux). Drives the
  // Settings red-dot.
  hasUpdate: boolean;
  check: () => void;
  install: () => void;
};

const INITIAL: UpdateStatus = {
  state: 'unsupported',
  currentVersion: '',
  releaseUrl: 'https://github.com/reddpy/lychee/releases',
};

function deriveHasUpdate(status: UpdateStatus): boolean {
  return status.state === 'ready' || status.state === 'available';
}

export const useUpdateStore = create<UpdateStore>((set) => {
  const apply = (status: UpdateStatus) =>
    set({ status, hasUpdate: deriveHasUpdate(status) });

  // Pull the current status once, then keep it live via main-process pushes.
  void window.lychee
    .invoke('update.getStatus', {})
    .then(apply)
    .catch(() => {});
  window.lychee.on('update:status', apply);

  return {
    status: INITIAL,
    hasUpdate: false,
    check: () => void window.lychee.invoke('update.check', {}).catch(() => {}),
    install: () => void window.lychee.invoke('update.install', {}).catch(() => {}),
  };
});
