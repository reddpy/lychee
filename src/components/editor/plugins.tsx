"use client"

import { useRef } from "react"
import { AutoLinkPlugin } from "@lexical/react/LexicalAutoLinkPlugin"
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin"
import { LinkClickPlugin } from "@/components/editor/plugins/link-click-plugin"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin"
import { ListPlugin } from "@lexical/react/LexicalListPlugin"
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin"
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin"
import {
  HEADING,
  QUOTE,
  CODE,
  UNORDERED_LIST,
  ORDERED_LIST,
  CHECK_LIST,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  INLINE_CODE,
  STRIKETHROUGH,
  HIGHLIGHT,
  LINK,
} from "@lexical/markdown"
import { LinkMatcher } from "@lexical/react/LexicalAutoLinkPlugin"
import * as linkify from "linkifyjs"

import { ContentEditable } from "@/components/editor/editor-ui/content-editable"
import { DraggableBlockPlugin } from "@/components/editor/plugins/draggable-block-plugin"
import { SlashCommandPlugin } from "@/components/editor/plugins/slash-command-plugin"
import { KeyboardShortcutsPlugin } from "@/components/editor/plugins/keyboard-shortcuts-plugin"
import { FloatingToolbarPlugin } from "@/components/editor/plugins/floating-toolbar-plugin"
import { LinkEditorPlugin } from "@/components/editor/plugins/link-editor-plugin"
import { TitlePlugin } from "@/components/editor/plugins/title-plugin"
import { BlockPlaceholderPlugin } from "@/components/editor/plugins/block-placeholder-plugin"
import { CodeBlockPlugin } from "@/components/editor/plugins/code-block-plugin"
import { SectionIndicatorPlugin } from "@/components/editor/plugins/section-indicator-plugin"
import { BlockHighlightPlugin } from "@/components/editor/plugins/block-highlight-plugin"
import { ImagePlugin } from "@/components/editor/plugins/image-plugin"
import { YouTubePlugin } from "@/components/editor/plugins/youtube-plugin"
import { ClickToAppendPlugin } from "@/components/editor/plugins/click-to-append-plugin"
import { IMAGE, IMAGE_EXPORT } from "@/components/editor/plugins/image-markdown-transformer"

const TRANSFORMERS = [
  HEADING,
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  CHECK_LIST,
  IMAGE_EXPORT,
  CODE,
  INLINE_CODE,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  HIGHLIGHT,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  IMAGE,
  LINK,
]

// Use linkifyjs for robust URL/email detection
const MATCHERS: LinkMatcher[] = [
  (text: string) => {
    const matches = linkify.find(text, { defaultProtocol: "https" })
    if (matches.length === 0) return null

    const match = matches[0]
    return {
      index: match.start,
      length: match.value.length,
      text: match.value,
      url: match.href,
    }
  },
]

interface PluginsProps {
  initialTitle?: string
  onTitleChange?: (title: string) => void
}

export function Plugins({ initialTitle, onTitleChange }: PluginsProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={editorContainerRef} className="relative">
      <RichTextPlugin
        contentEditable={
          <ContentEditable />
        }
        ErrorBoundary={LexicalErrorBoundary}
      />

      {/* Title plugin */}
      <TitlePlugin initialTitle={initialTitle} onTitleChange={onTitleChange} />

      {/* Block placeholders */}
      <BlockPlaceholderPlugin />

      {/* Core plugins */}
      <HistoryPlugin />
      <ListPlugin />
      <CheckListPlugin />
      <TabIndentationPlugin />
      <HorizontalRulePlugin />
      <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
      <LinkPlugin />
      <AutoLinkPlugin matchers={MATCHERS} />
      <LinkClickPlugin />
      <CodeBlockPlugin />
      {/* Keyboard shortcuts */}
      <KeyboardShortcutsPlugin />

      {/* Slash command menu */}
      <SlashCommandPlugin />

      {/* Floating toolbar on selection */}
      <FloatingToolbarPlugin />

      {/* Link editor popover */}
      <LinkEditorPlugin />

      {/* Image drop, paste, and insert command */}
      <ImagePlugin />

      {/* YouTube video embed on paste */}
      <YouTubePlugin />

      {/* Block highlight (shared by drag handle, TOC, etc.) */}
      <BlockHighlightPlugin />

      {/* Drag and drop blocks */}
      <DraggableBlockPlugin anchorElem={editorContainerRef.current} />

      {/* Click below last block to append paragraph */}
      <ClickToAppendPlugin />

      {/* Section position indicator */}
      <SectionIndicatorPlugin />
    </div>
  )
}
