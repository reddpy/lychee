/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { $generateHtmlFromNodes } from "@lexical/html"
import { $getRoot, $isElementNode, createEditor, ParagraphNode } from "lexical"
import { LinkNode, $isLinkNode } from "@lexical/link"

vi.mock("../reference-component", () => ({
  ReferenceComponent: (): null => null,
}))

import { $createReferenceNode, ReferenceNode } from "../reference-node"
import { $convertReferenceToLink } from "@/components/editor/utils/reference-link"

describe("ReferenceNode clipboard HTML export", () => {
  const getImageDataUrl = vi.fn()

  beforeEach(() => {
    getImageDataUrl.mockReset()
    Object.defineProperty(window, "lychee", {
      configurable: true,
      value: { getImageDataUrl },
    })
  })

  function exportReference(
    params: Parameters<typeof $createReferenceNode>[0],
  ): string {
    const editor = createEditor({
      namespace: "reference-export-test",
      nodes: [ReferenceNode],
      onError: (error) => {
        throw error
      },
    })

    editor.update(() => {
      $getRoot().append($createReferenceNode(params))
    }, { discrete: true })

    let html = ""
    editor.getEditorState().read(() => {
      html = $generateHtmlFromNodes(editor)
    })
    return html
  }

  it("embeds local image bytes instead of the app-private protocol URL", () => {
    getImageDataUrl.mockReturnValue(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    )

    const html = exportReference({
      displayMode: "image",
      imageId: "image-1",
      src: "image-1.png",
      altText: "Copied image",
      width: 320,
      height: 180,
    })

    expect(getImageDataUrl).toHaveBeenCalledWith("image-1")
    expect(html).toContain(
      'src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"',
    )
    expect(html).not.toContain("lychee-image:")
    expect(html).toContain('alt="Copied image"')
    expect(html).toContain('width="320"')
    expect(html).toContain('height="180"')
  })

  it("uses the canonical URL when a local clipboard read is unavailable", () => {
    getImageDataUrl.mockReturnValue(null)

    const html = exportReference({
      displayMode: "image",
      imageId: "missing-local-image",
      src: "missing.png",
      url: "https://example.com/image.png",
    })

    expect(html).toContain('src="https://example.com/image.png"')
  })

  it("exports card references as a plain anchor", () => {
    const html = exportReference({
      displayMode: "card",
      url: "https://example.com",
      title: "Example",
    })

    expect(html).toContain('href="https://example.com"')
    expect(html).toContain("Example")
  })
})

describe("ReferenceNode convert to link", () => {
  it("restores a plain inline link, preserving the canonical URL", () => {
    const editor = createEditor({
      namespace: "reference-to-link-test",
      nodes: [ReferenceNode, ParagraphNode, LinkNode],
      onError: (error) => {
        throw error
      },
    })

    editor.update(() => {
      $getRoot().clear()
      $getRoot().append(
        $createReferenceNode({
          displayMode: "card",
          url: "https://example.com",
          title: "Example",
        }),
      )
    }, { discrete: true })

    editor.update(() => {
      const reference = $getRoot().getFirstChild()
      if (reference) $convertReferenceToLink(reference as ReferenceNode)
    }, { discrete: true })

    editor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChild()
      expect(paragraph?.getType()).toBe("paragraph")
      if (!$isElementNode(paragraph)) throw new Error("expected a paragraph")
      const link = paragraph.getFirstChild()
      expect($isLinkNode(link)).toBe(true)
      if ($isLinkNode(link)) {
        expect(link.getURL()).toBe("https://example.com")
        // The raw URL is the link text (not the card title), so the round-trip
        // matches a plain auto-linked URL.
        expect(link.getTextContent()).toBe("https://example.com")
      }
    })
  })
})

