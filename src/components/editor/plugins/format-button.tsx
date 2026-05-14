"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type TextFormat =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "code"
  | "highlight";

export interface FormatButtonProps {
  /** The text format to toggle */
  format: TextFormat;
  /** Whether the format is currently active on the selection */
  active: boolean;
  /** Icon component to render (from lucide-react) */
  icon: ReactNode;
  /** Human-readable label for tooltip and aria-label */
  label: string;
  /** Optional keyboard shortcut hint displayed in tooltip */
  shortcut?: string;
  /** Format handler — dispatches FORMAT_TEXT_COMMAND */
  onClick: (format: TextFormat) => void;
}

export function FormatButton({
  format,
  active,
  icon,
  label,
  shortcut,
  onClick,
}: FormatButtonProps) {
  const btnClass = cn(
    "h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors",
    active
      ? "bg-primary text-primary-foreground"
      : "hover:bg-muted text-foreground",
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onClick(format)}
          className={btnClass}
          aria-label={label}
          aria-pressed={active}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={8}>
        {label}
        {shortcut && (
          <kbd className="ml-1.5 opacity-60">{shortcut}</kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
