"use client"

import { useRef } from "react"
import { AutoLinkPlugin, LinkMatcher } from "@lexical/react/LexicalAutoLinkPlugin"
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin"
import { LinkClickPlugin } from "@/components/editor/plugins/link-click-plugin"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { YjsUndoPlugin } from "@/components/editor/plugins/yjs-undo-plugin"
import { AgentHighlightPlugin } from "@/components/editor/plugins/agent-highlight-plugin"
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin"
import { ListPlugin } from "@lexical/react/LexicalListPlugin"
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin"
import { TablePlugin } from "@lexical/react/LexicalTablePlugin"
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin"
import * as linkify from "linkifyjs"

import { ContentEditable } from "@/components/editor/editor-ui/content-editable"
import { ChecklistShortcutPlugin } from "@/components/editor/plugins/checklist-shortcut-plugin"
import { SlashCommandPlugin } from "@/components/editor/plugins/slash-command-plugin"
import { KeyboardShortcutsPlugin } from "@/components/editor/plugins/keyboard-shortcuts-plugin"
import { FloatingToolbarPlugin } from "@/components/editor/plugins/floating-toolbar-plugin"
import { LinkEditorPlugin } from "@/components/editor/plugins/link-editor-plugin"

import { BlockPlaceholderPlugin } from "@/components/editor/plugins/block-placeholder-plugin"
import { FocusModePlugin } from "@/components/editor/plugins/focus-mode-plugin"
import { TypewriterPlugin } from "@/components/editor/plugins/typewriter-plugin"
import { WordCountPlugin } from "@/components/editor/plugins/word-count-plugin"
import { CodeBlockPlugin } from "@/components/editor/plugins/code-block-plugin"
import { NoteDrawerPlugin } from "@/components/editor/note-drawer"
import { NoteBookmarkPlugin } from "@/components/editor/plugins/note-bookmark-plugin"
import { SectionRailPlugin } from "@/components/editor/plugins/section-rail-plugin"
import { BlockHighlightPlugin } from "@/components/editor/plugins/block-highlight-plugin"
import { ImagePlugin } from "@/components/editor/plugins/image-plugin"
import { ClickToAppendPlugin } from "@/components/editor/plugins/click-to-append-plugin"
import { TableActionMenuPlugin } from "@/components/editor/plugins/table-action-menu-plugin"
import { TableControlsPlugin } from "@/components/editor/plugins/table-controls-plugin"
import { TableColumnResizerPlugin } from "@/components/editor/plugins/table-column-resizer-plugin"
import { SearchHighlightPlugin } from "@/components/editor/plugins/search-highlight-plugin"
import { TabSelectionPlugin } from "@/components/editor/plugins/tab-selection-plugin"
import { MenuHistoryPlugin } from "@/components/editor/plugins/menu-history-plugin"
import { MARKDOWN_TRANSFORMERS } from "@/components/editor/markdown-transformers"
import { useEditorPreferencesStore } from "@/renderer/editor-preferences-store"

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
  documentId: string
  tabId: string
  activeTabId: string | null
  isActive: boolean
}

export function Plugins({
  documentId,
  tabId,
  activeTabId,
  isActive,
}: PluginsProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const autolink = useEditorPreferencesStore((s) => s.autolink)
  const slashMenu = useEditorPreferencesStore((s) => s.slashMenu)
  const yjsEnabled =
    typeof window !== "undefined" && window.lychee?.flags?.yjs === true

  return (
    <div ref={editorContainerRef} className="relative">
      <RichTextPlugin
        contentEditable={
          <ContentEditable />
        }
        ErrorBoundary={LexicalErrorBoundary}
      />

      {/* Block placeholders */}
      <BlockPlaceholderPlugin />

      {/* Typography / focus / writing aids (app-wide Editor settings) */}
      <WordCountPlugin documentId={documentId} />
      <FocusModePlugin />
      <TypewriterPlugin />

      {/* Core plugins */}
      {yjsEnabled ? <YjsUndoPlugin documentId={documentId} /> : <HistoryPlugin />}
      {yjsEnabled && <AgentHighlightPlugin documentId={documentId} />}
      <MenuHistoryPlugin isActive={isActive} />
      <ListPlugin />
      <CheckListPlugin />
      <ChecklistShortcutPlugin />
      <TabIndentationPlugin />
      <HorizontalRulePlugin />
      <TablePlugin hasCellMerge={false} hasCellBackgroundColor={false} hasTabHandler={true} hasHorizontalScroll={true} />
      <TableActionMenuPlugin />
      <TableControlsPlugin />
      <TableColumnResizerPlugin />
      <MarkdownShortcutPlugin transformers={MARKDOWN_TRANSFORMERS} />
      <LinkPlugin />
      {autolink && <AutoLinkPlugin matchers={MATCHERS} />}
      <LinkClickPlugin />
      <CodeBlockPlugin />
      {/* Keyboard shortcuts */}
      <KeyboardShortcutsPlugin />

      {/* Slash command menu */}
      {slashMenu && <SlashCommandPlugin />}

      {/* Floating toolbar on selection */}
      <FloatingToolbarPlugin activeTabId={activeTabId} />

      {/* Link editor popover */}
      <LinkEditorPlugin documentId={documentId} />

      {/* Image drop, paste, and insert command */}
      <ImagePlugin />

      {/* Block highlight (shared by the note drawer and other features) */}
      <BlockHighlightPlugin />

      {/* Click below last block to append paragraph */}
      <ClickToAppendPlugin />

      {/* Note drawer: outline, links, highlights, in-note bookmarks */}
      <NoteDrawerPlugin documentId={documentId} />

      {/* In-note bookmark toggle (floating toolbar, shortcut, context menu) */}
      <NoteBookmarkPlugin isActive={isActive} />

      {/* Right-edge section rail for fast scrolling */}
      <SectionRailPlugin documentId={documentId} isActive={isActive} />

      {/* In-editor find + highlights (Cmd/Ctrl+F) */}
      {/* Per-tab selection save/restore for duplicate tabs */}
      <TabSelectionPlugin activeTabId={activeTabId} />

      <SearchHighlightPlugin tabId={tabId} documentId={documentId} isActive={isActive} />
    </div>
  )
}
