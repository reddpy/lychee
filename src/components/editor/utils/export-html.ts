import { LexicalEditor } from "lexical"
import { $generateHtmlFromNodes } from "@lexical/html"

/**
 * Export editor content to HTML string
 */
export function exportToHtml(editor: LexicalEditor): string {
  let html = ""
  editor.getEditorState().read(() => {
    html = $generateHtmlFromNodes(editor)
  })
  return html
}

/**
 * Export editor content to HTML with embedded styles
 */
export function exportToStyledHtml(editor: LexicalEditor): string {
  const html = exportToHtml(editor)

  const styles = `
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        line-height: 1.6;
        max-width: 800px;
        margin: 0 auto;
        padding: 2rem;
        color: #333;
      }
      h1 { font-size: 2.5rem; font-weight: 800; margin-top: 2rem; }
      h2 { font-size: 2rem; font-weight: 700; margin-top: 1.5rem; border-bottom: 1px solid #eee; padding-bottom: 0.5rem; }
      h3 { font-size: 1.5rem; font-weight: 600; margin-top: 1.25rem; }
      p { margin: 1rem 0; }
      blockquote { border-left: 3px solid #ddd; padding-left: 1rem; margin-left: 0; font-style: italic; color: #666; }
      ul, ol { padding-left: 2rem; }
      li { margin: 0.5rem 0; }
      code { background: #f4f4f4; padding: 0.2rem 0.4rem; border-radius: 3px; font-size: 0.9em; }
      pre { background: #f4f4f4; padding: 1rem; border-radius: 8px; overflow-x: auto; }
      pre code { background: none; padding: 0; }
      a { color: #0066cc; text-decoration: none; }
      a:hover { text-decoration: underline; }
      hr { border: none; border-top: 2px solid #eee; margin: 2rem 0; }
    </style>
  `

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Exported Document</title>
  ${styles}
</head>
<body>
  ${html}
</body>
</html>`
}
