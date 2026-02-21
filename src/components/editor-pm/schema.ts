import { Schema, NodeSpec, MarkSpec } from "prosemirror-model"

// ── Node Specs ──────────────────────────────────────────

const doc: NodeSpec = {
  content: "title block+",
}

const title: NodeSpec = {
  content: "inline*",
  defining: true,
  parseDOM: [{ tag: "h1.editor-title" }],
  toDOM() {
    return ["h1", { class: "editor-title", "data-placeholder": "New Page" }, 0]
  },
}

const paragraph: NodeSpec = {
  content: "inline*",
  group: "block",
  parseDOM: [{ tag: "p" }],
  toDOM() {
    return ["p", { class: "leading-7" }, 0]
  },
}

const heading: NodeSpec = {
  content: "inline*",
  group: "block",
  attrs: { level: { default: 1 } },
  defining: true,
  parseDOM: [
    { tag: "h1", getAttrs: () => ({ level: 1 }) },
    { tag: "h2", getAttrs: () => ({ level: 2 }) },
    { tag: "h3", getAttrs: () => ({ level: 3 }) },
  ],
  toDOM(node) {
    const level = node.attrs.level as number
    const classes: Record<number, string> = {
      1: "scroll-m-20 text-4xl font-bold tracking-tight mt-10 mb-4",
      2: "scroll-m-20 text-3xl font-semibold tracking-tight mt-8 mb-4",
      3: "scroll-m-20 text-2xl font-semibold tracking-tight mt-6 mb-3",
    }
    return ["h" + level, { class: classes[level] || "" }, 0]
  },
}

const blockquote: NodeSpec = {
  content: "block+",
  group: "block",
  defining: true,
  parseDOM: [{ tag: "blockquote" }],
  toDOM() {
    return ["blockquote", { class: "mt-1 border-l-2 pl-6 italic" }, 0]
  },
}

// ── Standard PM list nodes ────────────────────────────────

const orderedList: NodeSpec = {
  content: "list_item+",
  group: "block",
  attrs: { order: { default: 1 } },
  parseDOM: [{
    tag: "ol",
    getAttrs(dom) {
      return { order: (dom as HTMLOListElement).start || 1 }
    },
  }],
  toDOM(node) {
    return node.attrs.order === 1
      ? ["ol", 0]
      : ["ol", { start: node.attrs.order }, 0]
  },
}

const bulletList: NodeSpec = {
  content: "list_item+",
  group: "block",
  parseDOM: [{ tag: "ul" }],
  toDOM() {
    return ["ul", 0]
  },
}

const listItem: NodeSpec = {
  content: "paragraph block*",
  parseDOM: [{ tag: "li" }],
  toDOM() {
    return ["li", 0]
  },
  defining: true,
}

const codeBlock: NodeSpec = {
  content: "text*",
  group: "block",
  code: true,
  defining: true,
  marks: "",
  attrs: { language: { default: "" } },
  parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
  toDOM() {
    return ["pre", { class: "editor-code" }, ["code", 0]]
  },
}

const horizontalRule: NodeSpec = {
  group: "block",
  parseDOM: [{ tag: "hr" }],
  toDOM() {
    return ["hr"] as unknown as ReturnType<NonNullable<NodeSpec["toDOM"]>>
  },
}

const toggleContainer: NodeSpec = {
  content: "toggleTitle toggleContent",
  group: "block",
  isolating: true,
  attrs: { open: { default: true } },
  parseDOM: [
    {
      tag: "details",
      getAttrs(dom) {
        return { open: (dom as HTMLDetailsElement).open }
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = { class: "Collapsible__container" }
    if (node.attrs.open) attrs["open"] = "true"
    return ["details", attrs, 0]
  },
}

const toggleTitle: NodeSpec = {
  content: "inline*",
  defining: true,
  parseDOM: [{ tag: "summary" }],
  toDOM() {
    return ["summary", { class: "Collapsible__title" }, 0]
  },
}

const toggleContent: NodeSpec = {
  content: "block+",
  parseDOM: [{ tag: "div.toggle-content" }],
  toDOM() {
    return ["div", { class: "toggle-content" }, 0]
  },
}

const text: NodeSpec = {
  group: "inline",
}

const hardBreak: NodeSpec = {
  inline: true,
  group: "inline",
  selectable: false,
  parseDOM: [{ tag: "br" }],
  toDOM() {
    return ["br"] as unknown as ReturnType<NonNullable<NodeSpec["toDOM"]>>
  },
}

// ── Mark Specs ──────────────────────────────────────────

const bold: MarkSpec = {
  parseDOM: [
    { tag: "strong" },
    { tag: "b", getAttrs: (node) => (node as HTMLElement).style.fontWeight !== "normal" && null },
    { style: "font-weight=bold" },
    { style: "font-weight=700" },
  ],
  toDOM() {
    return ["strong", { class: "font-bold" }, 0]
  },
}

const italic: MarkSpec = {
  parseDOM: [{ tag: "i" }, { tag: "em" }, { style: "font-style=italic" }],
  toDOM() {
    return ["em", { class: "italic" }, 0]
  },
}

const underline: MarkSpec = {
  parseDOM: [{ tag: "u" }, { style: "text-decoration=underline" }],
  toDOM() {
    return ["u", { class: "underline" }, 0]
  },
}

const strikethrough: MarkSpec = {
  parseDOM: [{ tag: "s" }, { tag: "del" }, { style: "text-decoration=line-through" }],
  toDOM() {
    return ["s", { class: "line-through" }, 0]
  },
}

const code: MarkSpec = {
  parseDOM: [{ tag: "code" }],
  toDOM() {
    return ["code", { class: "bg-gray-100 p-1 rounded-md" }, 0]
  },
}

const superscript: MarkSpec = {
  parseDOM: [{ tag: "sup" }],
  toDOM() {
    return ["sup", { class: "sup" }, 0]
  },
}

const subscript: MarkSpec = {
  parseDOM: [{ tag: "sub" }],
  toDOM() {
    return ["sub", { class: "sub" }, 0]
  },
}

const link: MarkSpec = {
  attrs: {
    href: {},
    title: { default: null },
  },
  inclusive: false,
  parseDOM: [
    {
      tag: "a[href]",
      getAttrs(dom) {
        const el = dom as HTMLAnchorElement
        return { href: el.getAttribute("href"), title: el.getAttribute("title") }
      },
    },
  ],
  toDOM(mark) {
    return ["a", { href: mark.attrs.href, class: "text-blue-600 underline cursor-text", title: mark.attrs.title }, 0]
  },
}

// ── Schema ──────────────────────────────────────────────

export const schema = new Schema({
  nodes: {
    doc,
    title,
    paragraph,
    heading,
    blockquote,
    ordered_list: orderedList,
    bullet_list: bulletList,
    list_item: listItem,
    codeBlock,
    horizontalRule,
    toggleContainer,
    toggleTitle,
    toggleContent,
    text,
    hardBreak,
  },
  marks: {
    bold,
    italic,
    underline,
    strikethrough,
    code,
    superscript,
    subscript,
    link,
  },
})
