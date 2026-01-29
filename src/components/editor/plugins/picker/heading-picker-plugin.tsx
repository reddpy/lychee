import { $createHeadingNode } from "@lexical/rich-text"
import { $setBlocksType } from "@lexical/selection"
import { $getSelection, $isRangeSelection } from "lexical"
import { Heading1Icon, Heading2Icon, Heading3Icon } from "lucide-react"

import { ComponentPickerOption } from "@/components/editor/plugins/picker/component-picker-option"

function applyHeading(n: 1 | 2 | 3) {
  return (editor: import("lexical").LexicalEditor) => {
    const selection = $getSelection()
    if ($isRangeSelection(selection)) {
      $setBlocksType(selection, () => $createHeadingNode(`h${n}`))
    }
  }
}

export function HeadingPickerPlugin({ n }: { n: 1 | 2 | 3 }) {
  return new ComponentPickerOption(`Heading ${n}`, {
    icon: <HeadingIcons n={n} />,
    keywords: ["heading", "header", `h${n}`],
    applyInUpdate: applyHeading(n),
    onSelect: (_, editor) => editor.update(() => applyHeading(n)(editor)),
  })
}

function HeadingIcons({ n }: { n: number }) {
  switch (n) {
    case 1:
      return <Heading1Icon className="size-4" />
    case 2:
      return <Heading2Icon className="size-4" />
    case 3:
      return <Heading3Icon className="size-4" />
  }
}
