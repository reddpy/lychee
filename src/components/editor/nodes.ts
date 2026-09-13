import type { Klass, LexicalNode } from "lexical"
import { HeadingNode, QuoteNode } from "@lexical/rich-text"
import { CodeNode, CodeHighlightNode } from "@lexical/code"
import { LinkNode, AutoLinkNode } from "@lexical/link"
import { ListNode, ListItemNode } from "@lexical/list"
import { TableNode, TableRowNode, TableCellNode } from "@lexical/table"
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode"
import { TitleNode } from "@/components/editor/nodes/title-node"
import { ReferenceNode } from "@/components/editor/nodes/reference-node"
import { NoteBookmarkNode } from "@/components/editor/nodes/note-bookmark-node"
import { UnknownNode } from "@/components/editor/nodes/unknown-node"

export const nodes: Array<Klass<LexicalNode>> = [
  TitleNode,
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  AutoLinkNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  HorizontalRuleNode,
  ReferenceNode,
  NoteBookmarkNode,
  UnknownNode,
]

/**
 * Node types Lexical registers by default (not listed in `nodes`) plus every
 * custom/registered type. The content-load pre-parse pass uses this to tell a
 * real node from an unrecognized one, so it can preserve the latter.
 */
const CORE_NODE_TYPES = ["root", "paragraph", "text", "linebreak", "tab"]

export const KNOWN_NODE_TYPES: ReadonlySet<string> = new Set([
  ...CORE_NODE_TYPES,
  ...nodes.map((node) => node.getType()),
])
