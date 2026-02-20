import type { ElementTransformer } from "@lexical/markdown"
import {
  $createListItemNode,
  $isListItemNode,
  ListItemNode,
} from "@/components/editor/nodes/list-item-node"

const LIST_INDENT_SIZE = 4

function getIndent(whitespaces: string): number {
  const tabs = whitespaces.match(/\t/g)
  const spaces = whitespaces.match(/ /g)
  let indent = 0
  if (tabs) indent += tabs.length
  if (spaces) indent += Math.floor(spaces.length / LIST_INDENT_SIZE)
  return indent
}

export const FLAT_BULLET_LIST: ElementTransformer = {
  dependencies: [ListItemNode],
  export: (node, exportChildren) => {
    if (!$isListItemNode(node) || node.getListType() !== "bullet") return null
    const indent = "    ".repeat(node.getIndent())
    return `${indent}- ${exportChildren(node)}`
  },
  regExp: /^(\s*)[-*+]\s/,
  replace: (parentNode, children, match, isImport) => {
    const node = $createListItemNode("bullet")
    const indent = getIndent(match[1] || "")
    if (indent > 0) node.setIndent(indent)
    node.append(...children)
    parentNode.replace(node)
    if (!isImport) node.select(0, 0)
  },
  type: "element",
}

export const FLAT_ORDERED_LIST: ElementTransformer = {
  dependencies: [ListItemNode],
  export: (node, exportChildren) => {
    if (!$isListItemNode(node) || node.getListType() !== "number") return null
    const indent = "    ".repeat(node.getIndent())
    return `${indent}1. ${exportChildren(node)}`
  },
  regExp: /^(\s*)(\d{1,})\.\s/,
  replace: (parentNode, children, match, isImport) => {
    const node = $createListItemNode("number")
    const indent = getIndent(match[1] || "")
    if (indent > 0) node.setIndent(indent)
    node.append(...children)
    parentNode.replace(node)
    if (!isImport) node.select(0, 0)
  },
  type: "element",
}

export const FLAT_CHECK_LIST: ElementTransformer = {
  dependencies: [ListItemNode],
  export: (node, exportChildren) => {
    if (!$isListItemNode(node) || node.getListType() !== "check") return null
    const indent = "    ".repeat(node.getIndent())
    const checkbox = node.getChecked() ? "[x]" : "[ ]"
    return `${indent}- ${checkbox} ${exportChildren(node)}`
  },
  regExp: /^(\s*)(?:[-*+]\s)?\s?(\[(\s|x)?\])\s/i,
  replace: (parentNode, children, match, isImport) => {
    const checked = match[3] === "x"
    const node = $createListItemNode("check", checked)
    const indent = getIndent(match[1] || "")
    if (indent > 0) node.setIndent(indent)
    node.append(...children)
    parentNode.replace(node)
    if (!isImport) node.select(0, 0)
  },
  type: "element",
}
