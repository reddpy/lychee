import { describe, it, expect } from 'vitest';
import { parseFrontmatter, serializeFrontmatter } from '../frontmatter';

describe('frontmatter', () => {
  it('round-trips all fields', () => {
    const data = {
      id: '6f1c-abc',
      title: 'Parent Note',
      emoji: '📄',
      bookmarked: '2026-09-12T12:00:00.000Z',
      created: '2026-09-12T10:00:00.000Z',
      updated: '2026-09-12T11:00:00.000Z',
      contentSchemaVersion: 1,
      order: 3,
    };
    const serialized = serializeFrontmatter(data);
    const parsed = parseFrontmatter(serialized + '\nbody text');
    expect(parsed.data).toEqual(data);
    expect(parsed.body).toBe('body text');
  });

  it('omits empty emoji and bookmark', () => {
    const serialized = serializeFrontmatter({ id: 'a', title: 'T' });
    expect(serialized).not.toContain('emoji:');
    expect(serialized).not.toContain('bookmarked:');
  });

  it('quotes arbitrary titles safely', () => {
    const title = 'He said "hi"\\ and\nnewline: yes';
    const serialized = serializeFrontmatter({ id: 'a', title });
    const parsed = parseFrontmatter(serialized + '\nbody');
    expect(parsed.data.title).toBe(title);
  });

  it('treats a document with no frontmatter as body-only', () => {
    const parsed = parseFrontmatter('# Just a heading\n\nbody');
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe('# Just a heading\n\nbody');
  });

  it('treats unterminated frontmatter as body-only', () => {
    const parsed = parseFrontmatter('---\nid: "a"\nbody');
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe('---\nid: "a"\nbody');
  });

  it('ignores unknown keys', () => {
    const parsed = parseFrontmatter('---\nid: "a"\ntitle: "T"\nunknown: 5\n---\nbody');
    expect(parsed.data).toMatchObject({ id: 'a', title: 'T' });
    expect((parsed.data as Record<string, unknown>).unknown).toBeUndefined();
  });
});
