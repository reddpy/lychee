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

const LIST_ITEM_MARKER = Symbol("list-item");
const listItem = (t, listType, checked = false) => ({
  __marker: LIST_ITEM_MARKER,
  listType,
  checked,
  children: [text(t)],
});
const bullet = (t) => listItem(t, "bullet");
const numbered = (t) => listItem(t, "number");
const check = (t, checked = false) => listItem(t, "check", checked);
const hr = () => ({ type: "horizontalrule", version: 1 });
const codeblock = (code, lang = "") =>
  block("code", [text(code)], { language: lang });

function wrapListItems(items, listType) {
  const tag = listType === "number" ? "ol" : "ul";
  return {
    type: "list",
    listType,
    tag,
    start: 1,
    direction: null,
    format: "",
    indent: 0,
    version: 1,
    children: items.map((item, i) => ({
      type: "listitem",
      value: i + 1,
      checked: item.checked ?? false,
      direction: null,
      format: "",
      indent: 0,
      version: 1,
      children: [...item.children],
    })),
  };
}

const doc = (...rawChildren) => {
  const children = [];
  let i = 0;
  while (i < rawChildren.length) {
    const child = rawChildren[i];
    if (child.__marker === LIST_ITEM_MARKER) {
      const group = [];
      const listType = child.listType;
      while (i < rawChildren.length && rawChildren[i].__marker === LIST_ITEM_MARKER && rawChildren[i].listType === listType) {
        group.push(rawChildren[i]);
        i++;
      }
      children.push(wrapListItems(group, listType));
    } else {
      children.push(child);
      i++;
    }
  }
  return JSON.stringify({
    root: {
      children,
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  });
};

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

// 13. Research (3-level nesting)
const researchId = insert(
  id(),
  "Research",
  doc(
    title("Research"),
    p("Deep dives on topics I keep coming back to. Each area gets its own sub-pages."),
  ),
  { emoji: "🔬", sortOrder: 12, daysAgo: 10 }
);

const distSysId = insert(
  id(),
  "Distributed Systems",
  doc(
    title("Distributed Systems"),
    p("Notes on consensus, replication, and everything that makes networking hard."),
    p(""),
    h("h2", "Core Papers"),
    check("Lamport — Time, Clocks, and the Ordering of Events (1978)", true),
    check("Fischer, Lynch, Paterson — FLP Impossibility (1985)", true),
    check("Ongaro & Ousterhout — In Search of an Understandable Consensus Algorithm (Raft)", true),
    check("Brewer — CAP Theorem (2000)", true),
    check("Shapiro et al. — CRDTs (2011)", false),
    p(""),
    h("h2", "Key Takeaways"),
    bullet("You can't have consistency and availability during a partition — pick two"),
    bullet("Consensus is solvable but expensive; avoid it when you can"),
    bullet("CRDTs trade coordination for mathematical guarantees — perfect for local-first"),
    bullet("Real systems are rarely purely CP or AP — they're a spectrum"),
  ),
  { parentId: researchId, sortOrder: 0, daysAgo: 9 }
);

insert(
  id(),
  "CAP Theorem Deep Dive",
  doc(
    title("CAP Theorem Deep Dive"),
    p("Eric Brewer's conjecture (2000), formally proved by Gilbert & Lynch (2002). Every distributed data store can provide at most two of three guarantees:"),
    p(""),
    h("h2", "The Three Properties"),
    numbered("Consistency — every read receives the most recent write or an error"),
    numbered("Availability — every request receives a non-error response (no guarantee it's the most recent write)"),
    numbered("Partition tolerance — the system continues to operate despite network partitions"),
    p(""),
    h("h2", "In Practice"),
    p("Partitions are inevitable in any real network. So the real choice is between C and A during a partition."),
    p(""),
    bullet("CP systems: HBase, MongoDB (in certain configs), Spanner"),
    bullet("AP systems: Cassandra, DynamoDB, CouchDB"),
    bullet("CA systems: single-node databases (PostgreSQL, SQLite) — no partition to tolerate"),
    p(""),
    h("h2", "The PACELC Extension"),
    p("Daniel Abadi (2012) extended CAP: if there's a Partition, choose A or C; Else, choose Latency or Consistency."),
    p(""),
    bullet("PA/EL — Cassandra, DynamoDB (available during partition, low latency otherwise)"),
    bullet("PC/EC — HBase, BigTable (consistent always, higher latency)"),
    bullet("PA/EC — rare, but some hybrid systems"),
    p(""),
    hr(),
    p(""),
    quote("\"The CAP theorem is not about choosing two out of three. It's about understanding what you lose when the network fails.\" — Martin Kleppmann"),
  ),
  { parentId: distSysId, sortOrder: 0, daysAgo: 8 }
);

insert(
  id(),
  "Raft vs Paxos",
  doc(
    title("Raft vs Paxos"),
    p("Raft was designed to be understandable. Paxos was designed to be correct. Both achieve the same thing — replicated consensus — but they get there very differently."),
    p(""),
    h("h2", "Paxos"),
    bullet("Leslie Lamport, 1989 (published 1998)"),
    bullet("Notoriously hard to understand — even Lamport's colleagues rejected the first paper"),
    bullet("Two-phase: prepare/promise, then accept/accepted"),
    bullet("Multi-Paxos extends it for a log of commands, but the paper doesn't specify this clearly"),
    bullet("Most real implementations (Chubby, Spanner) use heavily modified versions"),
    p(""),
    h("h2", "Raft"),
    bullet("Diego Ongaro & John Ousterhout, 2013"),
    bullet("Designed for understandability — the paper includes a user study proving students learn it faster"),
    bullet("Strong leader model — all writes go through the leader"),
    bullet("Three sub-problems: leader election, log replication, safety"),
    bullet("Used in etcd, CockroachDB, TiKV, Consul"),
    p(""),
    h("h2", "Key Differences"),
    p(""),
    bullet("Paxos allows any node to propose → more flexible but harder to reason about"),
    bullet("Raft requires a single leader → simpler but leader becomes a bottleneck"),
    bullet("Paxos handles membership changes awkwardly; Raft has a clean joint-consensus approach"),
    bullet("Raft's log is always contiguous; Paxos can have gaps"),
    p(""),
    h("h2", "My Take"),
    p("Use Raft if you're building something new. Use Paxos if you're reading papers. In practice, the distinction barely matters — most people use etcd or ZooKeeper and never touch raw consensus."),
  ),
  { parentId: distSysId, sortOrder: 1, daysAgo: 7 }
);

const plId = insert(
  id(),
  "Programming Languages",
  doc(
    title("Programming Languages"),
    p("Notes on type theory, language design, and compilers."),
    p(""),
    h("h2", "Languages I'm Exploring"),
    bullet("Rust — ownership model, borrow checker, zero-cost abstractions"),
    bullet("OCaml — algebraic data types, pattern matching, modules"),
    bullet("Zig — manual memory management done right, comptime"),
    bullet("Gleam — Erlang VM + ML-family types, built for distributed systems"),
    p(""),
    h("h2", "Open Questions"),
    bullet("Why haven't dependent types gone mainstream?"),
    bullet("Is the Rust borrow checker fundamentally at odds with prototyping speed?"),
    bullet("Could we get Hindley-Milner inference with subtyping? (TypeScript sort of does this)"),
    bullet("What would a language look like if it was designed for local-first apps?"),
  ),
  { parentId: researchId, sortOrder: 1, daysAgo: 6 }
);

insert(
  id(),
  "Type Systems Comparison",
  doc(
    title("Type Systems Comparison"),
    p("Mapping out the landscape of type systems across languages I use or study."),
    p(""),
    h("h2", "Structural vs Nominal"),
    bullet("Structural (TypeScript, Go interfaces) — types are compatible if their shape matches"),
    bullet("Nominal (Java, Rust, Haskell) — types are compatible only if explicitly declared"),
    bullet("TypeScript is the most interesting case: fully structural with discriminated unions"),
    p(""),
    h("h2", "Type Inference"),
    bullet("Hindley-Milner (ML, Haskell, Rust) — infers types globally, principal types"),
    bullet("Local inference (TypeScript, Kotlin, Swift) — infers within expressions, needs annotations at boundaries"),
    bullet("No inference (Java < 10, C) — you annotate everything manually"),
    p(""),
    h("h2", "Generics"),
    bullet("Parametric polymorphism (Haskell, Rust) — type variables, no runtime overhead"),
    bullet("Bounded generics (Java, TypeScript) — constraints on type parameters"),
    bullet("Monomorphization (Rust, C++) — compile-time specialization, generates specific code"),
    bullet("Type erasure (Java, TypeScript) — generics exist only at compile time"),
    p(""),
    h("h2", "Effect Systems"),
    p("The next frontier. Algebraic effects (Koka, Unison, Effekt) let you track side effects in the type system without monads."),
    p(""),
    codeblock("effect ask : () -> string\neffect fail : (msg: string) -> a\n\nfun greet() : <ask, fail> string\n  val name = ask()\n  if name == \"\" then fail(\"empty name\")\n  \"Hello, \" ++ name", ""),
    p(""),
    p("This is cleaner than Haskell's monad transformers and more explicit than just throwing exceptions."),
  ),
  { parentId: plId, sortOrder: 0, daysAgo: 4 }
);

insert(
  id(),
  "Crafting Interpreters — Reading Notes",
  doc(
    title("Crafting Interpreters — Reading Notes"),
    p("Working through Bob Nystrom's book. Building both a tree-walk interpreter (jlox) and a bytecode VM (clox)."),
    p(""),
    h("h2", "Part I — jlox (Java)"),
    check("Ch 4 — Scanning / lexing", true),
    check("Ch 5 — Representing code (AST)", true),
    check("Ch 6 — Parsing expressions (Pratt parser)", true),
    check("Ch 7 — Evaluating expressions", true),
    check("Ch 8 — Statements and state", true),
    check("Ch 9 — Control flow", true),
    check("Ch 10 — Functions", true),
    check("Ch 11 — Resolving and binding", false),
    check("Ch 12 — Classes", false),
    check("Ch 13 — Inheritance", false),
    p(""),
    h("h2", "Part II — clox (C)"),
    check("Ch 14 — Chunks of bytecode", false),
    check("Ch 15 — A virtual machine", false),
    check("Ch 16 — Scanning on demand", false),
    check("Ch 17 — Compiling expressions", false),
    p(""),
    h("h2", "Key Insights"),
    bullet("Pratt parsing is elegant — precedence as a number, recursive calls handle associativity"),
    bullet("Environment chains for scoping are simple but powerful"),
    bullet("The jump from tree-walk to bytecode VM is huge in complexity but the perf gain is 10-100x"),
    p(""),
    quote("\"I think language design is one of the most fascinating and creative acts in all of programming.\" — Bob Nystrom"),
  ),
  { parentId: plId, sortOrder: 1, daysAgo: 3 }
);

// 14. Startup (3-level nesting)
const startupId = insert(
  id(),
  "Startup",
  doc(
    title("Startup"),
    p("Everything related to the side project that might become a company. Codename: Canopy."),
    p(""),
    p("The idea: a local-first knowledge base for small engineering teams. Think Notion meets Obsidian, but designed for 5-15 person teams with shared SQLite replicas via S3."),
  ),
  { emoji: "🚀", sortOrder: 13, daysAgo: 15 }
);

const marketId = insert(
  id(),
  "Market Research",
  doc(
    title("Market Research"),
    p("Understanding the landscape before building."),
    p(""),
    h("h2", "Target Market"),
    bullet("Small engineering teams (5-15 people)"),
    bullet("Teams frustrated with Notion's performance"),
    bullet("Privacy-conscious orgs (legal, healthcare, fintech)"),
    bullet("Remote-first teams who need offline access"),
    p(""),
    h("h2", "Market Size"),
    bullet("Knowledge management tools: ~$20B globally"),
    bullet("Team collaboration: ~$15B and growing 12% YoY"),
    bullet("Our niche (local-first, small teams): maybe $500M–$1B addressable"),
    p(""),
    h("h2", "Pricing Hypothesis"),
    bullet("Free for personal use (unlimited notes)"),
    bullet("$12/user/month for teams (shared workspaces, sync, permissions)"),
    bullet("$20/user/month for enterprise (SSO, audit logs, on-prem)"),
  ),
  { parentId: startupId, sortOrder: 0, daysAgo: 14 }
);

insert(
  id(),
  "Competitor Analysis",
  doc(
    title("Competitor Analysis"),
    p("How we stack up against the field."),
    p(""),
    h("h2", "Notion"),
    bullet("Strengths: all-in-one, databases, templates, massive ecosystem"),
    bullet("Weaknesses: slow, cloud-only, no offline, gets complicated fast"),
    bullet("Why we win: speed, simplicity, privacy, offline-first"),
    p(""),
    h("h2", "Obsidian"),
    bullet("Strengths: local-first, Markdown, plugin ecosystem, graph view"),
    bullet("Weaknesses: team features are bolted on, sync costs extra, ugly by default"),
    bullet("Why we win: real-time team sync, polished out-of-box, structured data"),
    p(""),
    h("h2", "Coda"),
    bullet("Strengths: docs that feel like apps, great formulas, integrations"),
    bullet("Weaknesses: slow, cloud-only, complex pricing, steep learning curve"),
    bullet("Why we win: simplicity, speed, no vendor lock-in"),
    p(""),
    h("h2", "Linear (as inspiration)"),
    bullet("Not a direct competitor, but the gold standard for opinionated tools"),
    bullet("Linear proved that \"less is more\" works for teams"),
    bullet("We should emulate their focus and polish"),
    p(""),
    hr(),
    p(""),
    quote("\"The best product isn't the one with the most features. It's the one people actually want to open.\""),
  ),
  { parentId: marketId, sortOrder: 0, daysAgo: 13 }
);

insert(
  id(),
  "User Interviews",
  doc(
    title("User Interviews"),
    p("Conversations with potential users. 8 interviews completed, 4 more scheduled."),
    p(""),
    h("h2", "Interview 1 — Sarah (Eng Lead, 8-person startup)"),
    quote("\"We use Notion but half the team has switched back to Apple Notes because Notion is just too slow for quick notes.\""),
    bullet("Pain: Notion lag, especially on larger docs"),
    bullet("Want: something fast that still supports structured docs"),
    bullet("Would pay: $10-15/user/month"),
    p(""),
    h("h2", "Interview 2 — Marcus (Solo founder, fintech)"),
    quote("\"I can't put client data in Notion. Full stop. I need something that stays on my machine.\""),
    bullet("Pain: compliance requirements make cloud tools risky"),
    bullet("Want: local storage with optional encrypted sync"),
    bullet("Would pay: $25/month for peace of mind"),
    p(""),
    h("h2", "Interview 3 — Priya (Design Lead, agency)"),
    quote("\"Our Notion workspace has 2000 pages. Nobody can find anything. Search is broken.\""),
    bullet("Pain: information sprawl, poor search"),
    bullet("Want: better organization, maybe AI-powered search"),
    bullet("Would pay: depends on team features"),
    p(""),
    h("h2", "Patterns So Far"),
    numbered("Speed is the #1 complaint about Notion — every single interviewee mentioned it"),
    numbered("Privacy/compliance is a strong secondary driver"),
    numbered("People want simplicity but not at the expense of rich formatting"),
    numbered("Search needs to be excellent from day one"),
  ),
  { parentId: marketId, sortOrder: 1, daysAgo: 11 }
);

const techSpecId = insert(
  id(),
  "Technical Spec",
  doc(
    title("Technical Spec"),
    p("Architecture and design decisions for Canopy."),
    p(""),
    h("h2", "High-Level Architecture"),
    numbered("Desktop app (Electron) — primary interface"),
    numbered("SQLite per workspace — all data lives locally"),
    numbered("S3 sync layer — encrypted SQLite WAL shipping for team sync"),
    numbered("Auth service — lightweight, handles team invites and key exchange"),
    p(""),
    h("h2", "Key Constraints"),
    bullet("Must work fully offline — sync is eventual, not required"),
    bullet("Encryption at rest — team data is E2EE before it touches S3"),
    bullet("Sub-100ms for any user action — no loading spinners ever"),
    bullet("Single binary distribution — no installer dependencies"),
  ),
  { parentId: startupId, sortOrder: 1, daysAgo: 12 }
);

insert(
  id(),
  "Sync Protocol Design",
  doc(
    title("Sync Protocol Design"),
    p("How we replicate SQLite across team members without a central server."),
    p(""),
    h("h2", "Approach: WAL Shipping + CRDTs"),
    p("Each client maintains a full SQLite replica. Changes are captured as WAL frames, encrypted, and shipped to an S3 bucket. Other clients pull and apply frames."),
    p(""),
    h("h2", "Conflict Resolution"),
    bullet("Document-level: last-writer-wins with vector clocks"),
    bullet("Block-level (future): Yjs CRDT for real-time collaborative editing"),
    bullet("Tree structure: operational transform for move operations (prevent cycles)"),
    p(""),
    h("h2", "Sync Flow"),
    numbered("User edits a document locally → writes to SQLite"),
    numbered("Background worker detects WAL changes → extracts frames"),
    numbered("Frames encrypted with workspace key → uploaded to S3"),
    numbered("Other clients poll S3 → download new frames → decrypt → apply to local DB"),
    numbered("Conflict detected? → resolve per-field using vector clocks"),
    p(""),
    h("h2", "Encryption"),
    p("Every workspace has a symmetric key (AES-256-GCM). The key is exchanged during team invite via X25519 key agreement. S3 never sees plaintext."),
    p(""),
    codeblock("workspace_key = random(32 bytes)\nencrypted_frame = AES-256-GCM(workspace_key, wal_frame)\ns3_object = nonce || encrypted_frame || tag", ""),
    p(""),
    h("h2", "Open Questions"),
    bullet("How do we handle schema migrations across clients on different app versions?"),
    bullet("What's the maximum practical sync lag? Target: < 5 seconds on decent internet"),
    bullet("Should we support selective sync (only sync certain pages)?"),
  ),
  { parentId: techSpecId, sortOrder: 0, daysAgo: 10 }
);

insert(
  id(),
  "API Design",
  doc(
    title("API Design"),
    p("REST API for the auth/sync service. Minimal surface area — the client does most of the work."),
    p(""),
    h("h2", "Auth Endpoints"),
    codeblock("POST   /auth/signup        { email, password }\nPOST   /auth/login         { email, password } → { token }\nPOST   /auth/refresh       { refresh_token } → { token }\nDELETE /auth/session       (logout)", ""),
    p(""),
    h("h2", "Workspace Endpoints"),
    codeblock("POST   /workspaces              { name } → { id, invite_code }\nGET    /workspaces/:id          → { name, members, created_at }\nPOST   /workspaces/:id/invite   { email } → { invite_url }\nPOST   /workspaces/:id/join     { invite_code, public_key }", ""),
    p(""),
    h("h2", "Sync Endpoints"),
    codeblock("GET    /sync/:workspace/frames?after=<seq>  → { frames[], latest_seq }\nPOST   /sync/:workspace/frames               { encrypted_frames[] }\nGET    /sync/:workspace/status                → { latest_seq, member_seqs }", ""),
    p(""),
    h("h2", "Design Principles"),
    bullet("No document content ever passes through the API in plaintext"),
    bullet("API is stateless — all state lives in S3 and client SQLite"),
    bullet("Rate limit: 100 req/min per user, 1000 req/min per workspace"),
    bullet("Versioned: /v1/ prefix, breaking changes get a new version"),
  ),
  { parentId: techSpecId, sortOrder: 1, daysAgo: 9 }
);

// 15. Home (3-level nesting)
const homeId = insert(
  id(),
  "Home",
  doc(
    title("Home"),
    p("Apartment stuff, renovation plans, and household logistics."),
  ),
  { emoji: "🏠", sortOrder: 14, daysAgo: 12 }
);

const kitchenId = insert(
  id(),
  "Kitchen Remodel",
  doc(
    title("Kitchen Remodel"),
    p("The kitchen hasn't been updated since 2003. Time to fix that."),
    p(""),
    h("h2", "Budget"),
    bullet("Total budget: $18,000"),
    bullet("Cabinets: $6,000 (IKEA + custom fronts)"),
    bullet("Countertops: $3,500 (quartz)"),
    bullet("Appliances: $4,000"),
    bullet("Labor: $3,500"),
    bullet("Contingency: $1,000"),
    p(""),
    h("h2", "Timeline"),
    check("Week 1-2: Demo existing cabinets & counters", true),
    check("Week 2-3: Plumbing & electrical rough-in", true),
    check("Week 3-4: Install cabinets", false),
    check("Week 4-5: Countertop template & install", false),
    check("Week 5-6: Backsplash, paint, finishing", false),
    check("Week 6: Appliance delivery & hookup", false),
    p(""),
    h("h2", "Inspo"),
    bullet("Scandinavian minimal — white oak, white surfaces, brass hardware"),
    bullet("Japanese kitchen vibes — clean lines, hidden storage, natural materials"),
    bullet("The Apartment Therapy kitchen reno series was helpful"),
  ),
  { parentId: homeId, sortOrder: 0, daysAgo: 10 }
);

insert(
  id(),
  "Appliance Research",
  doc(
    title("Appliance Research"),
    p("Comparing options for the kitchen remodel. Prioritizing reliability over fancy features."),
    p(""),
    h("h2", "Refrigerator"),
    bullet("Bosch 800 Series (B36CL80ENS) — $2,400, counter-depth, quiet"),
    bullet("LG InstaView (LRFXS2503S) — $1,800, good reviews, but LG reliability concerns"),
    bullet("Winner: Bosch. More expensive but the compressor is top-mounted (lasts longer)."),
    p(""),
    h("h2", "Range"),
    bullet("Samsung Slide-in Gas (NX60T8711SS) — $1,400, great reviews"),
    bullet("GE Profile (PGS930) — $1,600, air fry mode"),
    bullet("Winner: Samsung. Better value, same features that matter."),
    p(""),
    h("h2", "Dishwasher"),
    bullet("Bosch 500 Series (SHPM65Z55N) — $950, 44 dB, legendary reliability"),
    bullet("Miele G5006 — $1,100, slightly better cleaning, 46 dB"),
    bullet("Winner: Bosch. The 500 Series is the consensus best dishwasher at any price."),
    p(""),
    hr(),
    p(""),
    p("Total appliance spend: $4,750 (over budget by $750, need to adjust)"),
  ),
  { parentId: kitchenId, sortOrder: 0, daysAgo: 8 }
);

insert(
  id(),
  "Contractor Quotes",
  doc(
    title("Contractor Quotes"),
    p("Got three quotes for the kitchen labor."),
    p(""),
    h("h2", "Quote 1 — Rivera Renovations"),
    bullet("$3,200 labor"),
    bullet("3-week timeline"),
    bullet("Great Yelp reviews, responsive via text"),
    bullet("Includes plumbing and basic electrical"),
    p(""),
    h("h2", "Quote 2 — BuildRight Co."),
    bullet("$4,800 labor"),
    bullet("2.5-week timeline"),
    bullet("Licensed and bonded, does permit pulling"),
    bullet("Includes everything + countertop templating"),
    p(""),
    h("h2", "Quote 3 — Mike (referral from Jake)"),
    bullet("$2,100 labor"),
    bullet("4-week timeline (weekends only)"),
    bullet("No formal reviews, but Jake's kitchen turned out great"),
    bullet("Does not include plumbing — would need separate plumber"),
    p(""),
    h("h2", "Decision"),
    p("Going with Rivera. Best balance of price, speed, and reliability. The Yelp reviews sealed it — multiple people mentioned he's clean and communicative."),
  ),
  { parentId: kitchenId, sortOrder: 1, daysAgo: 6 }
);

const gardenId = insert(
  id(),
  "Garden",
  doc(
    title("Garden"),
    p("Making the backyard actually usable this year. Small space (12x20 ft) but enough for raised beds and a sitting area."),
    p(""),
    h("h2", "Goals"),
    numbered("Build 2 raised beds (4x8 each)"),
    numbered("Grow enough herbs and greens to cut grocery herb spending to zero"),
    numbered("Create a seating area with string lights"),
    numbered("Install a drip irrigation timer"),
    p(""),
    h("h2", "Soil Mix"),
    p("Mel's Mix for raised beds:"),
    bullet("1/3 compost (mixed sources)"),
    bullet("1/3 peat moss (or coco coir)"),
    bullet("1/3 vermiculite"),
    p("Cost: ~$80 per bed. $160 total."),
  ),
  { parentId: homeId, sortOrder: 1, daysAgo: 5 }
);

insert(
  id(),
  "Spring Planting Plan",
  doc(
    title("Spring Planting Plan"),
    p("Zone 10a. Last frost date is mid-February, so we're clear to plant most things now."),
    p(""),
    h("h2", "Bed 1 — Herbs & Greens"),
    bullet("Basil (Genovese) — 4 plants, full sun"),
    bullet("Cilantro — direct sow, succession plant every 3 weeks"),
    bullet("Mint — IN A POT (learned this the hard way)"),
    bullet("Lettuce mix — partial shade side, harvest as baby greens"),
    bullet("Kale (Lacinato) — 2 plants, will produce through fall"),
    bullet("Parsley (Italian flat-leaf) — 2 plants, biennial"),
    p(""),
    h("h2", "Bed 2 — Vegetables"),
    bullet("Tomatoes (Cherokee Purple) — 2 plants, need cages"),
    bullet("Tomatoes (Sun Gold cherry) — 1 plant, incredibly prolific"),
    bullet("Peppers (Shishito) — 3 plants, perfect for grilling"),
    bullet("Zucchini — 1 plant (ONE — trust me, one is enough)"),
    bullet("Green beans (bush) — direct sow along the back edge"),
    p(""),
    h("h2", "Schedule"),
    check("March 1 — Build raised beds, fill with soil", true),
    check("March 8 — Start tomato & pepper seeds indoors", true),
    check("March 15 — Direct sow lettuce, cilantro, beans", false),
    check("April 1 — Transplant tomatoes & peppers", false),
    check("April 15 — Install drip irrigation", false),
    check("May — First harvest (lettuce, herbs)", false),
    p(""),
    quote("\"The best time to plant a garden was 20 years ago. The second best time is now.\""),
  ),
  { parentId: gardenId, sortOrder: 0, daysAgo: 2 }
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
