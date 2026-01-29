import type { EditorThemeClasses } from "lexical"

import "./editor-theme.css"

export const editorTheme: EditorThemeClasses = {
  ltr: "text-left",
  rtl: "text-right",
  paragraph: "leading-7 [&:not(:first-child)]:mt-6",
  quote: "mt-6 border-l-2 border-border pl-6 italic",
  heading: {
    h1: "scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl",
    h2: "scroll-m-20 border-b border-border pb-2 text-3xl font-semibold tracking-tight",
    h3: "scroll-m-20 text-2xl font-semibold tracking-tight",
    h4: "scroll-m-20 text-xl font-semibold tracking-tight",
    h5: "scroll-m-20 text-lg font-semibold tracking-tight",
    h6: "scroll-m-20 text-base font-semibold tracking-tight",
  },
  list: {
    ul: "m-0 p-0 list-disc [&>li]:mt-2",
    ol: "m-0 p-0 list-decimal [&>li]:mt-2",
    listitem: "mx-8",
    listitemChecked: "line-through",
    listitemUnchecked: "",
    nested: { listitem: "list-none" },
  },
  link: "text-primary underline underline-offset-4",
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    code: "bg-muted px-1.5 py-0.5 rounded text-sm font-mono",
  },
  code: "bg-muted rounded-md p-4 font-mono text-sm",
  codeHighlight: {},
  hr: "my-4 border-border",
  table: "border-collapse w-full",
  tableCell: "border border-border px-4 py-2",
  tableCellHeader: "border border-border bg-muted px-4 py-2 font-bold",
}
