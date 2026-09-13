import type {
  ElementTransformer,
  MultilineElementTransformer,
  TextMatchTransformer,
} from "@lexical/markdown"
import { $insertNodeToNearestRoot } from "@lexical/utils"
import { $isParagraphNode, $isTextNode, type LexicalNode, type ParagraphNode } from "lexical"
import { $isLinkNode, LinkNode } from "@lexical/link"
import {
  $createReferenceNode,
  $isReferenceNode,
  ReferenceNode,
} from "@/components/editor/nodes/reference-node"
import { NEVER_MATCH } from "@/components/editor/plugins/markdown-export-only"

/**
 * The internal markdown token for a locally-stored binary asset. The vault
 * boundary (`main/assets.ts`) rewrites it to/from a content-addressed
 * `assets/<sha256>.<ext>` path, so the same mechanism will cover future video /
 * file assets — not just images.
 */
export const LYCHEE_ASSET_SCHEME = "lychee-asset://"

export const REFERENCE_FENCE_LANG = "lychee-reference"

/** The human/LLM-legible line: a link (card) or image (image mode). */
function referenceLine(node: ReferenceNode): string {
  if (node.getDisplayMode() === "image") {
    const alt = node.getAltText()
    // Prefer the local asset: the vault boundary rewrites this token to a
    // portable `assets/<hash>.<ext>` path, so images travel with the notes.
    const target = node.getImageId()
      ? `${LYCHEE_ASSET_SCHEME}${node.getImageId()}`
      : node.getUrl() || node.getSrc()
    return `![${alt}](${target})`
  }
  const title = node.getTitle() || node.getUrl()
  return `[${title}](${node.getUrl()})`
}

/**
 * Fields markdown cannot express. Deliberately excludes `url` / `title` /
 * `altText`: the visible line is the source of truth for those, so an agent (or
 * user) editing the link changes the reference. The fence carries the rest.
 */
function referenceExtras(node: ReferenceNode): Record<string, unknown> {
  const extras: Record<string, unknown> = { displayMode: node.getDisplayMode() }
  const put = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== "" && value !== false) {
      extras[key] = value
    }
  }

  if (node.getDisplayMode() === "card") {
    put("description", node.getDescription())
    put("imageUrl", node.getImageUrl())
    put("faviconUrl", node.getFaviconUrl())
    put("autoResolve", node.getAutoResolve())
    put("hydrationAttempted", node.getHydrationAttempted())
  } else {
    put("width", node.getWidth())
    put("height", node.getHeight())
    if (node.getAlignment() !== "left") extras.alignment = node.getAlignment()
  }

  return extras
}

/**
 * Export a reference as its visible line plus a `lychee-reference` fence holding
 * the non-markdown fields. Export-only; import is handled by `REFERENCE_FENCE`.
 */
export const REFERENCE_EXPORT: ElementTransformer = {
  dependencies: [ReferenceNode],
  export: (node) => {
    if (!$isReferenceNode(node)) return null
    const extras = referenceExtras(node)
    return `${referenceLine(node)}\n\n\`\`\`${REFERENCE_FENCE_LANG}\n${JSON.stringify(extras)}\n\`\`\``
  },
  regExp: NEVER_MATCH, // never matches (export-only)
  replace: () => {},
  type: "element",
}

type ReferenceSource = {
  url: string
  title: string
  altText: string
  src: string
  imageId: string
}

/** A blank line imports as a paragraph wrapping a single empty text node. */
function isEmptyParagraph(node: LexicalNode | null): node is ParagraphNode {
  if (!$isParagraphNode(node)) return false
  const children = node.getChildren()
  if (children.length === 0) return true
  return children.every((child) => $isTextNode(child) && child.getTextContent().trim() === "")
}

/**
 * Find and remove the visible line that precedes a reference fence. Returns null
 * for a standalone fence (agent-written), in which case the fence is the whole
 * source. Blank-line paragraphs between the line and fence are skipped.
 */
function takeReferenceSource(rootNode: import("lexical").ElementNode): ReferenceSource | null {
  let previous = rootNode.getLastChild()
  while (isEmptyParagraph(previous)) {
    const before = previous.getPreviousSibling()
    previous.remove()
    previous = before
  }

  if ($isReferenceNode(previous)) {
    const source: ReferenceSource = {
      url: previous.getUrl(),
      title: previous.getTitle(),
      altText: previous.getAltText(),
      src: previous.getSrc(),
      imageId: previous.getImageId(),
    }
    previous.remove()
    return source
  }

  if ($isParagraphNode(previous)) {
    const children = previous.getChildren()
    if (children.length === 1 && $isLinkNode(children[0])) {
      const link = children[0]
      const source: ReferenceSource = {
        url: link.getURL(),
        title: link.getTextContent(),
        altText: "",
        src: "",
        imageId: "",
      }
      previous.remove()
      return source
    }
  }

  return null
}

/**
 * Import a `lychee-reference` fence. Pairs it with the preceding link/image line
 * and rebuilds the full ReferenceNode. Returns `false` for unparseable fences so
 * the built-in CODE transformer can take over instead of losing the content.
 */
export const REFERENCE_FENCE: MultilineElementTransformer = {
  dependencies: [ReferenceNode, LinkNode],
  export: () => null,
  regExpStart: /^```lychee-reference\s*$/,
  regExpEnd: /^```\s*$/,
  replace: (rootNode, _children, _startMatch, _endMatch, linesInBetween) => {
    if (!linesInBetween) return false

    let extras: Record<string, unknown>
    try {
      extras = JSON.parse(linesInBetween.join("\n"))
    } catch {
      return false
    }
    if (!extras || typeof extras !== "object") return false

    const source = takeReferenceSource(rootNode)
    const displayMode = extras.displayMode === "image" ? "image" : "card"

    rootNode.append(
      $createReferenceNode({
        displayMode,
        url: (source?.url || (extras.url as string) || "") as string,
        src: source?.src ?? "",
        title: displayMode === "card" ? source?.title || (extras.title as string) || "" : "",
        altText: displayMode === "image" ? source?.altText || (extras.altText as string) || "" : "",
        description: (extras.description as string) ?? "",
        imageUrl: (extras.imageUrl as string) ?? "",
        faviconUrl: (extras.faviconUrl as string) ?? "",
        imageId: source?.imageId || (extras.imageId as string) || "",
        width: extras.width as number | undefined,
        height: extras.height as number | undefined,
        alignment: extras.alignment as "left" | "center" | "right" | undefined,
        autoResolve: extras.autoResolve === true,
        hydrationAttempted: extras.hydrationAttempted === true,
      }),
    )
  },
  type: "multiline-element",
}

/**
 * Handles live typing shortcut and markdown import for ![alt](url).
 * Triggers on ')' character — must be ordered before LINK in the
 * TRANSFORMERS array since ![...] and [...] overlap.
 */
export const REFERENCE_IMAGE: TextMatchTransformer = {
  dependencies: [ReferenceNode],
  export: () => null, // handled by REFERENCE_EXPORT
  importRegExp: /!(?:\[([^\[]*)\])(?:\(([^(]+)\))/,
  regExp: /!(?:\[([^\[]*)\])(?:\(([^(]+)\))$/,
  replace: (textNode, match) => {
    const [, altText, target] = match
    const isExternal = /^https?:\/\//.test(target)
    const isLocalAsset = target.startsWith(LYCHEE_ASSET_SCHEME)
    const referenceNode = $createReferenceNode({
      displayMode: "image",
      url: isExternal ? target : "",
      src: isExternal || isLocalAsset ? "" : target,
      imageId: isLocalAsset ? target.slice(LYCHEE_ASSET_SCHEME.length) : "",
      altText,
      loading: isExternal,
    })
    // Remove the matched text node, then clean up the empty parent paragraph
    const parent = textNode.getParentOrThrow()
    textNode.remove()
    if (parent.getChildrenSize() === 0) {
      parent.remove()
    }
    // Insert as a proper top-level block (same pattern as HorizontalRulePlugin)
    $insertNodeToNearestRoot(referenceNode)
  },
  trigger: ")",
  type: "text-match",
}
