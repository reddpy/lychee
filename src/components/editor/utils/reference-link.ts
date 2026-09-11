import { $createLinkNode } from "@lexical/link"
import { $createParagraphNode, $createTextNode } from "lexical"

import type { ReferenceNode } from "@/components/editor/nodes/reference-node"

/**
 * Replace a reference block with a plain inline link, preserving the canonical
 * URL. This is always possible because the URL is the reference's permanent
 * identity — the reverse of a conversion, not a lossy operation.
 */
export function $convertReferenceToLink(reference: ReferenceNode): void {
  const url = reference.getUrl()
  const text =
    reference.getDisplayMode() === "image"
      ? reference.getAltText() || url
      : reference.getTitle() || url

  const paragraph = $createParagraphNode()
  const link = $createLinkNode(url)
  link.append($createTextNode(text || url))
  paragraph.append(link)

  reference.replace(paragraph)
  link.selectEnd()
}
