"use client"

import { AutoLinkPlugin } from "@lexical/react/LexicalAutoLinkPlugin"
import { ClickableLinkPlugin } from "@lexical/react/LexicalClickableLinkPlugin"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { createLinkMatcherWithRegExp } from "@lexical/link"

import { ContentEditable } from "@/components/editor/editor-ui/content-editable"

const placeholder = "Start typing or press / for commands…"

const URL_REGEX =
  /((https?:\/\/(www\.)?)|(www\.))[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_+.~#?&//=]*/

const EMAIL_REGEX =
  /(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))/

const autoLinkMatchers = [
  createLinkMatcherWithRegExp(URL_REGEX, (text) =>
    text.startsWith("http") ? text : `https://${text}`
  ),
  createLinkMatcherWithRegExp(EMAIL_REGEX, (text) => `mailto:${text}`),
]

export function Plugins() {
  return (
    <div className="relative">
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            className="ContentEditable__root relative block min-h-[200px] overflow-auto px-4 py-3 outline-none"
          />
        }
        ErrorBoundary={LexicalErrorBoundary}
        placeholder={
          <div
            className="pointer-events-none absolute left-4 top-3 select-none overflow-hidden text-ellipsis pr-4 text-muted-foreground"
            aria-hidden
          >
            {placeholder}
          </div>
        }
      />
      <HistoryPlugin />
      <TabIndentationPlugin />
      <AutoLinkPlugin matchers={autoLinkMatchers} />
      <ClickableLinkPlugin />
    </div>
  )
}
