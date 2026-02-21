"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
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
import { $isCodeNode, $createCodeNode } from "@lexical/code";
import { $setBlocksType } from "@lexical/selection";
import { OPEN_LINK_EDITOR_COMMAND } from "./link-editor-plugin";
import { $isTitleNode } from "@/components/editor/nodes/title-node";
import {
  $isListItemNode,
  $createListItemNode,
} from "@/components/editor/nodes/list-item-node";
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

        if (newType === "paragraph") {
          $setBlocksType(selection, () => $createParagraphNode());
        } else if (newType === "h1" || newType === "h2" || newType === "h3") {
          $setBlocksType(selection, () =>
            $createHeadingNode(newType as HeadingTagType)
          );
        } else if (newType === "bullet") {
          $setBlocksType(selection, () => $createListItemNode("bullet"));
        } else if (newType === "number") {
          $setBlocksType(selection, () => $createListItemNode("number"));
        } else if (newType === "check") {
          $setBlocksType(selection, () => $createListItemNode("check"));
        } else if (newType === "quote") {
          $setBlocksType(selection, () => $createQuoteNode());
        } else if (newType === "code") {
          $setBlocksType(selection, () => $createCodeNode());
        }
      });
      setOpen(false);
    },
    [editor]
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

interface ToolbarState {
  isVisible: boolean;
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
  isStrikethrough: boolean;
  isCode: boolean;
  isLink: boolean;
  blockType: BlockType;
  isSingleBlock: boolean;
}

const HIDDEN_STATE: ToolbarState = {
  isVisible: false,
  isBold: false,
  isItalic: false,
  isUnderline: false,
  isStrikethrough: false,
  isCode: false,
  isLink: false,
  blockType: "paragraph",
  isSingleBlock: true,
};

const TOOLBAR_WIDTH = 380;
const TOOLBAR_HEIGHT = 45;
const TOOLBAR_GAP = 8;
const TAB_BAR_HEIGHT = 120;

function FloatingToolbar({ editor }: { editor: LexicalEditor }) {
  const [state, setState] = useState<ToolbarState>(HIDDEN_STATE);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const scrollHiddenRef = useRef(false);
  const visibleRef = useRef(false);
  const pendingContextMenuRef = useRef(false);

  // Keep ref in sync so scroll handler has current value without re-subscribing
  visibleRef.current = state.isVisible;

  // Read current selection state — returns null if no valid selection
  const readSelectionState = useCallback((): Omit<ToolbarState, "isVisible"> | null => {
    let result: Omit<ToolbarState, "isVisible"> | null = null;

    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) return;

      const text = selection.getTextContent();
      if (!text || text.length === 0) return;

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

      let blockType: BlockType = "paragraph";
      if ($isHeadingNode(anchorElement)) {
        const tag = anchorElement.getTag();
        if (tag === "h1" || tag === "h2" || tag === "h3") blockType = tag;
      } else if ($isListItemNode(anchorElement)) {
        blockType = anchorElement.getListType();
      } else if ($isQuoteNode(anchorElement)) {
        blockType = "quote";
      } else if ($isCodeNode(anchorElement)) {
        blockType = "code";
      }

      result = {
        isBold: selection.hasFormat("bold"),
        isItalic: selection.hasFormat("italic"),
        isUnderline: selection.hasFormat("underline"),
        isStrikethrough: selection.hasFormat("strikethrough"),
        isCode: selection.hasFormat("code"),
        isLink: $isLinkNode(anchorNode.getParent()),
        blockType,
        isSingleBlock: anchorElement === focusElement && !$isTitleNode(anchorElement),
      };
    });

    return result;
  }, [editor]);

  // Position toolbar above the current native selection rect
  const positionToolbar = useCallback((minTop?: number) => {
    const nativeSelection = window.getSelection();
    if (!nativeSelection || nativeSelection.rangeCount === 0) return;
    const rect = nativeSelection.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    if (toolbarRef.current) {
      const left = Math.max(rect.left + rect.width / 2 - TOOLBAR_WIDTH / 2, 10);
      const top = Math.max(rect.top - TOOLBAR_HEIGHT - TOOLBAR_GAP, minTop ?? 10);
      toolbarRef.current.style.top = `${top}px`;
      toolbarRef.current.style.left = `${left}px`;
    }
  }, []);

  // Right-click shows toolbar; mousedown hides it; editor updates refresh format state
  useEffect(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    const handleContextMenu = (e: MouseEvent) => {
      const selState = readSelectionState();
      if (selState) {
        // Selection already exists — show toolbar immediately
        e.preventDefault();
        setState({ ...selState, isVisible: true });
        requestAnimationFrame(() => positionToolbar());
      } else {
        // No Lexical selection yet — the browser will word-select on right-click,
        // but Lexical hasn't synced it. Set a flag so the update listener picks it up.
        pendingContextMenuRef.current = true;
      }
    };

    const handleMouseDown = () => {
      scrollHiddenRef.current = false;
      setState(HIDDEN_STATE);
    };

    rootElement.addEventListener("contextmenu", handleContextMenu);
    rootElement.addEventListener("mousedown", handleMouseDown);
    return () => {
      rootElement.removeEventListener("contextmenu", handleContextMenu);
      rootElement.removeEventListener("mousedown", handleMouseDown);
    };
  }, [editor, readSelectionState, positionToolbar]);

  // Update format states when editor changes (only while toolbar is visible)
  // Also handles deferred context menu: when right-click fires before Lexical
  // syncs the browser's word-selection, pendingContextMenuRef is set and we
  // show the toolbar on the next update cycle once Lexical has the selection.
  useEffect(() => {
    return editor.registerUpdateListener(() => {
      const pending = pendingContextMenuRef.current;
      if (!visibleRef.current && !scrollHiddenRef.current && !pending) return;

      const selState = readSelectionState();
      if (!selState) {
        if (!pending) {
          scrollHiddenRef.current = false;
          setState(HIDDEN_STATE);
        }
        return;
      }

      if (pending) {
        pendingContextMenuRef.current = false;
        setState({ ...selState, isVisible: true });
        requestAnimationFrame(() => positionToolbar());
        return;
      }

      setState((prev) => {
        if (!prev.isVisible) return prev;
        return { ...selState, isVisible: true };
      });
      positionToolbar();
    });
  }, [editor, readSelectionState, positionToolbar]);

  // Scroll: hide when selection leaves viewport, re-show when it returns
  useEffect(() => {
    const handleScroll = () => {
      if (!visibleRef.current && !scrollHiddenRef.current) return;

      const nativeSelection = window.getSelection();
      if (!nativeSelection || nativeSelection.rangeCount === 0) return;

      const rect = nativeSelection.getRangeAt(0).getBoundingClientRect();
      const outOfView = rect.bottom < TAB_BAR_HEIGHT || rect.top > window.innerHeight;

      if (!toolbarRef.current) return;

      if (outOfView) {
        toolbarRef.current.style.visibility = "hidden";
        scrollHiddenRef.current = true;
      } else {
        if (scrollHiddenRef.current) {
          toolbarRef.current.style.visibility = "visible";
          scrollHiddenRef.current = false;
        }
        const left = Math.max(rect.left + rect.width / 2 - TOOLBAR_WIDTH / 2, 10);
        const top = Math.max(rect.top - TOOLBAR_HEIGHT - TOOLBAR_GAP, TAB_BAR_HEIGHT);
        toolbarRef.current.style.top = `${top}px`;
        toolbarRef.current.style.left = `${left}px`;
      }
    };

    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, []);

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

  if (!state.isVisible) return null;

  const btnClass = (active: boolean) =>
    cn(
      "h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "hover:bg-muted text-foreground"
    );

  return createPortal(
    <div
      ref={toolbarRef}
      className="floating-toolbar fixed z-50 flex items-center gap-0.5 rounded-md border border-[hsl(var(--border))] bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
    >
      {state.isSingleBlock && (
        <>
          <BlockTypeSelector editor={editor} blockType={state.blockType} />
          <div className="mx-1 h-6 w-px bg-border" />
        </>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={() => handleFormat("bold")} className={btnClass(state.isBold)} aria-label="Bold">
            <Bold className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>Bold <kbd className="ml-1.5 opacity-60">⌘B</kbd></TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={() => handleFormat("italic")} className={btnClass(state.isItalic)} aria-label="Italic">
            <Italic className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>Italic <kbd className="ml-1.5 opacity-60">⌘I</kbd></TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={() => handleFormat("underline")} className={btnClass(state.isUnderline)} aria-label="Underline">
            <Underline className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>Underline <kbd className="ml-1.5 opacity-60">⌘U</kbd></TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={() => handleFormat("strikethrough")} className={btnClass(state.isStrikethrough)} aria-label="Strikethrough">
            <Strikethrough className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>Strikethrough <kbd className="ml-1.5 opacity-60">⌘⇧S</kbd></TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={() => handleFormat("code")} className={btnClass(state.isCode)} aria-label="Inline code">
            <Code className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>Inline code <kbd className="ml-1.5 opacity-60">⌘E</kbd></TooltipContent>
      </Tooltip>

      <div className="mx-1 h-6 w-px bg-border" />

      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={handleLink} className={btnClass(state.isLink)} aria-label="Link">
            <Link className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>Link <kbd className="ml-1.5 opacity-60">⌘K</kbd></TooltipContent>
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
