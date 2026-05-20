import { describe, expect, it } from 'vitest';
import { classifyUrl } from './classify-url';

describe('classifyUrl', () => {
  it('classifies common image extensions as image', () => {
    expect(classifyUrl('https://example.com/foo.png').kind).toBe('image');
    expect(classifyUrl('https://example.com/foo.jpg').kind).toBe('image');
    expect(classifyUrl('https://example.com/foo.jpeg').kind).toBe('image');
    expect(classifyUrl('https://example.com/foo.gif').kind).toBe('image');
    expect(classifyUrl('https://example.com/foo.webp').kind).toBe('image');
    expect(classifyUrl('https://example.com/foo.avif').kind).toBe('image');
    expect(classifyUrl('https://example.com/foo.svg').kind).toBe('image');
  });

  it('matches image extensions in path even with query or fragment', () => {
    expect(classifyUrl('https://cdn.example.com/img.png?v=2').kind).toBe('image');
    expect(classifyUrl('https://cdn.example.com/img.png#anchor').kind).toBe('image');
    expect(classifyUrl('https://cdn.example.com/path/to/IMG.JPG').kind).toBe('image');
  });

  it('does not classify by extension elsewhere in the URL', () => {
    // .png appears in query string only — not the path
    expect(classifyUrl('https://example.com/page?file=foo.png').kind).toBe('bookmark');
    // .png appears in hostname only
    expect(classifyUrl('https://png.example.com/page').kind).toBe('bookmark');
  });

  it('falls back to bookmark for non-image URLs', () => {
    expect(classifyUrl('https://example.com').kind).toBe('bookmark');
    expect(classifyUrl('https://example.com/article').kind).toBe('bookmark');
    expect(classifyUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ').kind).toBe('bookmark');
  });

  it('returns bookmark for invalid URLs without throwing', () => {
    expect(classifyUrl('not a url').kind).toBe('bookmark');
    expect(classifyUrl('').kind).toBe('bookmark');
  });
});
