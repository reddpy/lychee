import {
  $isTextNode,
  $setSelection,
  type LexicalEditor,
  type RangeSelection,
} from "lexical"
import { $isLinkNode } from "@lexical/link"
import { $findMatchingParent } from "@lexical/utils"

export type RestoredSelectionInfo = {
  isCollapsed: boolean
  shouldInsertText: boolean
}

function shouldInsertTextAtSelection(selection: RangeSelection): boolean {
  if (!selection.isCollapsed()) return false

  const anchorNode = selection.anchor.getNode()
  const topLevel = anchorNode.getTopLevelElement()
  if (!topLevel || topLevel.getTextContent().length === 0) return true

  // Preserve the editor's established Cmd+K behavior at the end of populated
  // text: applying a URL there links the existing line/list item. At a true
  // insertion boundary (the start, whitespace, punctuation, or between
  // children), insert the entered URL/note title instead.
  if (selection.anchor.type !== "text" || !$isTextNode(anchorNode)) return true

  const { offset } = selection.anchor
  const text = anchorNode.getTextContent()
  if (offset === 0 || offset < text.length) return true

  const precedingCharacter = text[offset - 1]
  return !precedingCharacter || /[\s\p{P}\p{S}]/u.test(precedingCharacter)
}

type WordSegment = {
  segment: string
  index: number
  isWordLike?: boolean
}

type WordSegmenter = {
  segment: (input: string) => Iterable<WordSegment>
}

const Segmenter = (Intl as unknown as {
  Segmenter?: new (
    locales?: string | string[],
    options?: { granularity: "word" },
  ) => WordSegmenter
}).Segmenter

const wordSegmenter = Segmenter
  ? new Segmenter(undefined, { granularity: "word" })
  : null

function fallbackWordRange(text: string, offset: number): [number, number] | null {
  const isWordCharacter = (character: string) =>
    /[A-Za-z0-9_]/.test(character) || character.toLocaleLowerCase() !== character.toLocaleUpperCase()

  if (
    offset <= 0 ||
    offset >= text.length ||
    !isWordCharacter(text[offset - 1]) ||
    !isWordCharacter(text[offset])
  ) {
    return null
  }

  let start = offset
  let end = offset
  while (start > 0 && isWordCharacter(text[start - 1])) start -= 1
  while (end < text.length && isWordCharacter(text[end])) end += 1
  return [start, end]
}

function wordRangeAtInteriorOffset(text: string, offset: number): [number, number] | null {
  if (wordSegmenter) {
    for (const word of wordSegmenter.segment(text)) {
      const end = word.index + word.segment.length
      if (word.isWordLike && word.index < offset && offset < end) {
        return [word.index, end]
      }
    }
    return null
  }

  return fallbackWordRange(text, offset)
}

/**
 * Capture the user's intended link label before opening the popup. A collapsed
 * caret strictly inside a word expands to that word; a caret at a natural
 * boundary stays collapsed so choosing a target inserts its title or URL.
 */
export function captureLinkSelection(selection: RangeSelection): RangeSelection {
  const capturedSelection = selection.clone()
  if (!capturedSelection.isCollapsed() || capturedSelection.anchor.type !== "text") {
    return capturedSelection
  }

  const textNode = capturedSelection.anchor.getNode()
  if (!$isTextNode(textNode)) return capturedSelection

  // A collapsed caret inside an existing link must stay collapsed. Lexical
  // uses that shape to update or remove the whole LinkNode; expanding it to a
  // word would split a multi-word link and only mutate that word.
  if ($findMatchingParent(textNode, $isLinkNode)) return capturedSelection

  const wordRange = wordRangeAtInteriorOffset(
    textNode.getTextContent(),
    capturedSelection.anchor.offset,
  )
  if (!wordRange) return capturedSelection

  const [start, end] = wordRange
  capturedSelection.anchor.set(textNode.getKey(), start, "text")
  capturedSelection.focus.set(textNode.getKey(), end, "text")
  return capturedSelection
}

/**
 * Reinstall the editor range captured before a link popup took focus and run
 * the link mutation in the same discrete update. Keeping those operations
 * atomic prevents Lexical's DOM-selection reconciliation from clearing the
 * restored range while focus remains in the popup input.
 */
export function withRestoredLinkSelection(
  editor: LexicalEditor,
  savedSelection: RangeSelection | null,
  apply: (selection: RangeSelection, info: RestoredSelectionInfo) => void,
): RestoredSelectionInfo | null {
  if (!savedSelection) return null

  let restoredInfo: RestoredSelectionInfo | null = null
  editor.update(() => {
    const restoredSelection = savedSelection.clone()
    $setSelection(restoredSelection)
    const info = {
      isCollapsed: restoredSelection.isCollapsed(),
      shouldInsertText: shouldInsertTextAtSelection(restoredSelection),
    }
    restoredInfo = info
    apply(restoredSelection, info)
  }, { discrete: true })
  return restoredInfo
}
