import type { Klass, LexicalNode } from "lexical"
import { HeadingNode, QuoteNode } from "@lexical/rich-text"
import { CodeNode, CodeHighlightNode } from "@lexical/code"
import { LinkNode, AutoLinkNode } from "@lexical/link"
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode"
import { TitleNode } from "@/components/editor/nodes/title-node"
import { ListItemNode } from "@/components/editor/nodes/list-item-node"

export const nodes: Array<Klass<LexicalNode>> = [
  TitleNode,
  HeadingNode,
  QuoteNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  AutoLinkNode,
  HorizontalRuleNode,
]
