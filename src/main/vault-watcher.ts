import * as parcelWatcher from "@parcel/watcher";
import fs from "fs";
import path from "path";
import { revisionOf } from "../shared/hash";
import { shouldIgnoreVaultPath, isConflictCopyPath } from "../shared/vault-watch";

/**
 * Cross-platform vault watcher backed by `@parcel/watcher` (FSEvents /
 * ReadDirectoryChangesW / inotify / Watchman) through a native napi binding.
 *
 * `VaultSync` orchestrates the DB/filesystem; this class only turns OS events
 * into normalized `VaultFileEvent`s. It:
 * - debounces per path, then processes through a serialized queue so a large
 *   change set cannot starve the DB/renderer,
 * - settles before reading (an editor's temp→rename or a partial write is never
 *   imported half-written),
 * - suppresses our own writes by path + content revision,
 * - watches the tombstone directory separately (with a periodic lightweight
 *   reconcile), and
 * - scans existing files once on start (`@parcel/watcher` only reports changes).
 */

export interface VaultFileEvent {
  relativePath: string;
  exists: boolean;
  revision: string;
  contents: string | null;
}

/** The surface `VaultSync` depends on. */
export interface VaultWatcherLike {
  isRunning(): boolean;
  getDirectory(): string | null;
  suppress(relativePath: string, revision: string, ttlMs?: number): void;
  unsuppress(relativePath: string): void;
  refresh(relativePath: string): void;
  start(directory: string): void;
  stop(): void;
}

const DEBOUNCE_MS = 250;
const SETTLE_MS = 250;
const SUPPRESS_TTL_MS = 8000;
/**
 * Safety-net interval for tombstone reconciliation (reads only the small
 * tombstone logs). There is intentionally no periodic whole-vault query.
 */
const POLL_MS = 3000;

export class VaultWatcher implements VaultWatcherLike {
  private subscription: parcelWatcher.AsyncSubscription | null = null;
  private tombstoneSubscription: parcelWatcher.AsyncSubscription | null = null;
  private directory: string | null = null;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly suppressed = new Map<string, { revision: string; until: number }>();
  /** Paths discovered by the initial scan; these are already-complete files. */
  private readonly initialPaths = new Set<string>();
  private tombstoneTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  /** Live `.md` paths (relative), used by the non-blocking safety-net diff. */
  private knownPaths = new Set<string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly onEvent: (event: VaultFileEvent) => void,
    private readonly onTombstones: () => void = () => {},
  ) {}

  isRunning(): boolean {
    return this.subscription !== null;
  }

  getDirectory(): string | null {
    return this.directory;
  }

  suppress(relativePath: string, revision: string, ttlMs = SUPPRESS_TTL_MS): void {
    this.suppressed.set(relativePath, { revision, until: Date.now() + ttlMs });
  }

  /**
   * Drop the own-write baseline for a path. Called when the path is observed to
   * be removed: if the same bytes are later written/moved back to the same path
   * within the suppression TTL, the content hash would still match and the
   * change would be mistaken for our own write (e.g. a note moved out of a
   * folder and back).
   */
  unsuppress(relativePath: string): void {
    this.suppressed.delete(relativePath);
  }

  /** Re-read a path now (e.g. a change arrived while the previous one was applying). */
  refresh(relativePath: string): void {
    this.schedule(relativePath);
  }

  start(directory: string): void {
    if (this.subscription) this.stop();
    // @parcel/watcher reports real (symlink-resolved) paths. On macOS the temp
    // dir is a symlink (`/var` -> `/private/var`), so watching `/var/...` and
    // then calling `path.relative` against event paths under `/private/var/...`
    // escapes the root and every event looks like a dotfile. Watch the realpath.
    let resolved = directory;
    try {
      resolved = fs.realpathSync(directory);
    } catch {
      // Directory may not exist yet; keep the given path.
    }
    this.directory = resolved;
    // @parcel/watcher rejects a subscription to a missing path; the tombstone
    // directory is created lazily on the first delete, so ensure it exists.
    const tombstoneDir = path.join(resolved, ".lychee", "tombstones");
    try {
      fs.mkdirSync(tombstoneDir, { recursive: true });
    } catch {
      // Best-effort; a later delete will create it.
    }

    void parcelWatcher
      .subscribe(
        resolved,
        (error, events) => {
          if (error) {
            console.error("[vault-watcher]", error);
            return;
          }
          for (const event of events) {
            const relativePath = path
              .relative(resolved, event.path)
              .split(path.sep)
              .join("/");
            this.schedule(relativePath);
          }
        },
        // Suffix noise only; dot-files/dirs are filtered per-segment below so
        // correctness never depends on glob semantics.
        { ignore: ["**/*.tmp", "**/*~", "**/*.swp", "**/*.swx"] },
      )
      .then((sub) => {
        if (this.directory === resolved) {
          this.subscription = sub;
          // @parcel/watcher only reports changes after subscription, so import
          // files that already exist on launch with a one-shot walk.
          this.initialScan();
          this.startPolling(resolved);
        } else {
          void sub.unsubscribe();
        }
      })
      .catch((error) => console.error("[vault-watcher]", error));

    void parcelWatcher
      .subscribe(tombstoneDir, (error) => {
        if (!error) this.scheduleTombstones();
      })
      .then((sub) => {
        if (this.directory === resolved) {
          this.tombstoneSubscription = sub;
          // Reconcile once after subscribing: a tombstone written between
          // `start` and the async subscription resolving would otherwise be
          // missed (no event is replayed for it).
          this.onTombstones();
        } else {
          void sub.unsubscribe();
        }
      })
      .catch((error) => console.error("[vault-watcher]", error));
  }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    if (this.tombstoneTimer) clearTimeout(this.tombstoneTimer);
    this.tombstoneTimer = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.suppressed.clear();
    this.initialPaths.clear();
    this.knownPaths.clear();
    const subscription = this.subscription;
    const tombstoneSubscription = this.tombstoneSubscription;
    this.subscription = null;
    this.tombstoneSubscription = null;
    this.directory = null;
    if (subscription) void subscription.unsubscribe();
    if (tombstoneSubscription) void tombstoneSubscription.unsubscribe();
  }

  /**
   * Periodic safety net + tombstone reconcile.
   *
   * `subscribe` can coalesce a create+delete (or a directory rename's
   * delete+create) within its C++ throttle window into a single, possibly
   * no-op notification, so some events would otherwise be missed. We recover
   * them with our own async directory diff rather than `@parcel/watcher`'s
   * `getEventsSince`: the native query runs synchronously on the calling
   * thread and was measured blocking Electron's main process for ~625ms every
   * 3s on a real vault, freezing the whole app. `fs.promises.readdir` runs on
   * the thread pool and yields, so a big vault cannot stall the main thread.
   */
  private startPolling(resolved: string): void {
    this.pollTimer = setInterval(() => {
      if (this.directory !== resolved) return;
      void this.sweep(resolved);
    }, POLL_MS);
  }

  /** Diff the on-disk `.md` set against what we last saw; schedule any change. */
  private async sweep(resolved: string): Promise<void> {
    if (this.directory !== resolved) return;
    this.onTombstones();
    const current = await this.collectMarkdown(resolved);
    if (this.directory !== resolved) return;
    for (const relativePath of current) {
      if (!this.knownPaths.has(relativePath)) this.schedule(relativePath);
    }
    for (const relativePath of this.knownPaths) {
      if (!current.has(relativePath)) this.schedule(relativePath);
    }
    this.knownPaths = current;
  }

  /** Async recursive walk of note `.md` files (skips dot-dirs and artifacts). */
  private async collectMarkdown(root: string): Promise<Set<string>> {
    const out = new Set<string>();
    const walk = async (dir: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(absolute);
          continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
        const relativePath = path.relative(root, absolute).split(path.sep).join("/");
        if (isConflictCopyPath(relativePath) || this.isIgnored(relativePath)) continue;
        out.add(relativePath);
      }
    };
    await walk(root);
    return out;
  }

  /** Walk the tree once and schedule every existing `.md` file (ignoreInitial). */
  private initialScan(): void {
    const directory = this.directory;
    if (!directory) return;
    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(absolute);
          continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
        const relativePath = path.relative(directory, absolute).split(path.sep).join("/");
        this.initialPaths.add(relativePath);
        this.knownPaths.add(relativePath);
        this.schedule(relativePath);
      }
    };
    walk(directory);
  }

  private scheduleTombstones(): void {
    if (this.tombstoneTimer) clearTimeout(this.tombstoneTimer);
    this.tombstoneTimer = setTimeout(() => {
      this.tombstoneTimer = null;
      this.onTombstones();
    }, DEBOUNCE_MS);
  }

  /** True for any path with a dot-segment or an editor artifact basename. */
  private isIgnored(relativePath: string): boolean {
    if (!relativePath) return true;
    for (const segment of relativePath.split("/")) {
      if (shouldIgnoreVaultPath(segment)) return true;
    }
    return shouldIgnoreVaultPath(path.basename(relativePath));
  }

  private schedule(relativePath: string): void {
    if (!this.directory) return;
    if (!relativePath.toLowerCase().endsWith(".md")) return;
    if (isConflictCopyPath(relativePath)) return;
    if (this.isIgnored(relativePath)) return;

    const existing = this.timers.get(relativePath);
    if (existing) clearTimeout(existing);

    this.timers.set(
      relativePath,
      setTimeout(() => {
        this.timers.delete(relativePath);
        this.queue = this.queue
          .then(() => this.flush(relativePath))
          .catch((error) => console.error("[vault-watcher] flush failed", error));
      }, DEBOUNCE_MS),
    );
  }

  /** Wait until two consecutive reads agree, so a partial write is never read. */
  private async readSettled(absolute: string): Promise<string | null> {
    const started = Date.now();
    let previous: string | null = null;
    for (;;) {
      let contents: string | null;
      try {
        contents = await fs.promises.readFile(absolute, "utf8");
      } catch {
        contents = null;
      }
      if (contents === null) return null;
      if (previous === contents) return contents;
      previous = contents;
      if (Date.now() - started > SETTLE_MS * 4) return contents;
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    }
  }

  private async flush(relativePath: string): Promise<void> {
    const directory = this.directory;
    if (!directory) return;

    // Initial-scan files are already fully written, so skip the settle delay;
    // otherwise a 7-note startup import takes seconds and races external edits.
    const isInitial = this.initialPaths.delete(relativePath);
    const absolute = path.join(directory, relativePath);
    let contents: string | null;
    if (isInitial) {
      try {
        contents = await fs.promises.readFile(absolute, "utf8");
      } catch {
        contents = null;
      }
    } else {
      contents = await this.readSettled(absolute);
    }
    const revision = contents === null ? "" : revisionOf(contents);

    const suppression = this.suppressed.get(relativePath);
    if (suppression) {
      if (suppression.until <= Date.now()) {
        this.suppressed.delete(relativePath);
      } else if (suppression.revision === revision) {
        this.suppressed.delete(relativePath);
        return;
      }
    }

    this.onEvent({ relativePath, exists: contents !== null, revision, contents });
  }
}
