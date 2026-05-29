import type { UpdateStatus } from '../shared/ipc-types';

// Pure presentation logic for the About pane: maps an UpdateStatus (+ platform)
// to the status line, the action button, and whether to show a spinner. Kept
// out of the component so every state/platform branch is unit-testable without
// rendering React.

export type UpdateAction = 'install' | 'download' | 'check' | 'open-releases' | null;

export type UpdateView = {
  message: string;
  action: UpdateAction;
  actionLabel: string | null;
  busy: boolean;
};

export function describeUpdate(status: UpdateStatus, isLinux: boolean): UpdateView {
  switch (status.state) {
    case 'ready':
      return {
        message: status.newVersion
          ? `Version ${status.newVersion} is ready to install.`
          : 'An update is ready to install.',
        action: 'install',
        actionLabel: 'Restart & Update',
        busy: false,
      };
    case 'available':
      return {
        message: status.newVersion
          ? `Version ${status.newVersion} is available.`
          : 'A new version is available.',
        action: 'download',
        actionLabel: 'Download',
        busy: false,
      };
    case 'downloading':
      return { message: 'Downloading the latest version…', action: null, actionLabel: null, busy: false };
    case 'checking':
      return { message: 'Checking for updates…', action: null, actionLabel: null, busy: true };
    case 'up-to-date':
      return {
        message: 'You’re up to date.',
        // mac/win poll on their own; only Linux exposes a manual re-check.
        action: isLinux ? 'check' : null,
        actionLabel: isLinux ? 'Check for Updates' : null,
        busy: false,
      };
    case 'error':
      return {
        message: 'Couldn’t check for updates.',
        action: isLinux ? 'check' : 'open-releases',
        actionLabel: isLinux ? 'Try Again' : 'Open releases page',
        busy: false,
      };
    default:
      // 'unsupported' — dev / unpackaged builds.
      return {
        message: 'Updates are delivered automatically in installed builds.',
        action: null,
        actionLabel: null,
        busy: false,
      };
  }
}
