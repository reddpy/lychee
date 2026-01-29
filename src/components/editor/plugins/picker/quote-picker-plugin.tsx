import { $createQuoteNode } from "@lexical/rich-text"
import { $setBlocksType } from "@lexical/selection"
import { $getSelection, $isRangeSelection } from "lexical"
import { QuoteIcon } from "lucide-react"

import { ComponentPickerOption } from "@/components/editor/plugins/picker/component-picker-option"

function applyQuote(editor: import("lexical").LexicalEditor) {
  const selection = $getSelection()
  if ($isRangeSelection(selection)) {
    $setBlocksType(selection, () => $createQuoteNode())
  }
}

export function QuotePickerPlugin() {
  return new ComponentPickerOption("Quote", {
    icon: <QuoteIcon className="size-4" />,
    keywords: ["block quote"],
    applyInUpdate: applyQuote,
    onSelect: (_, editor) => editor.update(() => applyQuote(editor)),
  })
}
