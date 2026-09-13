/**
 * Helpers for inline `lychee-*` HTML-comment encodings.
 *
 * Base64 keeps the JSON payload free of `>` and `--` (which would terminate an
 * HTML comment) and of `}` (which would fool a non-greedy regex), so nested /
 * inline decorations round-trip safely. Uses UTF-8 so emoji and CJK survive.
 */
export function encodeInlinePayload(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function decodeInlinePayload<T = unknown>(encoded: string): T {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return JSON.parse(new TextDecoder().decode(bytes)) as T
}
