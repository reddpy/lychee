import { describe, it, expect } from 'vitest';
import { parseStoredOrder } from '../sidebar-section-order';

const DEFAULT_ORDER = ['bookmarks', 'notes'] as const;

describe('parseStoredOrder', () => {
  it('returns default when storage is empty', () => {
    expect(parseStoredOrder(null)).toEqual(DEFAULT_ORDER);
    expect(parseStoredOrder('')).toEqual(DEFAULT_ORDER);
  });

  it('returns default when JSON is malformed', () => {
    expect(parseStoredOrder('not json')).toEqual(DEFAULT_ORDER);
    expect(parseStoredOrder('{')).toEqual(DEFAULT_ORDER);
  });

  it('returns default when JSON is not an array', () => {
    expect(parseStoredOrder('null')).toEqual(DEFAULT_ORDER);
    expect(parseStoredOrder('{}')).toEqual(DEFAULT_ORDER);
    expect(parseStoredOrder('"bookmarks"')).toEqual(DEFAULT_ORDER);
    expect(parseStoredOrder('42')).toEqual(DEFAULT_ORDER);
  });

  it('returns default when array is missing required ids', () => {
    expect(parseStoredOrder('[]')).toEqual(DEFAULT_ORDER);
    expect(parseStoredOrder('["bookmarks"]')).toEqual(DEFAULT_ORDER);
    expect(parseStoredOrder('["notes"]')).toEqual(DEFAULT_ORDER);
  });

  it('returns default when array has duplicates that collapse below required length', () => {
    // After dedupe, ["bookmarks", "bookmarks"] becomes ["bookmarks"] — wrong length
    expect(parseStoredOrder('["bookmarks", "bookmarks"]')).toEqual(DEFAULT_ORDER);
    expect(parseStoredOrder('["notes", "notes"]')).toEqual(DEFAULT_ORDER);
  });

  it('returns default when array contains only unknown ids', () => {
    expect(parseStoredOrder('["foo", "bar"]')).toEqual(DEFAULT_ORDER);
  });

  it('returns the stored order verbatim when valid', () => {
    expect(parseStoredOrder('["bookmarks", "notes"]')).toEqual(['bookmarks', 'notes']);
    expect(parseStoredOrder('["notes", "bookmarks"]')).toEqual(['notes', 'bookmarks']);
  });

  it('strips unknown ids and keeps the order if remaining ids satisfy the length check', () => {
    // ["notes", "extra", "bookmarks"] → filter unknowns → ["notes", "bookmarks"]
    expect(parseStoredOrder('["notes", "extra", "bookmarks"]')).toEqual(['notes', 'bookmarks']);
  });

  it('does not mutate the default order on repeated calls', () => {
    const first = parseStoredOrder(null);
    first.push('mutation' as never);
    const second = parseStoredOrder(null);
    expect(second).toEqual(DEFAULT_ORDER);
  });
});
