# Markdown shortcut audit (#223)

Systematic pass over every live markdown-to-rich-text shortcut. Companion to
[markdown-consistency-findings.md](./markdown-consistency-findings.md): that doc
covers **document export/import** (`$convertToMarkdownString` /
`$convertFromMarkdownString`); this one covers **live typing**
(`registerMarkdownShortcuts`, i.e. `MarkdownShortcutPlugin`).

Method: a headless editor registers all app nodes + `MARKDOWN_TRANSFORMERS` +
`registerMarkdownShortcuts`, types the shortcut character-by-character through
Lexical's real selection API, and inspects the resulting node tree. Locked in as
`src/components/editor/__tests__/markdown-shortcuts.test.ts` (12 tests).

## Result matrix

| Shortcut | Trigger | Before | After |
|---|---|---|---|
| `#`, `##`, `###` … | space | ✅ heading h1–h3 | ✅ |
| `>` | space | ✅ quote | ✅ |
| `-`, `*`, `+` | space | ✅ bullet list | ✅ |
| `1.` | space | ✅ numbered list | ✅ |
| `[ ]` / `[x]` | space | ✅ check list | ✅ |
| `- [ ]` / `- [x]` (`*`/`+` too) | space | ❌ bullet list with literal `[ ]` text | ✅ **fixed** |
| `---` / `***` / `___` | space | ❌ literal text, no rule | ✅ **fixed** |
| `` `code` `` | closing backtick | ✅ inline code | ✅ |
| ```` ``` ```` | Enter | ✅ code block | ✅ |
| ```` ```js ```` | Enter | ✅ code block + language | ✅ |
| `**bold**` | closing `**` | ✅ bold | ✅ |
| `*italic*` | closing `*` | ✅ italic | ✅ |
| `~~strike~~` | closing `~~` | ✅ strikethrough | ✅ |
| `==highlight==` | closing `==` | ✅ highlight | ✅ |
| `[text](url)` | closing `)` | ✅ link | ✅ |

Not covered here: `***bold italic***`, `___bold italic___`, `__bold__`, `_italic_`
(underscore variants) — same code path as the star variants; add if a regression
is suspected.

## Fixes

### 1. Horizontal rule had no transformer (`---` did nothing)

`@lexical/markdown` 0.44 exports no HR transformer. Lexical only ships one inside
the React `MarkdownShortcutPlugin`'s `DEFAULT_TRANSFORMERS`, which we override by
passing an explicit list. `HorizontalRulePlugin` only handles the slash-command
insert, not typing.

`horizontal-rule-markdown-transformer.ts` now mirrors the upstream definition:
- `regExp: /^(---|\*\*\*|___)\s?$/` — the optional trailing space is what lets the
  live shortcut fire (`runElementTransformers` triggers on a space and tests the
  match against `"--- "`).
- exports `***` (canonical; avoids YAML frontmatter and setext-heading
  ambiguity), imports all three forms.
- leaves an empty paragraph after the rule so typing can continue.

### 2. `- [ ]` checklist never formed

`UNORDERED_LIST` fires on `- ` before the user types `[`, so by the time `[ ] `
exists it is inside a list item. Lexical's element transformers only run at the
document root, and `registerCheckList` (from `@lexical/list`) handles only
click/keyboard toggling — there is no `- [ ]` markdown path. Reordering
`CHECK_LIST` before `UNORDERED_LIST` does not help (verified).

`checklist-shortcut-plugin.tsx` adds a `TextNode` node transform: a bullet list
item whose first text starts with `[ ] ` / `[x] ` is upgraded to a `check` list
with the marker stripped and the checked state set. The transform is guarded to
an active collapsed selection on that node so merely opening a note does not
silently rewrite stored content.

## Notes

- **Trigger convention.** Literals convert on the trailing **space** (`# `, `- `,
  `--- `, `> `), matching Lexical. A bare `---` + Enter does not convert to a
  rule (only multiline transformers run on Enter). This matches upstream and the
  other block shortcuts, so it is documented rather than special-cased.
- **`[ ]` without a bullet** always worked via the built-in `CHECK_LIST`; the fix
  brings the more common `- [ ]` form to parity.
