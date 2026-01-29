"use client"

import { useState } from "react"
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin"
import { ClickableLinkPlugin } from "@lexical/react/LexicalClickableLinkPlugin"
import {
  CHECK_LIST,
  ELEMENT_TRANSFORMERS,
  MULTILINE_ELEMENT_TRANSFORMERS,
  TEXT_FORMAT_TRANSFORMERS,
  TEXT_MATCH_TRANSFORMERS,
} from "@lexical/markdown"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin"
import { ListPlugin } from "@lexical/react/LexicalListPlugin"
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { TablePlugin as LexicalTablePlugin } from "@lexical/react/LexicalTablePlugin"
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin"

import { ContentEditable } from "@/components/editor/editor-ui/content-editable"
import { AutoLinkPlugin } from "@/components/editor/plugins/auto-link-plugin"
import { CodeActionMenuPlugin } from "@/components/editor/plugins/code-action-menu-plugin"
import { CodeHighlightPlugin } from "@/components/editor/plugins/code-highlight-plugin"
import { ComponentPickerMenuPlugin } from "@/components/editor/plugins/component-picker-menu-plugin"
import { DragDropPastePlugin } from "@/components/editor/plugins/drag-drop-paste-plugin"
import { DraggableBlockPlugin } from "@/components/editor/plugins/draggable-block-plugin"
import { EmojiPickerPlugin } from "@/components/editor/plugins/emoji-picker-plugin"
import { EmojisPlugin } from "@/components/editor/plugins/emojis-plugin"
import { FloatingLinkEditorPlugin } from "@/components/editor/plugins/floating-link-editor-plugin"
import { FloatingTextFormatToolbarPlugin } from "@/components/editor/plugins/floating-text-format-plugin"
import { ImagesPlugin } from "@/components/editor/plugins/images-plugin"
import { LinkPlugin } from "@/components/editor/plugins/link-plugin"
import { ListMaxIndentLevelPlugin } from "@/components/editor/plugins/list-max-indent-level-plugin"
import { TabFocusPlugin } from "@/components/editor/plugins/tab-focus-plugin"
import { ToolbarPlugin } from "@/components/editor/plugins/toolbar/toolbar-plugin"
import { BlockFormatDropDown } from "@/components/editor/plugins/toolbar/block-format-toolbar-plugin"
import { FormatBulletedList } from "@/components/editor/plugins/toolbar/block-format/format-bulleted-list"
import { FormatCheckList } from "@/components/editor/plugins/toolbar/block-format/format-check-list"
import { FormatCodeBlock } from "@/components/editor/plugins/toolbar/block-format/format-code-block"
import { FormatHeading } from "@/components/editor/plugins/toolbar/block-format/format-heading"
import { FormatNumberedList } from "@/components/editor/plugins/toolbar/block-format/format-numbered-list"
import { FormatParagraph } from "@/components/editor/plugins/toolbar/block-format/format-paragraph"
import { FormatQuote } from "@/components/editor/plugins/toolbar/block-format/format-quote"
import { CodeLanguageToolbarPlugin } from "@/components/editor/plugins/toolbar/code-language-toolbar-plugin"
import { HistoryToolbarPlugin } from "@/components/editor/plugins/toolbar/history-toolbar-plugin"
import { AlignmentPickerPlugin } from "@/components/editor/plugins/picker/alignment-picker-plugin"
import { HeadingPickerPlugin } from "@/components/editor/plugins/picker/heading-picker-plugin"
import { ParagraphPickerPlugin } from "@/components/editor/plugins/picker/paragraph-picker-plugin"
import { QuotePickerPlugin } from "@/components/editor/plugins/picker/quote-picker-plugin"
import { EMOJI } from "@/components/editor/transformers/markdown-emoji-transformer"
import { HR } from "@/components/editor/transformers/markdown-hr-transformer"
import { IMAGE } from "@/components/editor/transformers/markdown-image-transformer"
import { TABLE } from "@/components/editor/transformers/markdown-table-transformer"

const placeholder = "Start typing or press / for commands…"

const markdownTransformers = [
  TABLE,
  HR,
  IMAGE,
  EMOJI,
  CHECK_LIST,
  ...ELEMENT_TRANSFORMERS,
  ...MULTILINE_ELEMENT_TRANSFORMERS,
  ...TEXT_FORMAT_TRANSFORMERS,
  ...TEXT_MATCH_TRANSFORMERS,
]

const componentPickerOptions = [
  ParagraphPickerPlugin(),
  HeadingPickerPlugin({ n: 1 }),
  HeadingPickerPlugin({ n: 2 }),
  HeadingPickerPlugin({ n: 3 }),
  QuotePickerPlugin(),
  AlignmentPickerPlugin({ alignment: "left" }),
  AlignmentPickerPlugin({ alignment: "right" }),
  AlignmentPickerPlugin({ alignment: "center" }),
  AlignmentPickerPlugin({ alignment: "justify" }),
]

export function Plugins() {
  const [floatingAnchorElem, setFloatingAnchorElem] =
    useState<HTMLDivElement | null>(null)
  const [isLinkEditMode, setIsLinkEditMode] = useState(false)

  const onRef = (el: HTMLDivElement | null) => {
    if (el !== null) setFloatingAnchorElem(el)
  }

  return (
    <div className="relative">
      {/* Toolbar: block format + history (Notion-style) */}
      <ToolbarPlugin>
        {({ blockType }) => (
          <div className="vertical-align-middle sticky top-0 z-10 flex flex-wrap items-center gap-1 overflow-auto border-b bg-background/95 px-2 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <BlockFormatDropDown>
              <FormatParagraph />
              <FormatHeading levels={["h1", "h2", "h3"]} />
              <FormatNumberedList />
              <FormatBulletedList />
              <FormatCheckList />
              <FormatCodeBlock />
              <FormatQuote />
            </BlockFormatDropDown>
            {blockType === "code" ? <CodeLanguageToolbarPlugin /> : null}
            <HistoryToolbarPlugin />
          </div>
        )}
      </ToolbarPlugin>

      <div className="relative">
        <RichTextPlugin
          contentEditable={
            <div className="min-h-[200px]">
              <div ref={onRef}>
                <ContentEditable
                  placeholder={placeholder}
                  className="ContentEditable__root relative block min-h-[200px] min-h-full overflow-auto px-4 py-3 focus:outline-none"
                />
              </div>
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <ListMaxIndentLevelPlugin maxDepth={7} />
        <TabIndentationPlugin />
        <MarkdownShortcutPlugin transformers={markdownTransformers} />
        <LexicalTablePlugin />
        <HorizontalRulePlugin />
        <LinkPlugin />
        <AutoLinkPlugin />
        <ClickableLinkPlugin />
        <ImagesPlugin />
        <EmojisPlugin />
        <EmojiPickerPlugin />
        <DragDropPastePlugin />
        <TabFocusPlugin />
        <CodeHighlightPlugin />
        <ComponentPickerMenuPlugin baseOptions={componentPickerOptions} />
        <CodeActionMenuPlugin anchorElem={floatingAnchorElem} />
        <FloatingTextFormatToolbarPlugin
          anchorElem={floatingAnchorElem}
          setIsLinkEditMode={setIsLinkEditMode}
        />
        <FloatingLinkEditorPlugin
          anchorElem={floatingAnchorElem}
          isLinkEditMode={isLinkEditMode}
          setIsLinkEditMode={setIsLinkEditMode}
        />
        <DraggableBlockPlugin anchorElem={floatingAnchorElem} />
      </div>
    </div>
  )
}
