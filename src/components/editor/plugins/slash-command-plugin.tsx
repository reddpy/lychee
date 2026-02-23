"use client"

import { useCallback, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin"
import { TextNode, $getSelection, $isRangeSelection, $createParagraphNode } from "lexical"
import { $setBlocksType } from "@lexical/selection"
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text"
import { $createCodeNode } from "@lexical/code"
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode"
import {
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_CHECK_LIST_COMMAND,
} from "@lexical/list"
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Minus,
  Type,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { $isTitleNode } from "@/components/editor/nodes/title-node"
import { $insertNodes } from "lexical"

class SlashCommandOption extends MenuOption {
  title: string
  icon: React.ReactNode
  keywords: string[]
  onSelect: (editor: ReturnType<typeof useLexicalComposerContext>[0]) => void

  constructor(
    title: string,
    options: {
      icon: React.ReactNode
      keywords?: string[]
      onSelect: (editor: ReturnType<typeof useLexicalComposerContext>[0]) => void
    }
  ) {
    super(title)
    this.title = title
    this.icon = options.icon
    this.keywords = options.keywords ?? []
    this.onSelect = options.onSelect
  }
}

function SlashCommandMenuItem({
  isSelected,
  onClick,
  onMouseEnter,
  option,
}: {
  isSelected: boolean
  onClick: () => void
  onMouseEnter: () => void
  option: SlashCommandOption
}) {
  return (
    <div
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
        isSelected && "bg-accent text-accent-foreground"
      )}
      role="option"
      aria-selected={isSelected}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      ref={option.setRefElement}
    >
      {option.icon}
      <span>{option.title}</span>
    </div>
  )
}

function getBaseOptions(): SlashCommandOption[] {
  return [
    new SlashCommandOption("Text", {
      icon: <Type className="h-4 w-4" />,
      keywords: ["paragraph", "normal", "text"],
      onSelect: (editor) => {
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createParagraphNode())
          }
        })
      },
    }),
    new SlashCommandOption("Heading 1", {
      icon: <Heading1 className="h-4 w-4" />,
      keywords: ["h1", "heading", "title"],
      onSelect: (editor) => {
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createHeadingNode("h1"))
          }
        })
      },
    }),
    new SlashCommandOption("Heading 2", {
      icon: <Heading2 className="h-4 w-4" />,
      keywords: ["h2", "heading", "subtitle"],
      onSelect: (editor) => {
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createHeadingNode("h2"))
          }
        })
      },
    }),
    new SlashCommandOption("Heading 3", {
      icon: <Heading3 className="h-4 w-4" />,
      keywords: ["h3", "heading"],
      onSelect: (editor) => {
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createHeadingNode("h3"))
          }
        })
      },
    }),
    new SlashCommandOption("Bullet List", {
      icon: <List className="h-4 w-4" />,
      keywords: ["ul", "unordered", "bullet", "list"],
      onSelect: (editor) => {
        editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
      },
    }),
    new SlashCommandOption("Numbered List", {
      icon: <ListOrdered className="h-4 w-4" />,
      keywords: ["ol", "ordered", "numbered", "list"],
      onSelect: (editor) => {
        editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
      },
    }),
    new SlashCommandOption("Check List", {
      icon: <CheckSquare className="h-4 w-4" />,
      keywords: ["todo", "check", "checkbox", "task"],
      onSelect: (editor) => {
        editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)
      },
    }),
    new SlashCommandOption("Quote", {
      icon: <Quote className="h-4 w-4" />,
      keywords: ["blockquote", "quote"],
      onSelect: (editor) => {
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createQuoteNode())
          }
        })
      },
    }),
    new SlashCommandOption("Code Block", {
      icon: <Code className="h-4 w-4" />,
      keywords: ["code", "codeblock", "snippet"],
      onSelect: (editor) => {
        editor.update(() => {
          const node = $createCodeNode()
          $insertNodes([node])
        })
      },
    }),
    new SlashCommandOption("Divider", {
      icon: <Minus className="h-4 w-4" />,
      keywords: ["hr", "divider", "horizontal", "rule", "line"],
      onSelect: (editor) => {
        editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)
      },
    }),
  ]
}

export function SlashCommandPlugin() {
  const [editor] = useLexicalComposerContext()
  const [queryString, setQueryString] = useState<string | null>(null)

  const checkForSlashTrigger = useBasicTypeaheadTriggerMatch("/", {
    minLength: 0,
  })

  const checkForTriggerMatch = useCallback(
    (text: string, editorRef: ReturnType<typeof useLexicalComposerContext>[0]) => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        const anchorNode = selection.anchor.getNode()
        const topElement = anchorNode.getTopLevelElement()
        if (topElement && $isTitleNode(topElement)) {
          return null
        }
      }
      return checkForSlashTrigger(text, editorRef)
    },
    [checkForSlashTrigger]
  )

  const options = useMemo(() => {
    const baseOptions = getBaseOptions()
    if (!queryString) {
      return baseOptions
    }

    const regex = new RegExp(queryString, "i")
    return baseOptions.filter(
      (option) =>
        regex.test(option.title) ||
        option.keywords.some((keyword) => regex.test(keyword))
    )
  }, [queryString])

  const onSelectOption = useCallback(
    (
      selectedOption: SlashCommandOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void
    ) => {
      editor.update(() => {
        nodeToRemove?.remove()
      })
      closeMenu()
      selectedOption.onSelect(editor)
    },
    [editor]
  )

  return (
    <LexicalTypeaheadMenuPlugin<SlashCommandOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForTriggerMatch}
      options={options}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }
      ) =>
        anchorElementRef.current && options.length
          ? createPortal(
              <div className="fixed z-50 w-[200px] overflow-hidden rounded-md border border-[hsl(var(--border))] bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95">
                {options.map((option, i) => (
                  <SlashCommandMenuItem
                    key={option.key}
                    isSelected={selectedIndex === i}
                    onClick={() => {
                      setHighlightedIndex(i)
                      selectOptionAndCleanUp(option)
                    }}
                    onMouseEnter={() => {
                      setHighlightedIndex(i)
                    }}
                    option={option}
                  />
                ))}
              </div>,
              anchorElementRef.current
            )
          : null
      }
    />
  )
}
