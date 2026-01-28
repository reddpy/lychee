# Notion-Style Desktop App – Project Overview & Architecture

**Project Name (working):** [Your App Name – e.g. "Nexlify", "LocalNotion", "Inkwell", etc.]  
**Goal:** Build a fast, local-first, Notion-like note-taking & knowledge base app for desktop.  
**Target Platforms:** macOS, Windows, Linux (via Electron)  
**Core Philosophy:** Local-first, offline-first, excellent keyboard UX, zero server dependency initially. Future: optional self-hosted sync.

## Current Date & Status
- Started planning: ~January 2026  
- Current phase: Early architecture & MVP scaffolding  
- MVP Goal: Multi-tab document editing with auto-save, document list, basic sidebar navigation, keyboard shortcuts, search (FTS), exports (MD/HTML/PDF)

## Tech Stack (Locked In)

| Layer              | Technology                          | Why / Notes                                                                 |
|--------------------|-------------------------------------|-----------------------------------------------------------------------------|
| Desktop Shell      | Electron (latest stable)            | Cross-platform desktop, web tech, good perf in 2025+ versions              |
| Frontend Framework | React 18+ (with TypeScript)         | Component model, ecosystem, hooks                                           |
| Rich Text Editor   | Lexical (@lexical/react)            | Modern, extensible, great for block-based editing like Notion              |
| Local Database     | SQLite + better-sqlite3             | Fast, embedded, zero-config, synchronous API in main process               |
| State Management   | Zustand                             | Lightweight, simple, great for both global + per-document state            |
| Drag & Drop        | @dnd-kit                            | Modern, accessible, flexible for sidebar, block, & tab reordering          |
| Styling            | Tailwind CSS + shadcn/ui            | Rapid UI, consistent primitives, customizable                               |
| IPC Communication  | Electron built-in ipcMain/ipcRenderer with **typed contracts** | Security + maintainability; no ad-hoc strings                              |
| Keyboard Shortcuts | @react-hotkeys-hook (app-level) + Lexical commands (editor-level) | Global + contextual shortcuts essential for Notion feel                    |
| Search             | SQLite FTS5 (full-text search)      | Native, fast, no extra deps; index updated on save                         |
| Exports            | @lexical/markdown + @lexical/html + jsPDF | Local conversion & file save; Markdown/HTML client-side, PDF in main      |
| UUIDs              | uuid (v4)                           | Simple document IDs                                                        |
| Utilities          | lodash (debounce, etc.)             | Common helpers                                                             |

**Not using (yet / intentionally avoided):**
- Redux / Context for everything → too heavy
- Yjs / CRDTs → defer until real-time collab needed
- tRPC over IPC → overkill for v1
- Puppeteer for PDF → optional if jsPDF insufficient
- Sentry / advanced error reporting → basic file logging first

## Key Architectural Decisions (Important!)

1. **Local-first architecture**  
   - Everything stored in SQLite on disk  
   - No cloud by default → future optional self-hosted sync (e.g. via custom server or Syncthing-like)

2. **Typed IPC Contract** (critical – do not use raw channel strings)  
   - Defined in `src/shared/ipc-types.ts`  
   - Renderer → main: use typed `invoke<K extends keyof IPC>(channel, payload)` helper  
   - Main → renderer: use `ipcMain.handle()` with exact types

3. **Document Model**  
   ```ts
   interface Document {
     id: string;               // UUID
     title: string;
     content: string;          // JSON.stringify(editor.getEditorState().toJSON())
     createdAt: string;        // ISO
     updatedAt: string;        // ISO
   }