"use client"

import { useRef } from "react"
import { AutoLinkPlugin } from "@lexical/react/LexicalAutoLinkPlugin"
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin"
import { LinkClickPlugin } from "@/components/editor/plugins/link-click-plugin"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin"
import { ListPlugin } from "@lexical/react/LexicalListPlugin"
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin"
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin"
import { TRANSFORMERS } from "@lexical/markdown"
import { LinkMatcher } from "@lexical/react/LexicalAutoLinkPlugin"
import * as linkify from "linkifyjs"

import { ContentEditable } from "@/components/editor/editor-ui/content-editable"
import { DraggableBlockPlugin } from "@/components/editor/plugins/draggable-block-plugin"
import { SlashCommandPlugin } from "@/components/editor/plugins/slash-command-plugin"
import { KeyboardShortcutsPlugin } from "@/components/editor/plugins/keyboard-shortcuts-plugin"
import { FloatingToolbarPlugin } from "@/components/editor/plugins/floating-toolbar-plugin"
import { CodeHighlightPlugin } from "@/components/editor/plugins/code-highlight-plugin"
import { LinkEditorPlugin } from "@/components/editor/plugins/link-editor-plugin"

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

export function Plugins() {
  const editorContainerRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={editorContainerRef} className="relative">
      <RichTextPlugin
        contentEditable={
          <ContentEditable placeholder="Start typing or press / for commands..." />
        }
        ErrorBoundary={LexicalErrorBoundary}
      />

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
      <CodeHighlightPlugin />

      {/* Keyboard shortcuts */}
      <KeyboardShortcutsPlugin />

      {/* Slash command menu */}
      <SlashCommandPlugin />

      {/* Floating toolbar on selection */}
      <FloatingToolbarPlugin />

      {/* Link editor popover */}
      <LinkEditorPlugin />

      {/* Drag and drop blocks */}
      <DraggableBlockPlugin anchorElem={editorContainerRef.current} />
    </div>
  )
}
