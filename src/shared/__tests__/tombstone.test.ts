import { describe, it, expect } from 'vitest';
import {
  effectiveTombstones,
  isDeletedState,
  isPurged,
  parseTombstoneLog,
  serializeTombstone,
  tombstoneSupersedes,
  type TombstoneRecord,
} from '../tombstone';

function record(id: string, action: TombstoneRecord['action'], at: string, device = 'd1'): TombstoneRecord {
  return { id, action, at, device };
}

describe('parseTombstoneLog', () => {
  it('round-trips serialized records', () => {
    const records = [record('a', 'trash', '2026-01-01T00:00:00.000Z')];
    const text = records.map(serializeTombstone).join('');
    expect(parseTombstoneLog(text)).toEqual(records);
  });

  it('skips blank and malformed lines', () => {
    const text = [
      '',
      'not json',
      '{"id":"a"}',
      '{"id":"b","action":"nope","at":"x"}',
      JSON.stringify(record('c', 'purge', '2026-01-02T00:00:00.000Z')).trim(),
    ].join('\n');
    expect(parseTombstoneLog(text)).toEqual([record('c', 'purge', '2026-01-02T00:00:00.000Z')]);
  });
});

describe('effectiveTombstones', () => {
  it('keeps the latest action per id', () => {
    const states = effectiveTombstones([
      record('a', 'trash', '2026-01-01T00:00:00.000Z'),
      record('a', 'restore', '2026-01-02T00:00:00.000Z'),
    ]);
    expect(states.get('a')?.action).toBe('restore');
  });

  it('breaks equal timestamps deterministically by device', () => {
    const at = '2026-01-01T00:00:00.000Z';
    const states = effectiveTombstones([
      record('a', 'trash', at, 'dev-a'),
      record('a', 'restore', at, 'dev-b'),
    ]);
    // 'dev-b' > 'dev-a' wins regardless of input order.
    expect(states.get('a')?.action).toBe('restore');
    const reversed = effectiveTombstones([
      record('a', 'restore', at, 'dev-b'),
      record('a', 'trash', at, 'dev-a'),
    ]);
    expect(reversed.get('a')?.action).toBe('restore');
  });

  it('merges records from multiple devices by id', () => {
    const states = effectiveTombstones([
      record('a', 'trash', '2026-01-01T00:00:00.000Z', 'd1'),
      record('b', 'purge', '2026-01-01T00:00:00.000Z', 'd2'),
    ]);
    expect(states.get('a')?.action).toBe('trash');
    expect(states.get('b')?.action).toBe('purge');
  });
});

describe('tombstoneSupersedes', () => {
  const state = { action: 'trash' as const, at: '2026-02-01T00:00:00.000Z', device: 'd1' };

  it('overrides an older or missing edit', () => {
    expect(tombstoneSupersedes(state, undefined)).toBe(true);
    expect(tombstoneSupersedes(state, '2026-01-01T00:00:00.000Z')).toBe(true);
  });

  it('yields to a newer edit (edited after an unseen delete)', () => {
    expect(tombstoneSupersedes(state, '2026-03-01T00:00:00.000Z')).toBe(false);
  });
});

describe('isDeletedState / isPurged', () => {
  it('classifies actions', () => {
    expect(isDeletedState({ action: 'trash', at: 'x', device: 'd' })).toBe(true);
    expect(isDeletedState({ action: 'purge', at: 'x', device: 'd' })).toBe(true);
    expect(isDeletedState({ action: 'restore', at: 'x', device: 'd' })).toBe(false);
    expect(isDeletedState(undefined)).toBe(false);
    expect(isPurged({ action: 'purge', at: 'x', device: 'd' })).toBe(true);
    expect(isPurged({ action: 'trash', at: 'x', device: 'd' })).toBe(false);
  });
});
