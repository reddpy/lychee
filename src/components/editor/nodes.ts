import type { Klass, LexicalNode } from "lexical"
import { HeadingNode, QuoteNode } from "@lexical/rich-text"
import { ListNode, ListItemNode } from "@lexical/list"
import { CodeNode, CodeHighlightNode } from "@lexical/code"
import { LinkNode, AutoLinkNode } from "@lexical/link"
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode"
import { TitleNode } from "@/components/editor/nodes/title-node"

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
  HorizontalRuleNode,
]
