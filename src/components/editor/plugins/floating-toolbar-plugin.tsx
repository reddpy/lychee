"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
  LexicalEditor,
} from "lexical";
import { $isLinkNode } from "@lexical/link";
import { mergeRegister } from "@lexical/utils";
import { OPEN_LINK_EDITOR_COMMAND } from "./link-editor-plugin";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function FloatingToolbar({ editor }: { editor: LexicalEditor }) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [isCode, setIsCode] = useState(false);
  const [isLink, setIsLink] = useState(false);

  const updateToolbar = useCallback(() => {
    const editorState = editor.getEditorState();

    let shouldShow = false;
    let bold = false;
    let italic = false;
    let underline = false;
    let strikethrough = false;
    let code = false;
    let link = false;
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

      // Check for link
      const nodes = selection.getNodes();
      link = nodes.some((node) => {
        const parent = node.getParent();
        return $isLinkNode(parent);
      });

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
      const toolbarWidth = 250;
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
    setPosition(pos);
    setIsVisible(shouldShow);
  }, [editor]);

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
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor, updateToolbar]);

  // Update toolbar position on scroll and hide/show based on visibility
  useEffect(() => {
    const handleScroll = () => {
      const nativeSelection = window.getSelection();
      if (!nativeSelection || nativeSelection.rangeCount === 0) {
        return;
      }

      // Check if there's actually a selection with content
      const selectionText = nativeSelection.toString();
      if (!selectionText || selectionText.length === 0) {
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
        // Update position and show
        const toolbarWidth = 250;
        const gap = 8; // Space between toolbar and selected text
        const left = rect.left + rect.width / 2 - toolbarWidth / 2;
        const top = rect.top - toolbarHeight - gap;

        setPosition({
          top: Math.max(top, tabBarHeight),
          left: Math.max(left, 10),
        });
        setIsVisible(true);
      }
    };

    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, []);

  const handleFormat = useCallback(
    (format: "bold" | "italic" | "underline" | "strikethrough" | "code") => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    },
    [editor],
  );

  const handleLink = useCallback(() => {
    editor.dispatchCommand(OPEN_LINK_EDITOR_COMMAND, undefined);
  }, [editor]);

  if (!isVisible) return null;

  return createPortal(
    <div
      className="fixed z-50 flex items-center gap-0.5 rounded-md border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => handleFormat("bold")}
            className={cn(
              "h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors",
              isBold
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-foreground",
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
                : "hover:bg-muted text-foreground",
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
                : "hover:bg-muted text-foreground",
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
                : "hover:bg-muted text-foreground",
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
                : "hover:bg-muted text-foreground",
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
                : "hover:bg-muted text-foreground",
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
    document.body,
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
