import { $createLinkNode } from "@lexical/link"
import { $createParagraphNode, $createTextNode } from "lexical"

import type { ReferenceNode } from "@/components/editor/nodes/reference-node"

/**
 * Replace a reference block with a plain inline link, preserving the canonical
 * URL. This is always possible because the URL is the reference's permanent
 * identity — the reverse of a conversion, not a lossy operation.
 *
 * The link text is the raw URL, matching what an auto-linked URL looks like and
 * keeping the card/image title out of the round-trip.
 */
export function $convertReferenceToLink(reference: ReferenceNode): void {
  const url = reference.getUrl()
  if (!url) return

  const paragraph = $createParagraphNode()
  const link = $createLinkNode(url)
  link.append($createTextNode(url))
  paragraph.append(link)

  reference.replace(paragraph)
  link.selectEnd()
}
