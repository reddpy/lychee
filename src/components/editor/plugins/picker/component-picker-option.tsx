import { JSX } from "react"
import { MenuOption } from "@lexical/react/LexicalTypeaheadMenuPlugin"
import { LexicalEditor } from "lexical"

export class ComponentPickerOption extends MenuOption {
  title: string
  icon?: JSX.Element
  keywords: Array<string>
  keyboardShortcut?: string
  /** Run block change in the current update (no nested editor.update). Use for block-type changes. */
  applyInUpdate?: (editor: LexicalEditor) => void
  onSelect: (
    queryString: string,
    editor: LexicalEditor,
    showModal: (
      title: string,
      showModal: (onClose: () => void) => JSX.Element
    ) => void
  ) => void

  constructor(
    title: string,
    options: {
      icon?: JSX.Element
      keywords?: Array<string>
      keyboardShortcut?: string
      applyInUpdate?: (editor: LexicalEditor) => void
      onSelect: (
        queryString: string,
        editor: LexicalEditor,
        showModal: (
          title: string,
          showModal: (onClose: () => void) => JSX.Element
        ) => void
      ) => void
    }
  ) {
    super(title)
    this.title = title
    this.keywords = options.keywords || []
    this.icon = options.icon
    this.keyboardShortcut = options.keyboardShortcut
    this.applyInUpdate = options.applyInUpdate
    this.onSelect = options.onSelect.bind(this)
  }
}
