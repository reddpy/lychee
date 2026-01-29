"use client"

import { ContentEditable as LexicalContentEditable } from "@lexical/react/LexicalContentEditable"
import { cn } from "@/lib/utils"

export function ContentEditable({
  className,
  placeholderClassName,
  placeholder,
}: {
  className?: string
  placeholderClassName?: string
  placeholder?: string
}) {
  return (
    <div className={cn("relative", className)}>
      <LexicalContentEditable className="min-h-[200px] outline-none" />
      {placeholder && (
        <div
          className={cn(
            "pointer-events-none absolute left-0 top-0 select-none overflow-hidden text-ellipsis text-muted-foreground",
            placeholderClassName
          )}
          aria-hidden
        >
          {placeholder}
        </div>
      )}
    </div>
  )
}
