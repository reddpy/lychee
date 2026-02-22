"use client"

import { InitialConfigType, LexicalComposer } from "@lexical/react/LexicalComposer"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { EditorState, SerializedEditorState } from "lexical"

import { editorTheme } from "@/components/editor/themes/editor-theme"
import { nodes } from "@/components/editor/nodes"
import { Plugins } from "@/components/editor/plugins"

const editorConfig: InitialConfigType = {
  namespace: "Editor",
  theme: editorTheme,
  nodes,
  onError: (error: Error) => {
    console.error(error)
  },
}

/**
 * Flatten a single old-format listitem node into one or more flat list-item nodes.
 * Old format: { type: "listitem", children: [...textNodes, possibleNestedList], checked?: boolean }
 * A listitem's children may include a nested "list" node at the end (for sub-items).
 */
function flattenListItem(
  item: any,
  indent: number,
  listType: string
): any[] {
  const result: any[] = []

  // Separate inline children from nested list children
  const inlineChildren: any[] = []
  const nestedLists: any[] = []

  for (const child of item.children || []) {
    if (child.type === "list") {
      nestedLists.push(child)
    } else {
      inlineChildren.push(child)
    }
  }

  // Create the flat list-item for this node
  result.push({
    type: "list-item",
    listType,
    checked: item.checked ?? false,
    indent,
    direction: item.direction ?? null,
    format: item.format ?? "",
    version: 1,
    children: inlineChildren,
  })

  // Recursively flatten any nested lists at indent + 1
  for (const nested of nestedLists) {
    const nestedType = nested.listType || listType
    for (const nestedItem of nested.children || []) {
      result.push(...flattenListItem(nestedItem, indent + 1, nestedType))
    }
  }

  return result
}

/**
 * Migrate children: remove legacy nodes and flatten old nested list structures
 * into flat list-item nodes.
 */
function migrateChildren(children: any[]): any[] {
  const result: any[] = []

  for (const child of children) {
    // Filter out legacy nodes
    if (child.type === "code-snippet" || child.type === "executable-code-block") {
      continue
    }

    if (child.type === "list") {
      // Flatten: promote list items to root level as flat list-item nodes
      const listType = child.listType || "bullet"
      for (const listItem of child.children || []) {
        result.push(...flattenListItem(listItem, 0, listType))
      }
    } else {
      // Non-list nodes: recurse into children (for nested structures)
      if (child.children && Array.isArray(child.children)) {
        result.push({ ...child, children: migrateChildren(child.children) })
      } else {
        result.push(child)
      }
    }
  }

  return result
}

// Sanitize the serialized state to handle empty states and legacy nodes
function sanitizeSerializedState(
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
  editorSerializedState,
  onEditorStateChange,
  initialTitle,
  onTitleChange,
}: {
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
        <Plugins initialTitle={initialTitle} onTitleChange={onTitleChange} />

        <OnChangePlugin
          ignoreSelectionChange={true}
          onChange={(editorState: EditorState) => {
            onEditorStateChange?.(editorState)
          }}
        />
      </LexicalComposer>
    </div>
  )
}
