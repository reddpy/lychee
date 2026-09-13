import chokidar, { type FSWatcher } from "chokidar";
import fs from "fs";
import path from "path";
import { revisionOf } from "../shared/hash";
import { shouldIgnoreVaultPath, isConflictCopyPath } from "../shared/vault-watch";

export interface VaultFileEvent {
  relativePath: string;
  exists: boolean;
  revision: string;
  contents: string | null;
}

const DEBOUNCE_MS = 250;
const SETTLE_MS = 250;
const SUPPRESS_TTL_MS = 8000;

/**
 * Cross-platform vault watcher (chokidar → FSEvents / ReadDirectoryChangesW /
 * inotify). Reliability choices:
 *
 * - `awaitWriteFinish` waits for an editor's (or our own) temp→rename write to
 *   settle before we read, so we never read a half-written file.
 * - `atomic: true` handles editors that write via rename.
 * - per-path debounce coalesces bursts; a single global promise chain serializes
 *   processing so a large change set cannot exhaust the DB/renderer.
 * - `suppress()` records revisions we just wrote, so our own writes (and the
 *   baseline race before the DB metadata commit) do not echo back as external
 *   edits.
 */
export class VaultWatcher {
  private watcher: FSWatcher | null = null;
  private tombstoneWatcher: FSWatcher | null = null;
  private directory: string | null = null;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly suppressed = new Map<string, { revision: string; until: number }>();
  private tombstoneTimer: NodeJS.Timeout | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly onEvent: (event: VaultFileEvent) => void,
    private readonly onTombstones: () => void = () => {},
  ) {}

  isRunning(): boolean {
    return this.watcher !== null;
  }

  getDirectory(): string | null {
    return this.directory;
  }

  suppress(relativePath: string, revision: string, ttlMs = SUPPRESS_TTL_MS): void {
    this.suppressed.set(relativePath, { revision, until: Date.now() + ttlMs });
  }

  /** Re-read a path now (e.g. a change arrived while the previous one was applying). */
  refresh(relativePath: string): void {
    const directory = this.directory;
    if (!directory) return;
    this.schedule(path.join(directory, relativePath));
  }

  start(directory: string): void {
    if (this.watcher) this.stop();
    this.directory = directory;
    this.watcher = chokidar.watch(directory, {
      // Scan existing files on start so changes made while the app was closed are
      // reconciled (baselines make already-exported files a no-op).
      ignoreInitial: false,
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: SETTLE_MS, pollInterval: 100 },
      followSymlinks: false,
      persistent: true,
      depth: 25,
      ignored: (candidate: string) => shouldIgnoreVaultPath(path.basename(candidate)),
    });

    const schedule = (absolute: string) => this.schedule(absolute);
    this.watcher
      .on("add", schedule)
      .on("change", schedule)
      .on("unlink", schedule)
      .on("error", (error) => console.error("[vault-watcher]", error));

    // Tombstone logs live under a dot-directory (ignored by the markdown watcher),
    // so watch them separately to pick up deletes synced from other devices.
    this.tombstoneWatcher = chokidar.watch(path.join(directory, ".lychee", "tombstones"), {
      ignoreInitial: true,
      persistent: true,
      depth: 2,
    });
    const scheduleTombstones = () => this.scheduleTombstones();
    this.tombstoneWatcher
      .on("add", scheduleTombstones)
      .on("change", scheduleTombstones)
      .on("unlink", scheduleTombstones)
      .on("error", (error) => console.error("[vault-watcher]", error));
  }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    if (this.tombstoneTimer) clearTimeout(this.tombstoneTimer);
    this.tombstoneTimer = null;
    this.suppressed.clear();
    const watcher = this.watcher;
    const tombstoneWatcher = this.tombstoneWatcher;
    this.watcher = null;
    this.tombstoneWatcher = null;
    this.directory = null;
    if (watcher) void watcher.close();
    if (tombstoneWatcher) void tombstoneWatcher.close();
  }

  private scheduleTombstones(): void {
    if (this.tombstoneTimer) clearTimeout(this.tombstoneTimer);
    this.tombstoneTimer = setTimeout(() => {
      this.tombstoneTimer = null;
      this.onTombstones();
    }, DEBOUNCE_MS);
  }

  private schedule(absolute: string): void {
    const directory = this.directory;
    if (!directory) return;
    const relativePath = path.relative(directory, absolute).split(path.sep).join("/");
    // Only markdown is ever a Lychee note; never read unrelated files.
    if (!relativePath.toLowerCase().endsWith(".md")) return;
    if (isConflictCopyPath(relativePath)) return;

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

  private async flush(relativePath: string): Promise<void> {
    const directory = this.directory;
    if (!directory) return;

    const absolute = path.join(directory, relativePath);
    let contents: string | null;
    try {
      contents = await fs.promises.readFile(absolute, "utf8");
    } catch {
      contents = null;
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
