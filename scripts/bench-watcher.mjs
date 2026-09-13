import * as parcel from "@parcel/watcher";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

// chokidar is optional: it is no longer a dependency of the app, but can be
// installed ad hoc to re-run the head-to-head comparison.
let chokidar = null;
try {
  chokidar = (await import("chokidar")).default;
} catch {
  chokidar = null;
}

/**
 * Watcher backend benchmark: chokidar vs @parcel/watcher.
 *
 * Each backend runs the same per-event work the app does (read the file + hash
 * it), so the comparison isolates the watching layer from the DB/renderer
 * pipeline. Scenarios exercise the shapes that matter: a mass edit, a mass
 * create, a mass delete, a mass rename, and single-change latency.
 *
 *   node scripts/bench-watcher.mjs [fileCount] [rounds]
 */

const N = Number(process.argv[2] ?? 1200);
const ROUNDS = Number(process.argv[3] ?? 3);
const LATENCY_SAMPLES = Number(process.argv[4] ?? 15);
const QUIET_MS = 300;
const WAIT_MS = 30000;
const PARCEL_IGNORE = ["**/*.tmp", "**/*~", "**/*.swp", "**/*.swx"];

const noteName = (i) => `note-${String(i).padStart(5, "0")}.md`;
const noteBody = (i) =>
  `---\nid: "${i}"\ncreated: "2024-01-01T00:00:00.000Z"\nupdated: "2024-01-02T00:00:00.000Z"\n---\n\nbody ${i}\n`;

function makeVault(count) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lychee-watch-bench-"));
  for (let i = 0; i < count; i += 1) {
    fs.writeFileSync(path.join(dir, noteName(i)), noteBody(i));
  }
  return dir;
}

function sha(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeout = WAIT_MS) {
  const start = Date.now();
  for (;;) {
    if (predicate()) return true;
    if (Date.now() - start > timeout) return false;
    await sleep(25);
  }
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return { median, p95 };
}

// ── backend adapters ────────────────────────────────────────────────

async function startChokidar(dir, onPath) {
  const watcher = chokidar.watch(dir, {
    ignoreInitial: true,
    atomic: true,
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
    ignored: (candidate) => path.basename(candidate).startsWith("."),
  });
  watcher.on("all", (_event, file) => onPath(file));
  await new Promise((resolve) => watcher.once("ready", resolve));
  return async () => {
    await watcher.close();
  };
}

async function startParcel(dir, onPath) {
  const subscription = await parcel.subscribe(
    dir,
    (error, events) => {
      if (error) return;
      for (const event of events) onPath(event.path);
    },
    { ignore: PARCEL_IGNORE },
  );
  return async () => {
    await subscription.unsubscribe();
  };
}

const BACKENDS = [
  ...(chokidar ? [["chokidar", startChokidar]] : []),
  ["@parcel/watcher", startParcel],
];

// ── scenarios ───────────────────────────────────────────────────────

const SCENARIOS = {
  modify: {
    expected: N,
    churn: (dir) => {
      for (let i = 0; i < N; i += 1) {
        fs.appendFileSync(path.join(dir, noteName(i)), "edit\n");
      }
    },
  },
  create: {
    expected: N,
    vault: false,
    churn: (dir) => {
      for (let i = 0; i < N; i += 1) {
        fs.writeFileSync(path.join(dir, `new-${i}.md`), noteBody(i));
      }
    },
  },
  delete: {
    expected: N,
    churn: (dir) => {
      for (let i = 0; i < N; i += 1) {
        fs.rmSync(path.join(dir, noteName(i)));
      }
    },
  },
  rename: {
    expected: 2 * N,
    churn: (dir) => {
      for (let i = 0; i < N; i += 1) {
        fs.renameSync(path.join(dir, noteName(i)), path.join(dir, `renamed-${i}.md`));
      }
    },
  },
};

async function runScenario(backend, scenarioName) {
  const scenario = SCENARIOS[scenarioName];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lychee-watch-bench-"));
  if (scenario.vault !== false) {
    for (let i = 0; i < N; i += 1) {
      fs.writeFileSync(path.join(dir, noteName(i)), noteBody(i));
    }
  }
  const seen = new Set();
  let callbacks = 0;
  const stop = await backend(dir, (file) => {
    callbacks += 1;
    seen.add(file);
    try {
      sha(fs.readFileSync(file, "utf8"));
    } catch {
      /* deleted */
    }
  });
  await sleep(250);
  const cpuStart = process.cpuUsage();
  const started = Date.now();
  scenario.churn(dir);
  const settled = await waitFor(() => seen.size >= scenario.expected);
  await sleep(QUIET_MS);
  const ms = Date.now() - started;
  const cpu = process.cpuUsage(cpuStart);
  await stop();
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    ms,
    callbacks,
    cpuMs: (cpu.user + cpu.system) / 1000,
    complete: settled,
  };
}

async function runLatency(backend) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lychee-watch-lat-"));
  for (let i = 0; i < 10; i += 1) {
    fs.writeFileSync(path.join(dir, noteName(i)), noteBody(i));
  }
  const hits = [];
  const stop = await backend(dir, (file) => hits.push({ file, at: process.hrtime.bigint() }));
  await sleep(300);
  const target = path.join(dir, noteName(0));
  const samples = [];
  for (let k = 0; k < LATENCY_SAMPLES; k += 1) {
    const before = hits.length;
    const started = process.hrtime.bigint();
    fs.appendFileSync(target, `edit ${k}\n`);
    await waitFor(() => hits.length > before, 5000);
    const hit = hits[hits.length - 1];
    if (hit) samples.push(Number(hit.at - started) / 1e6);
    await sleep(50);
  }
  await stop();
  fs.rmSync(dir, { recursive: true, force: true });
  return stats(samples);
}

// ── main ────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `\nwatcher benchmark — ${N} files, ${ROUNDS} rounds, latency samples ${LATENCY_SAMPLES}\n`,
  );
  const results = new Map();
  const record = (key, value) => {
    if (!results.has(key)) results.set(key, []);
    results.get(key).push(value);
  };

  for (const [backendName, start] of BACKENDS) {
    for (const scenarioName of Object.keys(SCENARIOS)) {
      for (let round = 0; round < ROUNDS; round += 1) {
        const result = await runScenario(start, scenarioName);
        record(`${scenarioName}\u0000${backendName}`, result);
        console.log(
          `${scenarioName.padEnd(7)} ${backendName.padEnd(16)} ` +
            `${String(result.ms).padStart(6)} ms  ${String(result.callbacks).padStart(6)} cb  ` +
            `${result.cpuMs.toFixed(0).padStart(4)} ms cpu` +
            (result.complete ? "" : "  [INCOMPLETE]"),
        );
      }
    }
    const latency = await runLatency(start);
    record(`latency\u0000${backendName}`, latency);
    console.log(
      `latency ${backendName.padEnd(16)} median ${latency.median.toFixed(1)} ms  p95 ${latency.p95.toFixed(1)} ms`,
    );
    console.log();
  }

  console.log("=== median of rounds ===");
  for (const scenarioName of [...Object.keys(SCENARIOS), "latency"]) {
    const row = [];
    for (const [backendName] of BACKENDS) {
      const runs = results.get(`${scenarioName}\u0000${backendName}`) ?? [];
      if (scenarioName === "latency") {
        row.push(`${backendName}: ${stats(runs.map((r) => r.median)).median.toFixed(1)}ms`);
      } else {
        row.push(
          `${backendName}: ${stats(runs.map((r) => r.ms)).median.toFixed(0)}ms / ` +
            `${stats(runs.map((r) => r.cpuMs)).median.toFixed(0)}ms cpu`,
        );
      }
    }
    console.log(`  ${scenarioName.padEnd(7)}  ${row.join("   |   ")}`);
  }
  console.log();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
