import { JSX } from "react"
import { ContentEditable as LexicalContentEditable } from "@lexical/react/LexicalContentEditable"

type Props = {
  className?: string
}

export function ContentEditable({ className }: Props): JSX.Element {
  return (
    <LexicalContentEditable
      className={
        className ??
        `ContentEditable__root relative block min-h-72 min-h-full overflow-auto px-8 focus:outline-none font-normal`
      }
    />
  )
}
