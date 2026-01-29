import { CodeHighlightNode, CodeNode } from "@lexical/code"
import { LinkNode, AutoLinkNode } from "@lexical/link"
import { ListItemNode, ListNode } from "@lexical/list"
import { HeadingNode, QuoteNode } from "@lexical/rich-text"
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table"
import {
  Klass,
  LexicalNode,
  LexicalNodeReplacement,
  ParagraphNode,
  TextNode,
} from "lexical"
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode"

import { EmojiNode } from "@/components/editor/nodes/emoji-node"
import { ImageNode } from "@/components/editor/nodes/image-node"

export const nodes: ReadonlyArray<
  Klass<LexicalNode> | LexicalNodeReplacement
> = [
  HeadingNode,
  ParagraphNode,
  TextNode,
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
  ImageNode,
  EmojiNode,
]
