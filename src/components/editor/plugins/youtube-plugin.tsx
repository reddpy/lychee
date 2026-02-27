import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type LexicalCommand,
} from "lexical"
import { $insertNodeToNearestRoot } from "@lexical/utils"
import { $createYouTubeNode } from "@/components/editor/nodes/youtube-node"

export const INSERT_YOUTUBE_COMMAND: LexicalCommand<string> = createCommand("INSERT_YOUTUBE")

export function YouTubePlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const removeInsertCommand = editor.registerCommand(
      INSERT_YOUTUBE_COMMAND,
      (videoId) => {
        const node = $createYouTubeNode(videoId)
        $insertNodeToNearestRoot(node)
        return true
      },
      COMMAND_PRIORITY_EDITOR,
    )

    return () => {
      removeInsertCommand()
    }
  }, [editor])

  return null
}
