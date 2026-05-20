"use client"

import { useEffect } from "react"
import { InitialConfigType, LexicalComposer } from "@lexical/react/LexicalComposer"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { EditorState, SerializedEditorState } from "lexical"

import { editorTheme } from "@/components/editor/themes/editor-theme"
import { nodes } from "@/components/editor/nodes"
import { Plugins } from "@/components/editor/plugins"

/** Custom save tag for async hydration mutations. Paired with `history-merge`
 *  on the same editor.update call so undo bundles the conversion + the
 *  metadata fill into a single step, while still triggering a save via the
 *  HydrationSaveListener below. OnChangePlugin's default
 *  `ignoreHistoryMergeTagChange: true` would otherwise drop those updates. */
export const LYCHEE_SAVE_TAG = "lychee-save"

/** Fires `onChange` for editor updates tagged with `LYCHEE_SAVE_TAG`. Sits
 *  alongside OnChangePlugin so hydration writes reach saveContent without
 *  flipping OnChangePlugin's global history-merge filter (which other
 *  plugins like TabSelectionPlugin depend on to NOT trigger saves on their
 *  own history-merge updates). */
function HydrationSaveListener({ onChange }: { onChange: (state: EditorState) => void }): null {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, tags }) => {
      if (tags.has(LYCHEE_SAVE_TAG)) {
        onChange(editorState)
      }
    })
  }, [editor, onChange])
  return null
}

const editorConfig: InitialConfigType = {
  namespace: "Editor",
  theme: editorTheme,
  nodes,
  onError: (error: Error) => {
    console.error(error)
  },
}

/**
 * Convert consecutive flat "list-item" nodes (from old flat-list format) into
 * nested "list" > "listitem" structure that Lexical's built-in @lexical/list expects.
 * Already-nested "list" nodes pass through unchanged.
 */
function nestFlatListItems(flatItems: any[], listType: string): any {
  // Build a nested list node from flat items sharing the same listType
  const tag = listType === "number" ? "ol" : "ul"
  const root: any = {
    type: "list",
    listType,
    tag,
    start: 1,
    direction: null,
    format: "",
    version: 1,
    children: [],
  }

  // Group items by indent level to create nesting
  let i = 0
  while (i < flatItems.length) {
    const item = flatItems[i]
    const indent = item.indent ?? 0

    // Collect children that belong nested under this item (higher indent)
    const nestedItems: any[] = []
    let j = i + 1
    while (j < flatItems.length && (flatItems[j].indent ?? 0) > indent) {
      nestedItems.push(flatItems[j])
      j++
    }

    // Build the listitem
    const listitem: any = {
      type: "listitem",
      value: root.children.length + 1,
      checked: item.checked ?? false,
      direction: item.direction ?? null,
      format: item.format ?? "",
      version: 1,
      children: [...(item.children || [])],
    }

    // If there are nested items, create a sub-list
    if (nestedItems.length > 0) {
      // Decrease indent by 1 for nested items
      const adjusted = nestedItems.map((n) => ({ ...n, indent: (n.indent ?? 0) - indent - 1 }))
      const subListType = nestedItems[0].listType || listType
      listitem.children.push(nestFlatListItems(adjusted, subListType))
    }

    root.children.push(listitem)
    i = j
  }

  return root
}

/**
 * Migrate children: remove legacy nodes and convert old flat "list-item" nodes
 * into proper nested list/listitem structure.
 */
function migrateChildren(children: any[]): any[] {
  const result: any[] = []

  let i = 0
  while (i < children.length) {
    const child = children[i]

    // Filter out legacy nodes
    if (child.type === "code-snippet" || child.type === "executable-code-block") {
      i++
      continue
    }

    if (child.type === "list-item") {
      // Collect consecutive flat list-item nodes
      const group: any[] = []
      while (i < children.length && children[i].type === "list-item") {
        group.push(children[i])
        i++
      }
      const listType = group[0].listType || "bullet"
      result.push(nestFlatListItems(group, listType))
    } else if (child.type === "list") {
      // Already in nested format — pass through
      result.push(child)
      i++
    } else {
      // Non-list nodes: recurse into children
      if (child.children && Array.isArray(child.children)) {
        result.push({ ...child, children: migrateChildren(child.children) })
      } else {
        result.push(child)
      }
      i++
    }
  }

  return result
}

// Sanitize the serialized state to handle empty states and legacy nodes
export function sanitizeSerializedState(
  state: SerializedEditorState
): SerializedEditorState | null {
  // Clone to avoid mutating the original
  const cloned = JSON.parse(JSON.stringify(state))

  // Migrate legacy node types
  if (cloned.root?.children) {
    cloned.root.children = migrateChildren(cloned.root.children)
  }

  // Ensure root has at least one child (Lexical requires this)
  if (!cloned.root?.children?.length) {
    return null // Let Lexical create default state
  }

  return cloned
}

export function Editor({
  documentId,
  tabId,
  activeTabId,
  isActive,
  editorSerializedState,
  onEditorStateChange,
  initialTitle,
  onTitleChange,
}: {
  documentId: string
  tabId: string
  /** The currently active tabId for this document (changes on tab switch). */
  activeTabId: string | null
  isActive: boolean
  editorSerializedState?: SerializedEditorState
  onEditorStateChange?: (editorState: EditorState) => void
  initialTitle?: string
  onTitleChange?: (title: string) => void
}) {
  const initialState = (() => {
    if (editorSerializedState == null) return undefined
    const sanitized = sanitizeSerializedState(editorSerializedState)
    if (sanitized == null) return undefined
    return JSON.stringify(sanitized)
  })()

  return (
    <div className="bg-background overflow-hidden">
      <LexicalComposer
        initialConfig={{
          ...editorConfig,
          ...(initialState != null ? { editorState: initialState } : {}),
        }}
      >
        <Plugins
          documentId={documentId}
          tabId={tabId}
          activeTabId={activeTabId}
          isActive={isActive}
          initialTitle={initialTitle}
          onTitleChange={onTitleChange}
        />

        <OnChangePlugin
          ignoreSelectionChange={true}
          onChange={(editorState: EditorState) => {
            onEditorStateChange?.(editorState)
          }}
        />
        {/* Hydration-save listener: fires onChange for editor.update calls
            tagged with 'lychee-save' (paired with 'history-merge' on async
            hydration mutations). This routes our hydration saves to the DB
            without disabling OnChangePlugin's default history-merge filter —
            which other plugins (TabSelectionPlugin, table resizer, image
            paste) rely on to NOT trigger spurious saves on their own
            history-merge updates. */}
        <HydrationSaveListener
          onChange={(editorState: EditorState) => {
            onEditorStateChange?.(editorState)
          }}
        />
      </LexicalComposer>
    </div>
  )
}
