import { describe, it, expect } from 'vitest';
import { revisionOf } from '../hash';

describe('revisionOf', () => {
  it('is deterministic', () => {
    expect(revisionOf('hello world')).toBe(revisionOf('hello world'));
  });

  it('changes when any character changes', () => {
    expect(revisionOf('hello')).not.toBe(revisionOf('hello!'));
  });

  it('handles empty and unicode input', () => {
    expect(revisionOf('')).toBe(revisionOf(''));
    expect(revisionOf('日本語 🎉')).not.toBe(revisionOf('日本語 🎊'));
  });

  it('distinguishes large similar documents', () => {
    const a = 'x'.repeat(100000) + 'a';
    const b = 'x'.repeat(100000) + 'b';
    expect(revisionOf(a)).not.toBe(revisionOf(b));
  });
});
