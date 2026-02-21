import { randomUUID } from "crypto";

// ── helpers ──────────────────────────────────────────────────

const text = (t, format = 0) => ({
  detail: 0,
  format,
  mode: "normal",
  style: "",
  text: t,
  type: "text",
  version: 1,
});

const block = (type, children, extra = {}) => ({
  children,
  direction: null,
  format: "",
  indent: 0,
  type,
  version: 1,
  ...extra,
});

const title = (t) => block("title", [text(t)]);
const p = (t, fmt) =>
  block("paragraph", t ? [text(t, fmt)] : [], {
    textFormat: 0,
    textStyle: "",
  });
const h = (tag, t) => block("heading", [text(t)], { tag });
const quote = (t) => block("quote", [text(t)]);
const bullet = (t, indent = 0) =>
  block("list-item", [text(t)], { listType: "bullet", checked: false, indent });
const numbered = (t, indent = 0) =>
  block("list-item", [text(t)], { listType: "number", checked: false, indent });
const check = (t, checked = false, indent = 0) =>
  block("list-item", [text(t)], { listType: "check", checked, indent });
const hr = () => ({ type: "horizontalrule", version: 1 });
const codeblock = (code, lang = "") =>
  block("code", [text(code)], { language: lang });

const doc = (...children) =>
  JSON.stringify({
    root: {
      children,
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  });

const now = new Date();
const ts = (daysAgo = 0, hoursAgo = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(d.getHours() - hoursAgo);
  return d.toISOString();
};

// ── notes ────────────────────────────────────────────────────

const notes = [];

const id = () => randomUUID();

const insert = (
  noteId,
  noteTitle,
  content,
  { emoji = null, parentId = null, sortOrder = 0, daysAgo = 0, hoursAgo = 0 } = {}
) => {
  notes.push({
    id: noteId,
    title: noteTitle,
    content,
    emoji,
    parentId,
    sortOrder,
    createdAt: ts(daysAgo + 2, hoursAgo),
    updatedAt: ts(daysAgo, hoursAgo),
  });
  return noteId;
};

// ── Root notes ───────────────────────────────────────────────

// 1. Product Roadmap
insert(
  id(),
  "Product Roadmap",
  doc(
    title("Product Roadmap"),
    p("High-level priorities for the next quarter. Updated weekly."),
    p(""),
    h("h2", "Launch Checklist"),
    check("Editor — rich text, slash commands, drag & drop", true),
    check("Sidebar — nested pages, emoji icons, search", true),
    check("Tabs — open multiple notes side by side", true),
    check("Image embeds with resize handles", true),
    check("Keyboard shortcuts & accessibility", false),
    check("Export to Markdown", false),
    check("Publish to web (static)", false),
    p(""),
    h("h2", "Stretch Goals"),
    bullet("Collaborative editing (CRDT)"),
    bullet("Mobile companion app"),
    bullet("Plugin system for custom blocks"),
    bullet("Version history & snapshots"),
  ),
  { emoji: "🗺️", sortOrder: 0, daysAgo: 1 }
);

// 2. Meeting Notes (parent)
const meetingId = insert(
  id(),
  "Meeting Notes",
  doc(
    title("Meeting Notes"),
    p("Running archive of team syncs and 1:1s."),
  ),
  { emoji: "📋", sortOrder: 1, daysAgo: 0, hoursAgo: 2 }
);

insert(
  id(),
  "Kickoff — Feb 3",
  doc(
    title("Kickoff — Feb 3"),
    p("Attendees: KJ, Ava, Marcus, Priya"),
    p(""),
    h("h2", "Agenda"),
    numbered("Define MVP scope"),
    numbered("Assign workstreams"),
    numbered("Set weekly cadence"),
    p(""),
    h("h2", "Decisions"),
    bullet("Ship editor-first — sidebar and tabs can follow"),
    bullet("SQLite for storage, no server until v2"),
    bullet("Weekly demo every Friday 3 PM"),
    p(""),
    quote("\"Keep it simple. If Notion 2019 wouldn't have it, we don't need it yet.\" — KJ"),
  ),
  { parentId: meetingId, sortOrder: 0, daysAgo: 18 }
);

insert(
  id(),
  "Sprint Review — Feb 10",
  doc(
    title("Sprint Review — Feb 10"),
    h("h2", "What shipped"),
    check("Block editor with 8 node types", true),
    check("Slash command menu", true),
    check("Drag handles on every block", true),
    p(""),
    h("h2", "What's next"),
    bullet("Image paste & resize"),
    bullet("Nested pages in sidebar"),
    bullet("Emoji picker for note icons"),
  ),
  { parentId: meetingId, sortOrder: 1, daysAgo: 11 }
);

insert(
  id(),
  "Retro — Feb 14",
  doc(
    title("Retro — Feb 14"),
    h("h2", "Went well"),
    bullet("Editor feels fast — no lag on 500-line notes"),
    bullet("SQLite is rock solid for local-first"),
    bullet("Lexical's plugin architecture is clean"),
    p(""),
    h("h2", "Could improve"),
    bullet("Need better keyboard shortcut discoverability"),
    bullet("Drag & drop is touchy near list items"),
    p(""),
    h("h2", "Action items"),
    check("Add shortcut cheat sheet (Cmd+/)", false),
    check("Fix drag handle z-index inside lists", true),
  ),
  { parentId: meetingId, sortOrder: 2, daysAgo: 7 }
);

// 3. Design System
insert(
  id(),
  "Design System",
  doc(
    title("Design System"),
    p("Tokens, components, and conventions for the Lychee UI."),
    p(""),
    h("h2", "Colors"),
    bullet("Background — #FFFFFF / #1A1A1A"),
    bullet("Text — #2D2926 / #F0EDEB"),
    bullet("Accent — #C14B55 (lychee red)"),
    bullet("Leaf green — #6B8F5E"),
    bullet("Borders — rgba(0,0,0,0.08)"),
    p(""),
    h("h2", "Typography"),
    bullet("Body — Inter, 15px/1.65"),
    bullet("Headings — Inter Semibold"),
    bullet("Code — Berkeley Mono, 13.5px"),
    p(""),
    h("h2", "Spacing"),
    p("Base unit: 4px. Most gaps are 8, 12, 16, or 24px. Editor content width maxes out at 720px."),
    p(""),
    h("h2", "Principles"),
    numbered("Content first — UI should disappear while writing"),
    numbered("No chrome until hover — toolbars, handles, menus appear on interaction"),
    numbered("Instant feedback — every action < 16ms"),
  ),
  { emoji: "🎨", sortOrder: 2, daysAgo: 5 }
);

// 4. Reading List
insert(
  id(),
  "Reading List",
  doc(
    title("Reading List"),
    p("Books and articles to get through."),
    p(""),
    h("h2", "Books"),
    check("Designing Data-Intensive Applications — Kleppmann", true),
    check("A Philosophy of Software Design — Ousterhout", true),
    check("The Design of Everyday Things — Norman", false),
    check("Crafting Interpreters — Nystrom", false),
    check("Build — Tony Fadell", false),
    p(""),
    h("h2", "Articles"),
    check("Local-first software (Ink & Switch)", true),
    check("Figma's multiplayer tech blog", true),
    check("How Notion cloned the OS", false),
    check("CRDT primer by Martin Kleppmann", false),
  ),
  { emoji: "📚", sortOrder: 3, daysAgo: 3 }
);

// 5. Architecture (parent)
const archId = insert(
  id(),
  "Architecture",
  doc(
    title("Architecture"),
    p("Technical decisions and system design docs."),
  ),
  { emoji: "🏗️", sortOrder: 4, daysAgo: 14 }
);

insert(
  id(),
  "Data Model",
  doc(
    title("Data Model"),
    p("All data lives in a single SQLite file. No migrations needed for users — we handle schema versioning internally."),
    p(""),
    h("h2", "Tables"),
    bullet("documents — notes, with parent_id for nesting"),
    bullet("images — blob references, stored on disk"),
    bullet("meta — schema version tracking"),
    p(""),
    h("h2", "Why SQLite"),
    bullet("Zero setup — ships with the app"),
    bullet("Single file — trivial to backup or sync"),
    bullet("WAL mode — fast concurrent reads"),
    bullet("Perfect for local-first"),
    p(""),
    quote("\"SQLite is not a toy database. It's the most deployed database engine in the world.\""),
  ),
  { parentId: archId, sortOrder: 0, daysAgo: 14 }
);

insert(
  id(),
  "IPC Contract",
  doc(
    title("IPC Contract"),
    p("Communication between main and renderer uses typed IPC channels via the preload bridge."),
    p(""),
    h("h2", "Pattern"),
    p("Renderer calls window.lychee.invoke(channel, payload) which maps to ipcMain.handle() in the main process. Fully typed end-to-end."),
    p(""),
    h("h2", "Channels"),
    bullet("documents.create / get / list / update / delete"),
    bullet("documents.move / trash / restore"),
    bullet("images.save / get"),
    bullet("app.getPath"),
  ),
  { parentId: archId, sortOrder: 1, daysAgo: 12 }
);

insert(
  id(),
  "Editor Architecture",
  doc(
    title("Editor Architecture"),
    p("Built on Lexical (Meta's framework). Key decisions:"),
    p(""),
    bullet("Flat list model — list items are direct children of root, not nested <ul>/<li>. Indent level is a property on the node."),
    bullet("Custom TitleNode — always the first child, never deletable"),
    bullet("NodeViews for drag handles — each block wrapped with a handle that appears on hover"),
    bullet("Slash commands — custom plugin that intercepts / at the start of a line"),
    p(""),
    h("h2", "Why Lexical over ProseMirror"),
    bullet("React-native — plays well with our component tree"),
    bullet("Extensible node system — easy to add custom blocks"),
    bullet("Active development by Meta"),
    bullet("Great TypeScript support"),
  ),
  { parentId: archId, sortOrder: 2, daysAgo: 10 }
);

// 6. Ideas
insert(
  id(),
  "Ideas",
  doc(
    title("Ideas"),
    p("Random thoughts, features, and shower ideas."),
    p(""),
    bullet("What if notes could have a \"mood\" — color tint based on content?"),
    bullet("Vim keybindings mode for power users"),
    bullet("Template system — start a note from a template"),
    bullet("Backlinks — see which notes reference this one"),
    bullet("Daily note — auto-created page for today, like Roam/Logseq"),
    bullet("Focus mode — dim everything except the current block"),
    bullet("Export entire workspace as a static site"),
    bullet("AI summary of a long note (opt-in, not baked in)"),
    p(""),
    quote("The best notes app is the one you actually open."),
  ),
  { emoji: "💡", sortOrder: 5, daysAgo: 2 }
);

// 7. Journal (parent)
const journalId = insert(
  id(),
  "Journal",
  doc(
    title("Journal"),
    p("Weekly reflections on building Lychee."),
  ),
  { emoji: "✏️", sortOrder: 6, daysAgo: 0, hoursAgo: 5 }
);

insert(
  id(),
  "Week 1 — Starting from scratch",
  doc(
    title("Week 1 — Starting from scratch"),
    p("Set up Electron Forge with webpack, React, and Tailwind. Got a basic window rendering with hot reload."),
    p(""),
    p("The hardest part was getting better-sqlite3 to work as a webpack external. Electron's node integration + native modules is always a maze."),
    p(""),
    p("By Friday, I had a blank editor that could save to SQLite. Nothing fancy, but it felt like a real app."),
    p(""),
    quote("You don't need a plan for everything. Sometimes you just need to start typing."),
  ),
  { parentId: journalId, sortOrder: 0, daysAgo: 20 }
);

insert(
  id(),
  "Week 2 — The editor takes shape",
  doc(
    title("Week 2 — The editor takes shape"),
    p("Added headings, lists, checkboxes, quotes, code blocks. Lexical makes this surprisingly clean — each node type is a self-contained class."),
    p(""),
    p("The slash command menu took most of the week. Filtering, keyboard navigation, positioning the popover — lots of small details."),
    p(""),
    p("Drag and drop was a rabbit hole. Ended up using native drag events with custom serialization. It works, but needs polish."),
  ),
  { parentId: journalId, sortOrder: 1, daysAgo: 13 }
);

insert(
  id(),
  "Week 3 — Sidebar & navigation",
  doc(
    title("Week 3 — Sidebar & navigation"),
    p("Built the sidebar note tree with nested pages up to 5 levels deep. Drag to reorder, drag to nest."),
    p(""),
    p("Added tabs — you can open multiple notes side by side. The tab bar scrolls horizontally if you have too many."),
    p(""),
    p("Emoji picker for note icons. This small touch makes the sidebar feel alive. People love picking emojis."),
    p(""),
    h("h2", "Screenshot moment"),
    p("For the first time, it feels like a real app. Not a demo, not a prototype — something I'd actually use daily."),
  ),
  { parentId: journalId, sortOrder: 2, daysAgo: 6 }
);

// 8. Recipes
insert(
  id(),
  "Recipes",
  doc(
    title("Recipes"),
    p("Stuff that's actually good."),
    p(""),
    h("h2", "Overnight Oats"),
    bullet("½ cup oats"),
    bullet("½ cup oat milk"),
    bullet("1 tbsp chia seeds"),
    bullet("1 tbsp maple syrup"),
    bullet("Pinch of cinnamon"),
    p("Mix everything, fridge overnight. Top with berries in the morning."),
    p(""),
    h("h2", "Garlic Noodles"),
    bullet("200g noodles (any kind)"),
    bullet("4 cloves garlic, minced"),
    bullet("2 tbsp butter"),
    bullet("1 tbsp soy sauce"),
    bullet("1 tbsp oyster sauce"),
    bullet("Green onions, chili flakes"),
    p("Cook noodles. Brown garlic in butter. Toss with sauces. Top and serve."),
  ),
  { emoji: "🍳", sortOrder: 7, daysAgo: 4 }
);

// 9. Travel — Tokyo
insert(
  id(),
  "Tokyo Trip",
  doc(
    title("Tokyo Trip"),
    p("Planning for late spring. Cherry blossom season if we time it right."),
    p(""),
    h("h2", "Must-do"),
    check("Shibuya crossing at night", false),
    check("Tsukiji outer market — morning sushi", false),
    check("Meiji Shrine", false),
    check("Akihabara for vintage synths", false),
    check("Day trip to Kamakura", false),
    check("TeamLab Borderless", false),
    p(""),
    h("h2", "Food spots"),
    bullet("Ichiran Ramen (Shibuya)"),
    bullet("Afuri (yuzu ramen)"),
    bullet("Any conveyor belt sushi"),
    bullet("7-Eleven onigiri (seriously)"),
    p(""),
    h("h2", "Logistics"),
    bullet("Flights: look for ANA direct from SFO"),
    bullet("Stay: Shinjuku or Shibuya area"),
    bullet("Get Suica card on arrival"),
    bullet("Pocket wifi vs eSIM — eSIM is easier"),
  ),
  { emoji: "✈️", sortOrder: 8, daysAgo: 6 }
);

// 10. Bookmarks
insert(
  id(),
  "Bookmarks",
  doc(
    title("Bookmarks"),
    p("Links worth keeping."),
    p(""),
    h("h2", "Tools"),
    bullet("Linear — issue tracking that doesn't suck"),
    bullet("Figma — design tool of choice"),
    bullet("Warp — terminal reimagined"),
    bullet("Raycast — launcher that replaced Spotlight"),
    p(""),
    h("h2", "Inspiration"),
    bullet("iA Writer — the gold standard for writing apps"),
    bullet("Things 3 — beautiful task management"),
    bullet("Bear — elegant notes, great Markdown"),
    bullet("Craft — native Apple notes with superpowers"),
    p(""),
    h("h2", "Technical"),
    bullet("Lexical playground — lexical.dev/playground"),
    bullet("Electron Forge docs"),
    bullet("SQLite documentation"),
    bullet("Tailwind CSS v4 docs"),
  ),
  { emoji: "🔖", sortOrder: 9, daysAgo: 8 }
);

// 11. Fitness Log
insert(
  id(),
  "Fitness Log",
  doc(
    title("Fitness Log"),
    p("Tracking workouts loosely. Consistency > perfection."),
    p(""),
    h("h2", "This Week"),
    check("Monday — Upper body + 20 min run", true),
    check("Tuesday — Rest", true),
    check("Wednesday — Lower body", true),
    check("Thursday — Climbing gym", true),
    check("Friday — Yoga", false),
    check("Saturday — Long run (5K)", false),
    check("Sunday — Rest", false),
    p(""),
    h("h2", "PRs"),
    bullet("Bench: 185 lb"),
    bullet("Squat: 225 lb"),
    bullet("5K: 24:30"),
    bullet("V5 boulder (sent!)"),
  ),
  { emoji: "💪", sortOrder: 10, daysAgo: 0, hoursAgo: 8 }
);

// 12. Project Brief
insert(
  id(),
  "Why Lychee Exists",
  doc(
    title("Why Lychee Exists"),
    p("Notion got slow. It got complicated. It became an \"all-in-one workspace\" when all I wanted was a place to think."),
    p(""),
    p("Lychee is the notes app I wanted to open every day — fast, local, no login, no sync delay. Just you and your thoughts."),
    p(""),
    h("h2", "Principles"),
    numbered("Local-first — your data lives on your machine, in a single SQLite file"),
    numbered("Fast by default — no spinners, no skeletons, no loading states"),
    numbered("No feature creep — if Notion circa 2019 wouldn't have had it, think twice"),
    numbered("Opinionated — fewer options, better defaults"),
    p(""),
    h("h2", "Non-goals"),
    bullet("Real-time collaboration (for now)"),
    bullet("Database views, Kanban boards, Gantt charts"),
    bullet("AI anything (unless you opt in)"),
    bullet("A mobile app (desktop-first)"),
    p(""),
    hr(),
    p(""),
    p("Built with Electron, React, Lexical, SQLite, and a lot of opinions.", 2),
  ),
  { emoji: "🍋", sortOrder: 11, daysAgo: 21 }
);

// ── output SQL ───────────────────────────────────────────────

const esc = (s) => (s == null ? "NULL" : `'${s.replace(/'/g, "''")}'`);

console.log("BEGIN;");
for (const n of notes) {
  console.log(
    `INSERT INTO documents (id, title, content, createdAt, updatedAt, parentId, emoji, deletedAt, sortOrder) VALUES (${esc(n.id)}, ${esc(n.title)}, ${esc(n.content)}, ${esc(n.createdAt)}, ${esc(n.updatedAt)}, ${esc(n.parentId)}, ${esc(n.emoji)}, NULL, ${n.sortOrder});`
  );
}
console.log("COMMIT;");
process.stderr.write(`Generated ${notes.length} notes.\n`);
