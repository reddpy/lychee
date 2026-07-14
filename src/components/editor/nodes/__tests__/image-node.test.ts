/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { $generateHtmlFromNodes } from "@lexical/html"
import { $getRoot, createEditor } from "lexical"

vi.mock("../image-component", () => ({
  ImageComponent: (): null => null,
}))

import { $createImageNode, ImageNode } from "../image-node"

describe("ImageNode clipboard HTML export", () => {
  const getImageDataUrl = vi.fn()

  beforeEach(() => {
    getImageDataUrl.mockReset()
    Object.defineProperty(window, "lychee", {
      configurable: true,
      value: { getImageDataUrl },
    })
  })

  function exportImage(params: Parameters<typeof $createImageNode>[0]): string {
    const editor = createEditor({
      namespace: "image-export-test",
      nodes: [ImageNode],
      onError: (error) => { throw error },
    })

    editor.update(() => {
      $getRoot().append($createImageNode(params))
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

    const html = exportImage({
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

  it("uses the original remote URL when a local clipboard read is unavailable", () => {
    getImageDataUrl.mockReturnValue(null)

    const html = exportImage({
      imageId: "missing-local-image",
      src: "missing.png",
      sourceUrl: "https://example.com/image.png",
    })

    expect(html).toContain('src="https://example.com/image.png"')
  })
})
