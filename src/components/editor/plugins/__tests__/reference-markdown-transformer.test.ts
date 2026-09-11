import { describe, it, expect, vi } from 'vitest'

// Mock the React component imported by reference-node.tsx so it works headless.
vi.mock('../../nodes/reference-component', () => ({ ReferenceComponent: (): null => null }))

import { createEditor, $getRoot } from 'lexical'
import { $convertToMarkdownString } from '@lexical/markdown'
import { ReferenceNode, $createReferenceNode, type ReferenceNodeParams } from '../../nodes/reference-node'
import { REFERENCE_EXPORT } from '../reference-markdown-transformer'

function exportAsMarkdown(params: ReferenceNodeParams): string {
  const editor = createEditor({
    nodes: [ReferenceNode],
    onError: (err) => { throw err },
  })

  editor.update(() => {
    $getRoot().clear()
    $getRoot().append($createReferenceNode(params))
  }, { discrete: true })

  let markdown = ''
  editor.getEditorState().read(() => {
    markdown = $convertToMarkdownString([REFERENCE_EXPORT])
  })
  return markdown
}

describe('reference markdown export — the URL is always a pure link', () => {
  it('exports a card as a plain markdown link', () => {
    expect(
      exportAsMarkdown({ displayMode: 'card', url: 'https://example.com', title: 'Example' }),
    ).toBe('[Example](https://example.com)')
  })

  it('falls back to the URL as link text when a card has no title', () => {
    expect(exportAsMarkdown({ displayMode: 'card', url: 'https://example.com' })).toBe(
      '[https://example.com](https://example.com)',
    )
  })

  it('exports an image as a standard markdown image pointing at the canonical URL', () => {
    expect(
      exportAsMarkdown({ displayMode: 'image', url: 'https://example.com/pic.png', altText: 'Pic' }),
    ).toBe('![Pic](https://example.com/pic.png)')
  })

  it('falls back to the local src for an image with no canonical URL', () => {
    expect(
      exportAsMarkdown({ displayMode: 'image', src: 'local.png', altText: 'Local' }),
    ).toBe('![Local](local.png)')
  })
})
