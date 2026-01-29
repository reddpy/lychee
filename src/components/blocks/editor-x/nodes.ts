import { CodeHighlightNode, CodeNode } from "@lexical/code"
import { AutoLinkNode, LinkNode } from "@lexical/link"
import { HeadingNode, QuoteNode } from "@lexical/rich-text"
import type { Klass, LexicalNode } from "lexical"
import { ParagraphNode, TextNode } from "lexical"

export const nodes: ReadonlyArray<Klass<LexicalNode>> = [
  HeadingNode,
  ParagraphNode,
  TextNode,
  QuoteNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  AutoLinkNode,
]
