import { $setBlocksType } from "@lexical/selection"
import { $createParagraphNode, $getSelection, $isRangeSelection } from "lexical"
import { TextIcon } from "lucide-react"

import { ComponentPickerOption } from "@/components/editor/plugins/picker/component-picker-option"

function applyParagraph(editor: import("lexical").LexicalEditor) {
  const selection = $getSelection()
  if ($isRangeSelection(selection)) {
    $setBlocksType(selection, () => $createParagraphNode())
  }
}

export function ParagraphPickerPlugin() {
  return new ComponentPickerOption("Paragraph", {
    icon: <TextIcon className="size-4" />,
    keywords: ["normal", "paragraph", "p", "text"],
    applyInUpdate: applyParagraph,
    onSelect: (_, editor) => editor.update(() => applyParagraph(editor)),
  })
}
