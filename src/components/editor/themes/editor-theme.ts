import { EditorThemeClasses } from "lexical"

import "./editor-theme.css"

export const editorTheme: EditorThemeClasses = {
  ltr: "text-left",
  rtl: "text-right",
  heading: {
    h1: "scroll-m-20 text-4xl font-bold tracking-tight [&:not(:first-child)]:mt-10 mb-4",
    h2: "scroll-m-20 text-3xl font-semibold tracking-tight [&:not(:first-child)]:mt-8 mb-4",
    h3: "scroll-m-20 text-2xl font-semibold tracking-tight [&:not(:first-child)]:mt-6 mb-3",
    h4: "scroll-m-20 text-xl font-semibold tracking-tight [&:not(:first-child)]:mt-4 mb-2",
    h5: "scroll-m-20 text-lg font-semibold tracking-tight [&:not(:first-child)]:mt-4 mb-2",
    h6: "scroll-m-20 text-base font-semibold tracking-tight [&:not(:first-child)]:mt-4 mb-2",
  },
  paragraph: "leading-7",
  quote: "mt-1 border-l-2 pl-6 italic",
  link: "text-blue-600 underline cursor-text",
  list: {
    checklist: "relative",
    listitem: "mx-8",
    listitemChecked:
      "relative mx-2 px-6 list-none outline-none line-through before:content-[''] before:w-[18px] before:h-[18px] before:top-0.5 before:left-0 before:cursor-pointer before:block before:absolute before:border-2 before:border-primary before:rounded-[2px] before:bg-primary before:bg-no-repeat",
    listitemUnchecked:
      'relative mx-2 px-6 list-none outline-none before:content-[""] before:w-[18px] before:h-[18px] before:top-0.5 before:left-0 before:cursor-pointer before:block before:absolute before:border-2 before:border-primary before:rounded-[2px]',
    nested: {
      listitem: "list-none before:hidden after:hidden",
    },
    ol: "m-0 p-0 list-decimal [&>li]:mt-2",
    olDepth: [
      "list-outside !list-decimal",
      "list-outside !list-[upper-roman]",
      "list-outside !list-[lower-roman]",
      "list-outside !list-[upper-alpha]",
      "list-outside !list-[lower-alpha]",
    ],
    ul: "m-0 p-0 list-outside [&>li]:mt-2",
    ulDepth: [
      "list-outside !list-disc",
      "list-outside !list-disc",
      "list-outside !list-disc",
      "list-outside !list-disc",
      "list-outside !list-disc",
    ],
  },
  hashtag: "text-blue-600 bg-blue-100 rounded-md px-1",
  text: {
    bold: "font-bold",
    code: "bg-gray-100 p-1 rounded-md",
    italic: "italic",
    strikethrough: "line-through",
    subscript: "sub",
    superscript: "sup",
    underline: "underline",
    underlineStrikethrough: "[text-decoration:underline_line-through]",
  },
  image: "relative inline-block user-select-none cursor-default editor-image",
  inlineImage:
    "relative inline-block user-select-none cursor-default inline-editor-image",
  keyword: "text-purple-900 font-bold",
  code: "EditorTheme__code",
  codeHighlight: {
    atrule: "EditorTheme__tokenAttr",
    attr: "EditorTheme__tokenAttr",
    boolean: "EditorTheme__tokenProperty",
    builtin: "EditorTheme__tokenSelector",
    cdata: "EditorTheme__tokenComment",
    char: "EditorTheme__tokenSelector",
    class: "EditorTheme__tokenFunction",
    "class-name": "EditorTheme__tokenFunction",
    comment: "EditorTheme__tokenComment",
    constant: "EditorTheme__tokenProperty",
    deleted: "EditorTheme__tokenProperty",
    doctype: "EditorTheme__tokenComment",
    entity: "EditorTheme__tokenOperator",
    function: "EditorTheme__tokenFunction",
    important: "EditorTheme__tokenVariable",
    inserted: "EditorTheme__tokenSelector",
    keyword: "EditorTheme__tokenAttr",
    namespace: "EditorTheme__tokenVariable",
    number: "EditorTheme__tokenProperty",
    operator: "EditorTheme__tokenOperator",
    prolog: "EditorTheme__tokenComment",
    property: "EditorTheme__tokenProperty",
    punctuation: "EditorTheme__tokenPunctuation",
    regex: "EditorTheme__tokenVariable",
    selector: "EditorTheme__tokenSelector",
    string: "EditorTheme__tokenSelector",
    symbol: "EditorTheme__tokenProperty",
    tag: "EditorTheme__tokenProperty",
    url: "EditorTheme__tokenOperator",
    variable: "EditorTheme__tokenVariable",
  },
  characterLimit: "!bg-destructive/50",
  table: "EditorTheme__table w-fit overflow-scroll border-collapse",
  tableCell:
    'EditorTheme__tableCell w-24 relative border px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right"',
  tableCellActionButton:
    "EditorTheme__tableCellActionButton bg-background block border-0 rounded-2xl w-5 h-5 text-foreground cursor-pointer",
  tableCellActionButtonContainer:
    "EditorTheme__tableCellActionButtonContainer block right-1 top-1.5 absolute z-10 w-5 h-5",
  tableCellEditing: "EditorTheme__tableCellEditing rounded-sm shadow-sm",
  tableCellHeader:
    "EditorTheme__tableCellHeader bg-muted border px-4 py-2 text-left font-bold [&[align=center]]:text-center [&[align=right]]:text-right",
  tableCellPrimarySelected:
    "EditorTheme__tableCellPrimarySelected border border-primary border-solid block h-[calc(100%-2px)] w-[calc(100%-2px)] absolute -left-[1px] -top-[1px] z-10 ",
  tableCellResizer:
    "EditorTheme__tableCellResizer absolute -right-1 h-full w-2 cursor-ew-resize z-10 top-0",
  tableCellSelected: "EditorTheme__tableCellSelected bg-muted",
  tableCellSortedIndicator:
    "EditorTheme__tableCellSortedIndicator block opacity-50 bsolute bottom-0 left-0 w-full h-1 bg-muted",
  tableResizeRuler:
    "EditorTheme__tableCellResizeRuler block absolute w-[1px] h-full bg-primary top-0",
  tableRowStriping:
    "EditorTheme__tableRowStriping m-0 border-t p-0 even:bg-muted",
  tableSelected: "EditorTheme__tableSelected ring-2 ring-primary ring-offset-2",
  tableSelection: "EditorTheme__tableSelection bg-transparent",
  layoutItem: "border border-dashed px-4 py-2",
  layoutContainer: "grid gap-2.5 my-2.5 mx-0",
  autocomplete: "text-muted-foreground",
  blockCursor: "",
  embedBlock: {
    base: "user-select-none",
    focus: "ring-2 ring-primary ring-offset-2",
  },
  hr: "",
  indent: "[--lexical-indent-base-value:40px]",
  mark: "",
  markOverlap: "",
}
