# E2E Test Failures Audit (GitHub Actions CI)

CI runs on `ubuntu-latest`. Key difference from local (Mac): **Meta key = Super/Windows key**, not Cmd. Undo/Select All use **Control** on Linux.

---

## 1. Code block: markdown shortcut creates code block

**Error:** `hasCode` is false — no code block node in saved content.

**Root cause analysis:**
- The ``` markdown shortcut does **not** fire reliably in headless E2E (Playwright/Electron). The text is typed as plain content; no CodeNode is created.
- Lexical's `CODE` transformer creates `CodeNode` (type `"code"`) when it runs, but it never runs in this environment.

**Verdict:** The ``` shortcut is unreliable in headless. The test was rewritten to use the slash command (`/` → Code Block) instead, which creates the same CodeNode and is reliable.

---

## 2. Bookmark: Embed content button not visible

**Error:** `button[title="Embed content"]` not visible after hovering link.

**Root cause:** Popover appears on hover. In CI (headless, xvfb):
- Hover might not trigger reliably
- Popover animation/timing could differ
- Link might re-render and detach the popover

**Verdict:** CI flakiness — hover-based popovers are unreliable in headless. The test already has 3 retries with 400ms hover + 3000ms visibility timeout.

**Recommendation:** Increase wait to 800ms hover and 8000ms visibility on final attempt. If still flaky, consider using `force: true` on click or a different approach (e.g. wait for popover to be attached before asserting).

---

## 3. Table: typing then clearing a cell leaves "temporar"

**Error:** Cell shows "temporar" instead of empty. "temporary" = 9 chars; "temporar" = 8 chars.

**Root cause:** Test uses `Meta+A` for Select All. On Linux (GitHub Actions), **Meta = Super key**, not Ctrl. Select All on Linux is **Ctrl+A**. So `Meta+A` does nothing useful — the Backspace only deletes one character.

**Verdict:** **Legitimate test bug** — wrong keyboard shortcut for the platform. Fix: use `process.platform === "darwin" ? "Meta" : "Control"` for Select All.

---

## 4–8. Table undo/redo tests (all fail)

**Errors:** Undo doesn't revert; redo doesn't re-apply; table not restored after undo. Row/column counts stay at 4 instead of reverting to 3.

**Root cause:** Test uses `Meta+Z` and `Meta+Shift+Z`. On Linux, **Undo = Ctrl+Z**, **Redo = Ctrl+Shift+Z**. `Meta+Z` on Linux invokes Super+Z, which does nothing for undo.

**Verdict:** **Legitimate test bug** — wrong keyboard shortcut for the platform. Fix: use `process.platform === "darwin" ? "Meta" : "Control"` for undo/redo.

---

## 9. Table: table content persists after switching — strict mode

**Error:** `locator('h1.editor-title')` resolved to 2 elements.

**Root cause:** When creating a second note and switching back, the DOM has two `main` elements (one per tab). Each has an `h1.editor-title`. The `h1.editor-title` selector matches both. The test calls `focusEditorBody` when on the second note — we need the second note's title, not the first.

**Verdict:** **Legitimate selector bug** — ambiguous when multiple notes exist. Fix: scope to `main.last()` when focusing the new note (or `main` that doesn't contain the table).

---

## 10. Table: pasting table with markdown link in cell

**Error:** `locator('a')` not found — expected `href="https://example.com/"`.

**Root cause:** The table markdown transformer (`table-markdown-transformer.ts`) does **not** parse markdown inside cells. It uses:
```ts
paragraph.append($createTextNode(headerCells[col] || ""))
```
So `[Click here](https://example.com)` is stored as **literal text**, not as a link element. The `<a>` is never created.

**Verdict:** **Test expectation is wrong** — the feature was never implemented. The test was written assuming links would be parsed in table cells. Fix: change the test to expect the raw markdown text, e.g. `toContainText("[Click here](https://example.com)")`.

---

## Summary

| # | Test | Verdict | Fix |
|---|------|---------|-----|
| 1 | Code block | ``` shortcut unreliable in headless | Use slash command instead |
| 2 | Bookmark embed | CI flakiness | Increase timeouts |
| 3 | Typing then clearing | **Test bug** | Use Control on Linux for Select All |
| 4–8 | Undo/redo | **Test bug** | Use Control on Linux for undo/redo |
| 9 | Switch notes | **Test bug** | Scope selector to main.last() |
| 10 | Markdown link in table | **Test bug** | Expect raw text, not link |

**Fixes 3, 4–8, 9, 10 are legitimate** — they correct real test bugs (wrong platform shortcuts, ambiguous selector, wrong expectation). Fixes 1 and 2 are CI hardening — may help but don't address root cause if the code is broken.
