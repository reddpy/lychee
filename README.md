## Lychee 🍋

**Natural notes, without the enterprise bloat.**

Lychee is a small, local‑first notes app. It borrows the good parts of early Notion (fast, clean, rich‑text editing) and deliberately skips the “all‑in‑one workspace” bloat. It’s meant to feel like a personal notebook again. 📝

---

If you miss when tools like Notion felt fast and uncomplicated, Lychee is an attempt to get that feeling back in a focused desktop app. ✨

---

## Getting started 🚀

```bash
pnpm install
pnpm start
```

That runs the Electron + Webpack dev pipeline with hot reload for the renderer.

---

## Rough map of the code 🗺️

- `src/renderer/App.tsx` – app shell (sidebar, tabs, editor area)
- `src/components/lexical-editor.tsx` – emoji header + Lexical editor
- `src/components/blocks/editor-x/` – Lexical setup and plugins
- `src/main/` – Electron main process and SQLite wiring
- `src/shared/` – shared types (documents, IPC contracts)

Lychee is still evolving, but the philosophy is stable: stay small, local, and pleasant to write in. 🌱

