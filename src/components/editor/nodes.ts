import type { Klass, LexicalNode } from "lexical"
import { HeadingNode, QuoteNode } from "@lexical/rich-text"
import { CodeNode, CodeHighlightNode } from "@lexical/code"
import { LinkNode, AutoLinkNode } from "@lexical/link"
import { ListNode, ListItemNode } from "@lexical/list"
import { TableNode, TableRowNode, TableCellNode } from "@lexical/table"
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode"
import { TitleNode } from "@/components/editor/nodes/title-node"
import { ImageNode } from "@/components/editor/nodes/image-node"
import { BookmarkNode } from "@/components/editor/nodes/bookmark-node"
import { YouTubeNode } from "@/components/editor/nodes/youtube-node"
import { LoadingPlaceholderNode } from "@/components/editor/nodes/loading-placeholder-node"

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
  ImageNode,
  BookmarkNode,
  YouTubeNode,
  LoadingPlaceholderNode,
]
