"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
  LexicalEditor,
  $createParagraphNode,
} from "lexical";
import { $isLinkNode } from "@lexical/link";
import {
  $isHeadingNode,
  $createHeadingNode,
  $createQuoteNode,
  $isQuoteNode,
  HeadingTagType,
} from "@lexical/rich-text";
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_CHECK_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  ListNode,
} from "@lexical/list";
import { $isCodeNode, $createCodeNode } from "@lexical/code";
import { $setBlocksType } from "@lexical/selection";
import { mergeRegister, $getNearestNodeOfType } from "@lexical/utils";
import { OPEN_LINK_EDITOR_COMMAND } from "./link-editor-plugin";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link,
  ChevronDown,
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type BlockType =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "number"
  | "check"
  | "quote"
  | "code";

const BLOCK_TYPE_OPTIONS: {
  value: BlockType;
  label: string;
  icon: React.ElementType;
}[] = [
  { value: "paragraph", label: "Paragraph", icon: Type },
  { value: "h1", label: "Heading 1", icon: Heading1 },
  { value: "h2", label: "Heading 2", icon: Heading2 },
  { value: "h3", label: "Heading 3", icon: Heading3 },
  { value: "bullet", label: "Bullet List", icon: List },
  { value: "number", label: "Numbered List", icon: ListOrdered },
  { value: "check", label: "Checklist", icon: ListChecks },
  { value: "quote", label: "Quote", icon: Quote },
  { value: "code", label: "Code Block", icon: Code2 },
];

function BlockTypeSelector({
  editor,
  blockType,
}: {
  editor: LexicalEditor;
  blockType: BlockType;
}) {
  const [open, setOpen] = useState(false);

  const currentOption = BLOCK_TYPE_OPTIONS.find((o) => o.value === blockType);
  const CurrentIcon = currentOption?.icon || Type;

  const handleSelect = useCallback(
    (newType: BlockType) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        // Handle list transformations
        if (newType === "bullet") {
          if (blockType === "bullet") {
            editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
          } else {
            editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
          }
        } else if (newType === "number") {
          if (blockType === "number") {
            editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
          } else {
            editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
          }
        } else if (newType === "check") {
          if (blockType === "check") {
            editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
          } else {
            editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
          }
        } else {
          // First remove list if we're in one
          if (blockType === "bullet" || blockType === "number" || blockType === "check") {
            editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
          }

          // Then set the block type
          if (newType === "paragraph") {
            $setBlocksType(selection, () => $createParagraphNode());
          } else if (newType === "h1" || newType === "h2" || newType === "h3") {
            $setBlocksType(selection, () =>
              $createHeadingNode(newType as HeadingTagType)
            );
          } else if (newType === "quote") {
            $setBlocksType(selection, () => $createQuoteNode());
          } else if (newType === "code") {
            $setBlocksType(selection, () => $createCodeNode());
          }
        }
      });
      setOpen(false);
    },
    [editor, blockType]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-8 px-2 inline-flex items-center justify-center gap-1 rounded-md transition-colors hover:bg-muted text-foreground text-sm"
          aria-label="Change block type"
        >
          <CurrentIcon className="h-4 w-4" />
          <span className="max-w-20 truncate">{currentOption?.label}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start" sideOffset={8}>
        <div className="flex flex-col">
          {BLOCK_TYPE_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors text-left",
                  blockType === option.value
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted"
                )}
              >
                <Icon className="h-4 w-4" />
                {option.label}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FloatingToolbar({ editor }: { editor: LexicalEditor }) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [isCode, setIsCode] = useState(false);
  const [isLink, setIsLink] = useState(false);
  const [blockType, setBlockType] = useState<BlockType>("paragraph");
  const [isSingleBlock, setIsSingleBlock] = useState(true);
  const isMouseDownRef = useRef(false);

  const updateToolbar = useCallback(() => {
    const editorState = editor.getEditorState();

    let shouldShow = false;
    let bold = false;
    let italic = false;
    let underline = false;
    let strikethrough = false;
    let code = false;
    let link = false;
    let currentBlockType: BlockType = "paragraph";
    let singleBlock = true;
    let pos = { top: 0, left: 0 };

    editorState.read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        return;
      }

      const text = selection.getTextContent();
      if (!text || text.length === 0 || selection.isCollapsed()) {
        return;
      }

      // Update format states
      bold = selection.hasFormat("bold");
      italic = selection.hasFormat("italic");
      underline = selection.hasFormat("underline");
      strikethrough = selection.hasFormat("strikethrough");
      code = selection.hasFormat("code");

      // Check for link - only check anchor node's parent
      const anchorParent = selection.anchor.getNode().getParent();
      link = $isLinkNode(anchorParent);

      // Detect block type - simple check: anchor and focus in same block
      const anchorNode = selection.anchor.getNode();
      const focusNode = selection.focus.getNode();

      const anchorElement =
        anchorNode.getKey() === "root"
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();
      const focusElement =
        focusNode.getKey() === "root"
          ? focusNode
          : focusNode.getTopLevelElementOrThrow();

      // Simple: same block = show selector, different blocks = hide it
      singleBlock = anchorElement === focusElement;

      const element = anchorElement;

      if ($isHeadingNode(element)) {
        const tag = element.getTag();
        if (tag === "h1" || tag === "h2" || tag === "h3") {
          currentBlockType = tag;
        }
      } else if ($isListNode(element)) {
        const listType = element.getListType();
        if (listType === "bullet") {
          currentBlockType = "bullet";
        } else if (listType === "number") {
          currentBlockType = "number";
        } else if (listType === "check") {
          currentBlockType = "check";
        }
      } else if ($isQuoteNode(element)) {
        currentBlockType = "quote";
      } else if ($isCodeNode(element)) {
        currentBlockType = "code";
      } else {
        // Check if we're inside a list item
        const listNode = $getNearestNodeOfType(anchorNode, ListNode);
        if (listNode) {
          const listType = listNode.getListType();
          if (listType === "bullet") {
            currentBlockType = "bullet";
          } else if (listType === "number") {
            currentBlockType = "number";
          } else if (listType === "check") {
            currentBlockType = "check";
          }
        } else {
          currentBlockType = "paragraph";
        }
      }

      // Get position from native selection
      const nativeSelection = window.getSelection();
      if (!nativeSelection || nativeSelection.rangeCount === 0) {
        return;
      }

      const range = nativeSelection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      if (rect.width === 0 || rect.height === 0) {
        return;
      }

      // Position above the selection
      const toolbarWidth = 380;
      const toolbarHeight = 45;
      const gap = 8;
      const left = rect.left + rect.width / 2 - toolbarWidth / 2;
      const top = rect.top - toolbarHeight - gap;

      pos = {
        top: Math.max(top, 10),
        left: Math.max(left, 10),
      };
      shouldShow = true;
    });

    // Update state outside of read callback
    setIsBold(bold);
    setIsItalic(italic);
    setIsUnderline(underline);
    setIsStrikethrough(strikethrough);
    setIsCode(code);
    setIsLink(link);
    setBlockType(currentBlockType);
    setIsSingleBlock(singleBlock);
    setPosition(pos);

    // Only show toolbar when mouse is up and there's a selection
    if (shouldShow && !isMouseDownRef.current) {
      setIsVisible(true);
    } else if (!shouldShow) {
      setIsVisible(false);
    }
  }, [editor]);

  // Track mouse state to only show toolbar after mouseup (within editor only)
  useEffect(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    const handleMouseDown = () => {
      isMouseDownRef.current = true;
    };
    const handleMouseUp = () => {
      isMouseDownRef.current = false;
      updateToolbar();
    };

    rootElement.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      rootElement.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [editor, updateToolbar]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          updateToolbar();
        });
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateToolbar();
          return false;
        },
        COMMAND_PRIORITY_LOW
      )
    );
  }, [editor, updateToolbar]);

  // Update toolbar position on scroll
  useEffect(() => {
    const handleScroll = () => {
      if (!isVisible) return;

      const nativeSelection = window.getSelection();
      if (!nativeSelection || nativeSelection.rangeCount === 0) {
        return;
      }

      const range = nativeSelection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Hide if selected text exits the viewport
      const tabBarHeight = 120;
      const toolbarHeight = 45;
      const isAboveView = rect.bottom < tabBarHeight;
      const isBelowView = rect.top > window.innerHeight;

      if (isAboveView || isBelowView) {
        setIsVisible(false);
      } else {
        const toolbarWidth = 380;
        const gap = 8;
        const left = rect.left + rect.width / 2 - toolbarWidth / 2;
        const top = rect.top - toolbarHeight - gap;

        setPosition({
          top: Math.max(top, tabBarHeight),
          left: Math.max(left, 10),
        });
      }
    };

    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [isVisible]);

  const handleFormat = useCallback(
    (format: "bold" | "italic" | "underline" | "strikethrough" | "code") => {
      editor.focus();
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    },
    [editor]
  );

  const handleLink = useCallback(() => {
    editor.dispatchCommand(OPEN_LINK_EDITOR_COMMAND, undefined);
  }, [editor]);

  if (!isVisible) return null;

  return createPortal(
    <div
      className="floating-toolbar fixed z-50 flex items-center gap-0.5 rounded-md border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      {isSingleBlock && (
        <>
          <BlockTypeSelector editor={editor} blockType={blockType} />
          <div className="mx-1 h-6 w-px bg-border" />
        </>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => handleFormat("bold")}
            className={cn(
              "h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors",
              isBold
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-foreground"
            )}
            aria-label="Bold"
          >
            <Bold className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>
          Bold <kbd className="ml-1.5 opacity-60">⌘B</kbd>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => handleFormat("italic")}
            className={cn(
              "h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors",
              isItalic
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-foreground"
            )}
            aria-label="Italic"
          >
            <Italic className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>
          Italic <kbd className="ml-1.5 opacity-60">⌘I</kbd>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => handleFormat("underline")}
            className={cn(
              "h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors",
              isUnderline
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-foreground"
            )}
            aria-label="Underline"
          >
            <Underline className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>
          Underline <kbd className="ml-1.5 opacity-60">⌘U</kbd>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => handleFormat("strikethrough")}
            className={cn(
              "h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors",
              isStrikethrough
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-foreground"
            )}
            aria-label="Strikethrough"
          >
            <Strikethrough className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>
          Strikethrough <kbd className="ml-1.5 opacity-60">⌘⇧S</kbd>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => handleFormat("code")}
            className={cn(
              "h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors",
              isCode
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-foreground"
            )}
            aria-label="Inline code"
          >
            <Code className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>
          Inline code <kbd className="ml-1.5 opacity-60">⌘E</kbd>
        </TooltipContent>
      </Tooltip>

      <div className="mx-1 h-6 w-px bg-border" />

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleLink}
            className={cn(
              "h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors",
              isLink
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-foreground"
            )}
            aria-label="Link"
          >
            <Link className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>
          Link <kbd className="ml-1.5 opacity-60">⌘K</kbd>
        </TooltipContent>
      </Tooltip>
    </div>,
    document.body
  );
}

export function FloatingToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const [rootElement, setRootElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const updateRootElement = () => {
      setRootElement(editor.getRootElement());
    };
    updateRootElement();
    return editor.registerRootListener(updateRootElement);
  }, [editor]);

  if (!rootElement) return null;

  return <FloatingToolbar editor={editor} />;
}
