"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { registerCodeHighlighting } from "@lexical/code"

// Import additional Prism languages not bundled with @lexical/code
// Note: Order matters - some languages depend on others
import "prismjs/components/prism-bash"
import "prismjs/components/prism-csharp"
import "prismjs/components/prism-dart"
import "prismjs/components/prism-diff"
import "prismjs/components/prism-docker"
import "prismjs/components/prism-elixir"
import "prismjs/components/prism-erlang"
import "prismjs/components/prism-go"
import "prismjs/components/prism-graphql"
import "prismjs/components/prism-groovy"
import "prismjs/components/prism-haskell"
import "prismjs/components/prism-json"
import "prismjs/components/prism-jsx"
import "prismjs/components/prism-tsx" // Must come after jsx
import "prismjs/components/prism-kotlin"
import "prismjs/components/prism-latex"
import "prismjs/components/prism-lua"
import "prismjs/components/prism-matlab"
import "prismjs/components/prism-nginx"
import "prismjs/components/prism-ocaml"
import "prismjs/components/prism-perl"
import "prismjs/components/prism-php"
import "prismjs/components/prism-r"
import "prismjs/components/prism-ruby"
import "prismjs/components/prism-sass"
import "prismjs/components/prism-scala"
import "prismjs/components/prism-scheme"
import "prismjs/components/prism-scss"
import "prismjs/components/prism-toml"
import "prismjs/components/prism-vim"
import "prismjs/components/prism-basic" // Required by vbnet
import "prismjs/components/prism-vbnet"
import "prismjs/components/prism-yaml"
import "prismjs/components/prism-zig"

export function CodeHighlightPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return registerCodeHighlighting(editor)
  }, [editor])

  return null
}
