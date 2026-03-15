import { Bookmark } from "lucide-react"
import { useToggleBookmark } from "@/renderer/use-toggle-bookmark"

export function BookmarkButton({ documentId }: { documentId: string }) {
  const { isBookmarked, toggleBookmark } = useToggleBookmark(documentId)

  return (
    <button
      type="button"
      onClick={toggleBookmark}
      aria-label={isBookmarked ? "Remove bookmark" : "Bookmark this note"}
      className={`flex h-8 w-8 items-center justify-center cursor-pointer rounded-full border border-transparent bg-transparent transition-all duration-200 select-none ${
        isBookmarked
          ? "text-[#C14B55] hover:bg-[#C14B55]/15 hover:border-[#C14B55]/30"
          : "text-[hsl(var(--muted-foreground))]/65 hover:bg-[#C14B55]/15 hover:text-[#C14B55] hover:border-[#C14B55]/30"
      }`}
    >
      <Bookmark
        className="h-3.5 w-3.5 transition-all duration-200"
        fill={isBookmarked ? "currentColor" : "none"}
      />
    </button>
  )
}
