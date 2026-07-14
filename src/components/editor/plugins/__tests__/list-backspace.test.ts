// @vitest-environment happy-dom
/**
 * Issue #222 — Backspace at the start of a list item should convert it to a
 * paragraph in place (Notion-style), not merge it up into the previous item.
 *
 * These tests exercise the pure node transformation (`$convertListItemToParagraph`),
 * which is what the KEY_DOWN backspace handler in keyboard-shortcuts-plugin runs.
 */
import { describe, it, expect } from "vitest"
import { createHeadlessEditor } from "@lexical/headless"
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  $isParagraphNode,
  $isTextNode,
} from "lexical"
import {
  ListNode,
  ListItemNode,
  $createListNode,
  $createListItemNode,
  $isListNode,
} from "@lexical/list"
import { LinkNode, $createLinkNode, $isLinkNode } from "@lexical/link"
import {
  TableNode,
  TableRowNode,
  TableCellNode,
  $createTableNode,
  $createTableRowNode,
  $createTableCellNode,
  $isTableCellNode,
  TableCellHeaderStates,
} from "@lexical/table"
import {
  $convertListItemToParagraph,
  $isCaretAtListItemStart,
} from "../list-backspace"
import { $insertMatchingChecklistItemBefore } from "../list-enter"

function makeEditor() {
  return createHeadlessEditor({
    namespace: "list-backspace-test",
    nodes: [
      ListNode,
      ListItemNode,
      LinkNode,
      TableNode,
      TableRowNode,
      TableCellNode,
    ],
    onError: (e) => {
      throw e
    },
  })
}

/** Render the root as a compact string, e.g. `LIST[A,B] | P("C")`. */
function snapshot(): string {
  return $getRoot()
    .getChildren()
    .map((child) => {
      if ($isListNode(child)) {
        const list = child as ListNode
        const items = list
          .getChildren()
          .map((li) => li.getTextContent())
          .join(",")
        return `${list.getListType().toUpperCase()}[${items}]`
      }
      if ($isParagraphNode(child)) return `P("${child.getTextContent()}")`
      return child.getType()
    })
    .join(" | ")
}

function buildList(
  type: "bullet" | "number",
  texts: string[]
): void {
  const root = $getRoot()
  root.clear()
  const list = $createListNode(type)
  for (const t of texts) {
    const li = $createListItemNode()
    li.append($createTextNode(t))
    list.append(li)
  }
  root.append(list)
}

/** Convert the item at `index` of the (single) top-level list. */
function convertItem(editor: ReturnType<typeof makeEditor>, index: number) {
  editor.update(
    () => {
      const list = $getRoot().getFirstChild() as ListNode
      const item = list.getChildren()[index] as ListItemNode
      $convertListItemToParagraph(item)
    },
    { discrete: true }
  )
}

function read(editor: ReturnType<typeof makeEditor>): string {
  let out = ""
  editor.read(() => {
    out = snapshot()
  })
  return out
}

/** Node types of the root's direct children (e.g. ["table"], ["list","paragraph"]). */
function $getRootChildTypes(editor: ReturnType<typeof makeEditor>): string[] {
  let types: string[] = []
  editor.read(() => {
    types = $getRoot()
      .getChildren()
      .map((c) => c.getType())
  })
  return types
}

describe("$convertListItemToParagraph (#222)", () => {
  it("first item → paragraph above the rest, stays in place", () => {
    const editor = makeEditor()
    editor.update(() => buildList("bullet", ["A", "B", "C"]), { discrete: true })
    convertItem(editor, 0)
    expect(read(editor)).toBe('P("A") | BULLET[B,C]')
  })

  it("middle item → splits the list, paragraph in the middle (no jump up)", () => {
    const editor = makeEditor()
    editor.update(() => buildList("bullet", ["A", "B", "C"]), { discrete: true })
    convertItem(editor, 1)
    expect(read(editor)).toBe('BULLET[A] | P("B") | BULLET[C]')
  })

  it("last item → paragraph below the list", () => {
    const editor = makeEditor()
    editor.update(() => buildList("bullet", ["A", "B", "C"]), { discrete: true })
    convertItem(editor, 2)
    expect(read(editor)).toBe('BULLET[A,B] | P("C")')
  })

  it("only item → list disappears, becomes a lone paragraph", () => {
    const editor = makeEditor()
    editor.update(() => buildList("bullet", ["A"]), { discrete: true })
    convertItem(editor, 0)
    expect(read(editor)).toBe('P("A")')
  })

  it("ordered list: continuation keeps numbering via start value", () => {
    const editor = makeEditor()
    editor.update(() => buildList("number", ["one", "two", "three"]), {
      discrete: true,
    })
    convertItem(editor, 1)

    let startOfContinuation = -1
    editor.read(() => {
      const lists = $getRoot()
        .getChildren()
        .filter($isListNode) as ListNode[]
      // Second list is the continuation holding "three".
      startOfContinuation = lists[1].getStart()
    })
    expect(read(editor)).toBe('NUMBER[one] | P("two") | NUMBER[three]')
    // "three" was the 3rd item, so the continuation list starts at 3.
    expect(startOfContinuation).toBe(3)
  })

  it("preserves all inline children of the item, in order", () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const list = $createListNode("bullet")
        const item = $createListItemNode()
        // Distinct-format nodes so Lexical's text normalization can't merge them.
        const bold = $createTextNode("foo ")
        bold.setFormat("bold")
        item.append(bold, $createTextNode("bar "))
        const italic = $createTextNode("baz")
        italic.setFormat("italic")
        item.append(italic)
        list.append(item)
        root.append(list)
      },
      { discrete: true }
    )

    let formats: string[] = []
    editor.update(
      () => {
        const list = $getRoot().getFirstChild() as ListNode
        const item = list.getChildren()[0] as ListItemNode
        const p = $convertListItemToParagraph(item)
        formats = p!.getChildren().map((c) => {
          if ($isTextNode(c) && c.hasFormat("bold")) return "bold"
          if ($isTextNode(c) && c.hasFormat("italic")) return "italic"
          return "plain"
        })
      },
      { discrete: true }
    )

    expect(read(editor)).toBe('P("foo bar baz")')
    // All three distinctly-formatted runs survive, in order.
    expect(formats).toEqual(["bold", "plain", "italic"])
  })

  it("declines nested/indented items (returns null, leaves tree unchanged)", () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const outer = $createListNode("bullet")
        const top = $createListItemNode()
        top.append($createTextNode("A"))
        // Nested list lives inside a wrapper list item.
        const wrapper = $createListItemNode()
        const inner = $createListNode("bullet")
        const nested = $createListItemNode()
        nested.append($createTextNode("A1"))
        inner.append(nested)
        wrapper.append(inner)
        outer.append(top, wrapper)
        root.append(outer)
      },
      { discrete: true }
    )

    let result: unknown = "unset"
    editor.update(
      () => {
        const outer = $getRoot().getFirstChild() as ListNode
        const wrapper = outer.getChildren()[1] as ListItemNode
        const inner = wrapper.getChildren()[0] as ListNode
        const nested = inner.getChildren()[0] as ListItemNode
        result = $convertListItemToParagraph(nested)
      },
      { discrete: true }
    )
    expect(result).toBeNull()
  })

  it("declines a wrapper item that itself contains a nested list", () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const outer = $createListNode("bullet")
        const top = $createListItemNode()
        top.append($createTextNode("A"))
        const wrapper = $createListItemNode()
        const inner = $createListNode("bullet")
        const nested = $createListItemNode()
        nested.append($createTextNode("A1"))
        inner.append(nested)
        wrapper.append(inner)
        outer.append(top, wrapper)
        root.append(outer)
      },
      { discrete: true }
    )

    let result: unknown = "unset"
    editor.update(
      () => {
        const outer = $getRoot().getFirstChild() as ListNode
        const wrapper = outer.getChildren()[1] as ListItemNode
        result = $convertListItemToParagraph(wrapper)
      },
      { discrete: true }
    )
    // Wrapper's only child is a ListNode → not plain text → declined.
    expect(result).toBeNull()
  })

  // --- Edge cases ---

  it("empty list item → becomes an empty paragraph", () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const list = $createListNode("bullet")
        list.append($createListItemNode()) // no children at all
        root.append(list)
      },
      { discrete: true }
    )

    let isParagraph = false
    editor.update(
      () => {
        const list = $getRoot().getFirstChild() as ListNode
        const item = list.getChildren()[0] as ListItemNode
        const p = $convertListItemToParagraph(item)
        isParagraph = p !== null && $isParagraphNode(p)
      },
      { discrete: true }
    )
    expect(isParagraph).toBe(true)
    expect(read(editor)).toBe('P("")')
  })

  it("empty middle item → splits cleanly with an empty paragraph between", () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const list = $createListNode("bullet")
        const a = $createListItemNode()
        a.append($createTextNode("A"))
        const empty = $createListItemNode() // middle, empty
        const c = $createListItemNode()
        c.append($createTextNode("C"))
        list.append(a, empty, c)
        root.append(list)
      },
      { discrete: true }
    )
    convertItem(editor, 1)
    expect(read(editor)).toBe('BULLET[A] | P("") | BULLET[C]')
  })

  it("preserves sibling blocks around the list", () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const intro = $createParagraphNode()
        intro.append($createTextNode("intro"))
        const list = $createListNode("bullet")
        for (const t of ["A", "B"]) {
          const li = $createListItemNode()
          li.append($createTextNode(t))
          list.append(li)
        }
        const outro = $createParagraphNode()
        outro.append($createTextNode("outro"))
        root.append(intro, list, outro)
      },
      { discrete: true }
    )
    editor.update(
      () => {
        // The list is the 2nd root child here, not the 1st.
        const list = $getRoot().getChildren()[1] as ListNode
        $convertListItemToParagraph(list.getChildren()[0] as ListItemNode)
      },
      { discrete: true }
    )
    expect(read(editor)).toBe(
      'P("intro") | P("A") | BULLET[B] | P("outro")'
    )
  })

  it("preserves an inline link child (not declined, content moved)", () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const list = $createListNode("bullet")
        const item = $createListItemNode()
        item.append($createTextNode("see "))
        const link = $createLinkNode("https://example.com")
        link.append($createTextNode("here"))
        item.append(link)
        list.append(item)
        root.append(list)
      },
      { discrete: true }
    )

    let linkSurvived = false
    let linkUrl = ""
    editor.update(
      () => {
        const list = $getRoot().getFirstChild() as ListNode
        const item = list.getChildren()[0] as ListItemNode
        const p = $convertListItemToParagraph(item)
        const link = p?.getChildren().find($isLinkNode)
        linkSurvived = link !== undefined
        if ($isLinkNode(link)) linkUrl = link.getURL()
      },
      { discrete: true }
    )
    expect(linkSurvived).toBe(true)
    expect(linkUrl).toBe("https://example.com")
    expect(read(editor)).toBe('P("see here")')
  })

  it("checklist: continuation keeps check type and per-item checked state", () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const list = $createListNode("check")
        const a = $createListItemNode().setChecked(true)
        a.append($createTextNode("A"))
        const b = $createListItemNode().setChecked(false)
        b.append($createTextNode("B"))
        const c = $createListItemNode().setChecked(true)
        c.append($createTextNode("C"))
        list.append(a, b, c)
        root.append(list)
      },
      { discrete: true }
    )
    convertItem(editor, 1) // convert B

    let continuationType = ""
    let cChecked: boolean | undefined
    editor.read(() => {
      const lists = $getRoot().getChildren().filter($isListNode) as ListNode[]
      const continuation = lists[1]
      continuationType = continuation.getListType()
      cChecked = (continuation.getChildren()[0] as ListItemNode).getChecked()
    })
    expect(read(editor)).toBe('CHECK[A] | P("B") | CHECK[C]')
    expect(continuationType).toBe("check")
    expect(cChecked).toBe(true) // C was checked, still checked after the move
  })

  // --- Guard: $isCaretAtListItemStart ---

  it("guard is false when offset > 0", () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const list = $createListNode("bullet")
        const item = $createListItemNode()
        item.append($createTextNode("hello"))
        list.append(item)
        root.append(list)
      },
      { discrete: true }
    )
    let atStart = true
    editor.read(() => {
      const list = $getRoot().getFirstChild() as ListNode
      const item = list.getChildren()[0] as ListItemNode
      const text = item.getFirstChild()!
      atStart = $isCaretAtListItemStart(item, text, 3) // caret mid-word
    })
    expect(atStart).toBe(false)
  })

  it("guard is false when the anchor is a later inline node (text precedes it)", () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const list = $createListNode("bullet")
        const item = $createListItemNode()
        const first = $createTextNode("a")
        first.setFormat("bold")
        const second = $createTextNode("b")
        item.append(first, second)
        list.append(item)
        root.append(list)
      },
      { discrete: true }
    )
    let atStart = true
    editor.read(() => {
      const list = $getRoot().getFirstChild() as ListNode
      const item = list.getChildren()[0] as ListItemNode
      const second = item.getChildren()[1] // has a previous sibling
      atStart = $isCaretAtListItemStart(item, second, 0)
    })
    expect(atStart).toBe(false)
  })

  it("guard is true for an empty item (anchor is the item element itself)", () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const list = $createListNode("bullet")
        list.append($createListItemNode())
        root.append(list)
      },
      { discrete: true }
    )
    let atStart = false
    editor.read(() => {
      const list = $getRoot().getFirstChild() as ListNode
      const item = list.getChildren()[0] as ListItemNode
      atStart = $isCaretAtListItemStart(item, item, 0)
    })
    expect(atStart).toBe(true)
  })

  // --- Inside a table cell ---

  type ListKind = "bullet" | "number" | "check"

  function $makeList(kind: ListKind, items: string[]): ListNode {
    const list = $createListNode(kind)
    for (const t of items) {
      const li = $createListItemNode()
      li.append($createTextNode(t))
      list.append(li)
    }
    return list
  }

  /** Build a single-cell table whose cell holds a list of the given kind. */
  function buildTableWithList(
    editor: ReturnType<typeof makeEditor>,
    items: string[],
    kind: ListKind = "bullet"
  ): void {
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const table = $createTableNode()
        const row = $createTableRowNode()
        const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
        cell.append($makeList(kind, items))
        row.append(cell)
        table.append(row)
        root.append(table)
      },
      { discrete: true }
    )
  }

  /** All table cells in document order (call inside a read/update). */
  function $allCells(): TableCellNode[] {
    const cells: TableCellNode[] = []
    const walk = (node: { getChildren?: () => unknown[] }): void => {
      for (const child of node.getChildren?.() ?? []) {
        if ($isTableCellNode(child as never)) cells.push(child as TableCellNode)
        else walk(child as { getChildren?: () => unknown[] })
      }
    }
    walk($getRoot())
    return cells
  }

  function cellToString(cell: TableCellNode): string {
    return cell
      .getChildren()
      .map((c) => {
        if ($isListNode(c)) {
          const label = (c as ListNode).getListType().toUpperCase()
          return `${label}[${(c as ListNode)
            .getChildren()
            .map((li) => li.getTextContent())
            .join(",")}]`
        }
        if ($isParagraphNode(c)) return `P("${c.getTextContent()}")`
        return c.getType()
      })
      .join(" | ")
  }

  /** Structure strings for every cell, in document order. */
  function cellStrings(editor: ReturnType<typeof makeEditor>): string[] {
    let out: string[] = []
    editor.read(() => {
      out = $allCells().map(cellToString)
    })
    return out
  }

  /** Structure of the first cell (most tests use a single-cell table). */
  function cellStructure(editor: ReturnType<typeof makeEditor>): string {
    return cellStrings(editor)[0] ?? "(no cell)"
  }

  /** The first list inside the index-th cell (call inside a read/update). */
  function $cellListAt(index: number): ListNode {
    const cell = $allCells()[index]
    return cell.getChildren().find($isListNode) as ListNode
  }

  function firstCellList(): ListNode {
    return $cellListAt(0)
  }

  it("table cell: middle item converts in place, staying inside the cell", () => {
    const editor = makeEditor()
    buildTableWithList(editor, ["A", "B", "C"])
    expect(cellStructure(editor)).toBe("BULLET[A,B,C]")

    let returned: unknown = "unset"
    editor.update(
      () => {
        const list = firstCellList()
        returned = $convertListItemToParagraph(list.getChildren()[1] as ListItemNode)
      },
      { discrete: true }
    )

    expect(returned).not.toBeNull() // it handled the cell-level list
    // The split lives entirely within the cell — nothing escaped to the root.
    expect(cellStructure(editor)).toBe('BULLET[A] | P("B") | BULLET[C]')
    expect($getRootChildTypes(editor)).toEqual(["table"])
  })

  it("table cell: only item converts, list removed, paragraph stays in the cell", () => {
    const editor = makeEditor()
    buildTableWithList(editor, ["solo"])
    editor.update(
      () => {
        const list = firstCellList()
        $convertListItemToParagraph(list.getChildren()[0] as ListItemNode)
      },
      { discrete: true }
    )
    expect(cellStructure(editor)).toBe('P("solo")')
    expect($getRootChildTypes(editor)).toEqual(["table"])
  })

  it("table cell: first item converts, list continues below it", () => {
    const editor = makeEditor()
    buildTableWithList(editor, ["A", "B", "C"])
    editor.update(
      () => $convertListItemToParagraph(firstCellList().getChildren()[0] as ListItemNode),
      { discrete: true }
    )
    expect(cellStructure(editor)).toBe('P("A") | BULLET[B,C]')
    expect($getRootChildTypes(editor)).toEqual(["table"])
  })

  it("table cell: last item converts below the list", () => {
    const editor = makeEditor()
    buildTableWithList(editor, ["A", "B", "C"])
    editor.update(
      () => $convertListItemToParagraph(firstCellList().getChildren()[2] as ListItemNode),
      { discrete: true }
    )
    expect(cellStructure(editor)).toBe('BULLET[A,B] | P("C")')
  })

  it("table cell: empty middle item becomes an empty paragraph", () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const table = $createTableNode()
        const row = $createTableRowNode()
        const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
        const list = $createListNode("bullet")
        const a = $createListItemNode()
        a.append($createTextNode("A"))
        const empty = $createListItemNode() // middle, empty
        const c = $createListItemNode()
        c.append($createTextNode("C"))
        list.append(a, empty, c)
        cell.append(list)
        row.append(cell)
        table.append(row)
        root.append(table)
      },
      { discrete: true }
    )
    editor.update(
      () => $convertListItemToParagraph(firstCellList().getChildren()[1] as ListItemNode),
      { discrete: true }
    )
    expect(cellStructure(editor)).toBe('BULLET[A] | P("") | BULLET[C]')
  })

  it("table cell: ordered list keeps numbering across the split", () => {
    const editor = makeEditor()
    buildTableWithList(editor, ["one", "two", "three"], "number")
    editor.update(
      () => $convertListItemToParagraph(firstCellList().getChildren()[1] as ListItemNode),
      { discrete: true }
    )
    expect(cellStructure(editor)).toBe('NUMBER[one] | P("two") | NUMBER[three]')

    let start = -1
    editor.read(() => {
      const cell = $allCells()[0]
      const lists = cell.getChildren().filter($isListNode) as ListNode[]
      start = lists[1].getStart()
    })
    expect(start).toBe(3)
  })

  it("table cell: checklist continuation stays a checklist with checked state", () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const table = $createTableNode()
        const row = $createTableRowNode()
        const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
        const list = $createListNode("check")
        const a = $createListItemNode().setChecked(true)
        a.append($createTextNode("A"))
        const b = $createListItemNode().setChecked(false)
        b.append($createTextNode("B"))
        const c = $createListItemNode().setChecked(true)
        c.append($createTextNode("C"))
        list.append(a, b, c)
        cell.append(list)
        row.append(cell)
        table.append(row)
        root.append(table)
      },
      { discrete: true }
    )
    editor.update(
      () => $convertListItemToParagraph(firstCellList().getChildren()[1] as ListItemNode),
      { discrete: true }
    )
    expect(cellStructure(editor)).toBe('CHECK[A] | P("B") | CHECK[C]')

    let continuationType = ""
    let cChecked: boolean | undefined
    editor.read(() => {
      const lists = $allCells()[0].getChildren().filter($isListNode) as ListNode[]
      continuationType = lists[1].getListType()
      cChecked = (lists[1].getChildren()[0] as ListItemNode).getChecked()
    })
    expect(continuationType).toBe("check")
    expect(cChecked).toBe(true)
  })

  it("table cell: a leading paragraph in the cell is preserved and ordered", () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const table = $createTableNode()
        const row = $createTableRowNode()
        const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
        const header = $createParagraphNode()
        header.append($createTextNode("hdr"))
        cell.append(header, $makeList("bullet", ["A", "B"]))
        row.append(cell)
        table.append(row)
        root.append(table)
      },
      { discrete: true }
    )
    editor.update(
      () => $convertListItemToParagraph(firstCellList().getChildren()[0] as ListItemNode),
      { discrete: true }
    )
    // Leading paragraph stays first; converted item lands where the list was.
    expect(cellStructure(editor)).toBe('P("hdr") | P("A") | BULLET[B]')
  })

  it("table cell: converting in one cell leaves another cell's list untouched", () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const table = $createTableNode()
        const row = $createTableRowNode()
        const cell1 = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
        cell1.append($makeList("bullet", ["A", "B", "C"]))
        const cell2 = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
        cell2.append($makeList("bullet", ["X", "Y", "Z"]))
        row.append(cell1, cell2)
        table.append(row)
        root.append(table)
      },
      { discrete: true }
    )
    editor.update(
      () => $convertListItemToParagraph($cellListAt(0).getChildren()[1] as ListItemNode),
      { discrete: true }
    )
    const strings = cellStrings(editor)
    expect(strings[0]).toBe('BULLET[A] | P("B") | BULLET[C]') // converted
    expect(strings[1]).toBe('BULLET[X,Y,Z]') // untouched
  })

  it("table cell: nested item is still declined (defensive)", () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const table = $createTableNode()
        const row = $createTableRowNode()
        const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
        const outer = $createListNode("bullet")
        const top = $createListItemNode()
        top.append($createTextNode("A"))
        const wrapper = $createListItemNode()
        const inner = $createListNode("bullet")
        const nested = $createListItemNode()
        nested.append($createTextNode("A1"))
        inner.append(nested)
        wrapper.append(inner)
        outer.append(top, wrapper)
        cell.append(outer)
        row.append(cell)
        table.append(row)
        root.append(table)
      },
      { discrete: true }
    )
    let result: unknown = "unset"
    editor.update(
      () => {
        const outer = $cellListAt(0)
        const wrapper = outer.getChildren()[1] as ListItemNode
        const inner = wrapper.getChildren()[0] as ListNode
        const nested = inner.getChildren()[0] as ListItemNode
        result = $convertListItemToParagraph(nested)
      },
      { discrete: true }
    )
    expect(result).toBeNull()
  })

  // --- Stress / scalability ---

  it("scales: splitting a 3000-item list near the top preserves order & counts", () => {
    const editor = makeEditor()
    const N = 3000
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const list = $createListNode("number")
        for (let i = 0; i < N; i++) {
          const li = $createListItemNode()
          li.append($createTextNode(`i${i}`))
          list.append(li)
        }
        root.append(list)
      },
      { discrete: true }
    )

    editor.update(
      () => {
        const list = $getRoot().getFirstChild() as ListNode
        // Convert item index 1 → worst case: ~N items move to the continuation.
        $convertListItemToParagraph(list.getChildren()[1] as ListItemNode)
      },
      { discrete: true }
    )

    let headCount = -1
    let paragraphText = ""
    let contCount = -1
    let contFirst = ""
    let contLast = ""
    editor.read(() => {
      const children = $getRoot().getChildren()
      const head = children[0] as ListNode
      const para = children[1]
      const cont = children[2] as ListNode
      headCount = head.getChildrenSize()
      paragraphText = para.getTextContent()
      const items = cont.getChildren()
      contCount = items.length
      contFirst = items[0].getTextContent()
      contLast = items[items.length - 1].getTextContent()
    })

    expect(headCount).toBe(1) // only i0 stays
    expect(paragraphText).toBe("i1") // converted item
    expect(contCount).toBe(N - 2) // i2 .. i2999
    expect(contFirst).toBe("i2")
    expect(contLast).toBe(`i${N - 1}`)
  })
})

describe("$insertMatchingChecklistItemBefore (#240)", () => {
  it("inserts a matching checked item above a checked item", () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const list = $createListNode("check")
        const completed = $createListItemNode().setChecked(true)
        completed.append($createTextNode("Done"))
        list.append(completed)
        root.append(list)
      },
      { discrete: true }
    )

    let states: Array<boolean | undefined> = []
    editor.update(
      () => {
        const list = $getRoot().getFirstChild() as ListNode
        const completed = list.getFirstChild() as ListItemNode
        $insertMatchingChecklistItemBefore(completed)
        states = list
          .getChildren()
          .map((item) => (item as ListItemNode).getChecked())
      },
      { discrete: true }
    )

    expect(read(editor)).toBe('CHECK[,Done]')
    expect(states).toEqual([true, true])
  })

  it("declines unchecked and non-checklist items", () => {
    const editor = makeEditor()
    editor.update(() => buildList("bullet", ["A"]), { discrete: true })

    let result: unknown = "unset"
    editor.update(
      () => {
        const list = $getRoot().getFirstChild() as ListNode
        result = $insertMatchingChecklistItemBefore(
          list.getFirstChild() as ListItemNode
        )
      },
      { discrete: true }
    )

    expect(result).toBeNull()
    expect(read(editor)).toBe('BULLET[A]')
  })
})
