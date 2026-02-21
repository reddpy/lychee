## Lychee 🍋

**Natural notes, without the enterprise bloat.**

Lychee is a small, local‑first notes app. It borrows the good parts of early Notion (fast, clean, rich‑text editing) and deliberately skips the "all‑in‑one workspace" bloat. It's meant to feel like a personal notebook again. 📝

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

## What's in the box 📦

- **Block editor** — Notion‑style rich text powered by Lexical (headings, lists, checkboxes, quotes, code blocks, images, horizontal rules)
- **Slash commands** — type `/` to insert any block type
- **Floating toolbar** — right‑click selected text to format (bold, italic, code, links, block type)
- **Drag‑and‑drop blocks** — grab the handle to reorder any block
- **Images** — paste or drop images directly into a note, with resize handles and alignment controls
- **Nested notes** — organize pages up to 5 levels deep in the sidebar
- **Tabs** — open multiple notes side by side
- **Emoji icons** — give each note a custom icon
- **Trash & restore** — soft‑delete with easy recovery
- **Keyboard shortcuts** — undo/redo, formatting, navigation
- **SQLite storage** — everything stays on your machine, no cloud

---

## Rough map of the code 🗺️

```
src/
├── main/               Electron main process, SQLite, IPC handlers
├── renderer/           App shell, Zustand store, tabs
├── components/
│   ├── editor/         Lexical editor (nodes, plugins, themes)
│   ├── sidebar/        Note tree, emoji picker, trash bin
│   └── ui/             Shared UI primitives (Radix‑based)
├── shared/             Types shared between main & renderer
└── preload.ts          Bridge (window.lychee.invoke / on)
```

Lychee is still evolving, but the philosophy is stable: stay small, local, and pleasant to write in. 🌱
