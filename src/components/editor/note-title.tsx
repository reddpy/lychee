import * as React from "react"
import { Check, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { NEW_NOTE_TITLE, sanitizeTitleInput, stripDisallowedTitleChars } from "@/shared/note-title"

export interface NoteTitleHandle {
  focus: () => void
  /** Replace the visible text (used to revert a rejected/duplicate title). */
  setText: (value: string) => void
  /** Commit the current draft if it changed (used on quit/tab-switch flush). */
  commit: () => void
}

/**
 * The note title, as a dedicated field rendered above the content.
 *
 * It is NOT part of the markdown body: the title lives in frontmatter, and the
 * filename is derived from it. It looks like an input field with confirm (✓) and
 * cancel (×) affordances:
 *   - ✓ / Enter / blur: commit the title (save + rename the file)
 *   - × / Escape: revert to the title as it was when editing began
 *
 * The element keeps the `editor-title` class so existing selectors keep working.
 */
export const NoteTitle = React.forwardRef<
  NoteTitleHandle,
  {
    value: string
    placeholder?: string
    /** True when the current draft collides with another note's title. */
    conflict?: boolean
    onChange: (value: string) => void
    /** Return false to reject the commit (e.g. duplicate title); the field
     *  keeps the draft instead of treating it as saved. */
    onCommit: (value: string) => boolean | void
    onEnter?: () => void
  }
>(function NoteTitle(
  { value, placeholder = NEW_NOTE_TITLE, conflict = false, onChange, onCommit, onEnter },
  ref,
) {
  const elRef = React.useRef<HTMLHeadingElement>(null)
  const composingRef = React.useRef(false)
  const errorId = React.useId()
  /** The title as it was when editing began, for ×/Escape revert. */
  const committedRef = React.useRef(value)
  const draftRef = React.useRef(value)
  const [draft, setDraft] = React.useState(value)
  const [focused, setFocused] = React.useState(false)

  // Sync external value into the DOM, but never while the user is editing (that
  // would fight the caret) or mid-IME composition.
  React.useEffect(() => {
    if (document.activeElement === elRef.current || composingRef.current) return
    committedRef.current = value
    draftRef.current = value
    setDraft(value)
    if (elRef.current && elRef.current.textContent !== value) {
      elRef.current.textContent = value
    }
  }, [value])

  React.useImperativeHandle(ref, () => ({
    focus: () => {
      const el = elRef.current
      if (!el) return
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    },
    setText: (next: string) => {
      committedRef.current = next
      draftRef.current = next
      setDraft(next)
      if (elRef.current && elRef.current.textContent !== next) {
        elRef.current.textContent = next
      }
    },
    commit: () => {
      if (conflict) return
      if (draftRef.current.trim() === committedRef.current.trim()) return
      if (onCommit(draftRef.current) === false) return
      committedRef.current = draftRef.current
    },
  }))

  const setDraftValue = (next: string) => {
    draftRef.current = next
    setDraft(next)
  }

  const handleInput = (event: React.FormEvent<HTMLHeadingElement>) => {
    if (composingRef.current) return
    // Leave the DOM exactly as the browser produced it. Rewriting textContent
    // here drops trailing spaces (contentEditable represents them as `&nbsp;`)
    // and jumps the caret — which made it look like spaces weren't allowed.
    // Only the value we hand upward is normalized.
    const value = sanitizeTitleInput(event.currentTarget.textContent ?? "")
    setDraftValue(value)
    onChange(value)
  }

  /** Returns true when the draft is saved/accepted (or already clean). */
  const commit = (): boolean => {
    if (conflict) return false
    if (draftRef.current.trim() === committedRef.current.trim()) return true
    if (onCommit(draftRef.current) === false) return false
    committedRef.current = draftRef.current
    return true
  }

  const revert = () => {
    const start = committedRef.current
    setDraftValue(start)
    if (elRef.current) elRef.current.textContent = start
    elRef.current?.blur()
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLHeadingElement>) => {
    event.preventDefault()
    const text = sanitizeTitleInput(event.clipboardData.getData("text/plain")).trim()
    document.execCommand("insertText", false, text)
  }

  const dirty = draft.trim() !== committedRef.current.trim()
  const showActions = dirty

  return (
    <div className="mb-6 px-8">
      <div
        onMouseDown={(event) => {
          const target = event.target as HTMLElement
          if (target === elRef.current || target.closest("button")) return
          event.preventDefault()
          elRef.current?.focus()
        }}
        className={cn(
          "-mx-2 flex w-fit max-w-full items-center gap-2 rounded-lg px-2 py-1 transition-colors",
          focused ? "bg-[hsl(var(--muted))]/40" : "hover:bg-[hsl(var(--muted))]/25",
        )}
      >
        <h1
          ref={elRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Note title"
          aria-invalid={conflict || undefined}
          aria-describedby={conflict ? errorId : undefined}
          spellCheck
          data-placeholder={placeholder}
          className={cn(
            "editor-title !mb-0 max-w-full cursor-text outline-none",
            draft.length === 0 ? "is-placeholder min-w-[8ch]" : "min-w-0",
          )}
          onFocus={() => {
            committedRef.current = value
            setFocused(true)
          }}
          onBlur={() => {
            setFocused(false)
            commit()
          }}
          onInput={handleInput}
          onKeyDown={(event) => {
            // Block disallowed characters before they're inserted, rather than
            // stripping them after the fact (which would move the caret).
            if (event.key.length === 1 && sanitizeTitleInput(event.key) !== event.key) {
              event.preventDefault()
              return
            }
            if (event.key === "Enter") {
              event.preventDefault()
              // On a rejected commit (e.g. duplicate title) keep focus and the
              // caret in the field so the user can fix it.
              if (commit()) onEnter?.()
              return
            }
            if (event.key === "Escape") {
              event.preventDefault()
              revert()
            }
          }}
          onPaste={handlePaste}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false
            // IME can insert characters that never hit keydown; clean those
            // while preserving whitespace, then record the normalized value.
            const el = event.currentTarget
            const raw = el.textContent ?? ""
            const cleaned = stripDisallowedTitleChars(raw)
            if (cleaned !== raw) el.textContent = cleaned
            handleInput(event as unknown as React.FormEvent<HTMLHeadingElement>)
          }}
        />
        <div
          className={cn(
            "shrink-0 items-center gap-0.5",
            showActions ? "flex" : "hidden",
          )}
        >
          <button
            type="button"
            aria-label="Save title"
            title={conflict ? "Title already in use" : "Save title"}
            disabled={conflict}
            onMouseDown={(event) => event.preventDefault()}
            onClick={commit}
            className="flex h-7 w-7 items-center justify-center rounded-md text-green-600 transition-colors hover:bg-green-500/10 hover:text-green-700 disabled:opacity-30 dark:text-green-400 dark:hover:bg-green-400/10 dark:hover:text-green-300"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Cancel title change"
            title="Cancel"
            onMouseDown={(event) => event.preventDefault()}
            onClick={revert}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--destructive))]/10 hover:text-[hsl(var(--destructive))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {conflict ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-[hsl(var(--destructive))]">
          A note with this title already exists.
        </p>
      ) : null}
    </div>
  )
})
