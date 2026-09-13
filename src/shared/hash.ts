/**
 * Deterministic content revision used for optimistic concurrency and watcher
 * baselines. cyrb53 — fast, 53-bit, no crypto dependency, and identical in the
 * main process and the renderer (so a file revision computed by the watcher can
 * be compared to a baseline computed elsewhere).
 *
 * This is change-detection, not security: collisions are astronomically unlikely
 * for real note text and would only cause a stale write to be treated as
 * unchanged.
 */
export function revisionOf(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
