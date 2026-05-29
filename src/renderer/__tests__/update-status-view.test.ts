/**
 * Tests for the About-pane presentation logic (src/renderer/update-status-view.ts).
 * Covers every updater state on both the mac/win and Linux branches, including
 * the missing-version fallbacks.
 */

import { describe, it, expect } from 'vitest';
import type { UpdateStatus } from '../../shared/ipc-types';
import { describeUpdate } from '../update-status-view';

function status(partial: Partial<UpdateStatus>): UpdateStatus {
  return {
    state: 'unsupported',
    currentVersion: '0.1.0',
    releaseUrl: 'https://example.test/releases',
    ...partial,
  };
}

describe('describeUpdate — mac/win (isLinux=false)', () => {
  it('ready → install, with version', () => {
    const v = describeUpdate(status({ state: 'ready', newVersion: '0.2.0' }), false);
    expect(v).toMatchObject({ action: 'install', actionLabel: 'Restart & Update' });
    expect(v.message).toContain('0.2.0');
  });

  it('ready without a version falls back to generic text', () => {
    const v = describeUpdate(status({ state: 'ready', newVersion: undefined }), false);
    expect(v.action).toBe('install');
    expect(v.message).toBe('An update is ready to install.');
    expect(v.message).not.toContain('undefined');
  });

  it('downloading → no action, no spinner', () => {
    const v = describeUpdate(status({ state: 'downloading' }), false);
    expect(v.action).toBeNull();
    expect(v.busy).toBe(false);
  });

  it('checking → no action, spinner on', () => {
    const v = describeUpdate(status({ state: 'checking' }), false);
    expect(v.action).toBeNull();
    expect(v.busy).toBe(true);
  });

  it('up-to-date → no manual check button on mac/win', () => {
    const v = describeUpdate(status({ state: 'up-to-date' }), false);
    expect(v.action).toBeNull();
  });

  it('error → offers the releases page (no autoUpdater retry button)', () => {
    const v = describeUpdate(status({ state: 'error' }), false);
    expect(v).toMatchObject({ action: 'open-releases', actionLabel: 'Open releases page' });
  });

  it('unsupported → informational, no action', () => {
    const v = describeUpdate(status({ state: 'unsupported' }), false);
    expect(v.action).toBeNull();
    expect(v.message).toMatch(/installed builds/);
  });
});

describe('describeUpdate — Linux (isLinux=true)', () => {
  it('available → download, with version', () => {
    const v = describeUpdate(status({ state: 'available', newVersion: '0.2.0' }), true);
    expect(v).toMatchObject({ action: 'download', actionLabel: 'Download' });
    expect(v.message).toContain('0.2.0');
  });

  it('available without a version falls back to generic text', () => {
    const v = describeUpdate(status({ state: 'available', newVersion: undefined }), true);
    expect(v.action).toBe('download');
    expect(v.message).toBe('A new version is available.');
    expect(v.message).not.toContain('undefined');
  });

  it('up-to-date → exposes a manual "Check for Updates"', () => {
    const v = describeUpdate(status({ state: 'up-to-date' }), true);
    expect(v).toMatchObject({ action: 'check', actionLabel: 'Check for Updates' });
  });

  it('error → offers a retry (Linux has no auto-poll)', () => {
    const v = describeUpdate(status({ state: 'error' }), true);
    expect(v).toMatchObject({ action: 'check', actionLabel: 'Try Again' });
  });
});

describe('describeUpdate — never leaks "undefined" into any message', () => {
  const states: UpdateStatus['state'][] = [
    'unsupported',
    'checking',
    'up-to-date',
    'downloading',
    'ready',
    'available',
    'error',
  ];
  for (const state of states) {
    for (const isLinux of [false, true]) {
      it(`${state} / ${isLinux ? 'linux' : 'mac-win'} (no newVersion)`, () => {
        const v = describeUpdate(status({ state, newVersion: undefined }), isLinux);
        expect(v.message).not.toMatch(/undefined|null|NaN/);
        expect(v.message.length).toBeGreaterThan(0);
      });
    }
  }
});
