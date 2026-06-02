# Releasing Lychee

Lychee ships signed builds for macOS, Windows, and Linux, and delivers updates
in-app via [update.electronjs.org](https://update.electronjs.org) (mac/win) and
a notify-only banner (Linux). This doc is the end-to-end release procedure.

## TL;DR

```bash
pnpm version prerelease   # 0.1.0-alpha.1 → 0.1.0-alpha.2 (bumps package.json, commits, tags)
git push --follow-tags    # pushes the commit + tag; the v* tag triggers the release workflows
```

That's it. The release workflow builds and signs each platform in parallel,
then publishes a single GitHub Release with all platform assets. Within
~15 minutes, installed apps on the previous version see the update.

## The one rule: `package.json` version is the single source of truth

The number in `package.json` `"version"` is the **only** place the app version
is defined. Everything else derives from it:

- `app.getVersion()` reads it → shown in **Settings → About**.
- The git **tag** must match it (`pnpm version` guarantees this).
- `update.electronjs.org` compares the running app's version (from
  `package.json`) against the latest GitHub **release tag** to decide whether to
  offer an update (mac/win).
- The Linux poll (`src/main/updater.ts`) compares `app.getVersion()` against
  release tags via `semver`.

If the tag and `package.json` disagree, auto-update misbehaves (the app either
never sees the update or misreports its version). **Always bump with
`pnpm version`** rather than hand-editing — it keeps the commit, the tag, and
`package.json` locked together.

## Choosing the bump

`pnpm version <type>` (same semantics as `npm version`):

| Command | `0.1.0-alpha.1` becomes | Use when |
| --- | --- | --- |
| `pnpm version prerelease` | `0.1.0-alpha.2` | iterating during alpha (default for now) |
| `pnpm version prepatch`   | `0.1.1-alpha.0` | starting a new prerelease line off a patch |
| `pnpm version patch`      | `0.1.0`         | cutting the first stable from an alpha |
| `pnpm version minor`      | `0.2.0`         | backwards-compatible features |
| `pnpm version major`      | `1.0.0`         | breaking changes |

The created tag is prefixed with `v` (e.g. `v0.1.0-alpha.2`); `package.json`
itself stays unprefixed (`0.1.0-alpha.2`). Both the updater and
update.electronjs.org tolerate the `v` prefix.

> **Prereleases and update.electronjs.org:** the hosted service serves the
> latest GitHub release. If you mark releases as *prerelease* in GitHub, the
> mac/win auto-updater may not pick them up (it prefers stable releases). The
> Linux poll *does* include prereleases. For an alpha you want everyone updating
> on, publish releases as normal (not flagged prerelease), or revisit this once
> you cut stable.

## What happens on a `v*` tag push

`.github/workflows/release.yml` triggers on `v*` tags and fans out to three
reusable build workflows in parallel; a `publish-release` job runs once all
three succeed:

| Workflow / Job | Runner | Produces | Signing |
| --- | --- | --- | --- |
| `.github/workflows/build-macos.yml` | macOS | `.dmg`, `.zip` (arm64) | Developer ID + notarization |
| `.github/workflows/build-windows.yml` | Windows | `Setup.exe`, `.nupkg`, `RELEASES` | Azure Trusted Signing |
| `.github/workflows/build-linux.yml` | Ubuntu | `.deb`, `.rpm` | none (notify-only) |
| `publish-release` (in `release.yml`) | Ubuntu | the GitHub Release | n/a |

Each build workflow runs `pnpm make`, verifies signatures, and uploads its
outputs as workflow artifacts. `publish-release` downloads all three artifacts
and runs `gh release create` exactly once. If any build fails, no Release is
created — preventing partial publishes.

### Manually building a single platform

For testing a packaging change without cutting a tag, each `build-*.yml` is
also independently dispatchable. Go to **Actions → Build macOS** (or **Build
Windows** / **Build Linux**) → **Run workflow**. The run finishes when that
single platform finishes, and the artifact is downloadable from the run
summary immediately. No release is created.

This is the right path for iterating on packaging — a single-platform dispatch
takes only as long as that platform's build, with no waiting on other platforms
or any orchestrator job to resolve before the artifact appears in the UI.

### Dispatching the full pipeline as a dry-run

**Actions → Release → Run workflow** fans out to all three `build-*.yml`
workflows in a single parent run — useful for verifying end-to-end pipeline
health (matrix of all platforms, signing wiring, etc.) without cutting a tag.
`publish-release` is gated by `if: startsWith(github.ref, 'refs/tags/v')`, so a
manual dispatch from a branch builds all three platforms but creates no GitHub
Release; artifacts land on the run summary once the slowest build finishes.

### Why these specific assets matter

The auto-updater is picky about what it consumes:

- **macOS** (Squirrel.Mac via update.electronjs.org) needs the **`.zip`** of the
  app. The `.dmg` is for first-time human downloads.
- **Windows** (Squirrel.Windows) needs **`RELEASES` + `.nupkg` + `Setup.exe`**
  together. Missing any one breaks the update feed.
- **Linux** has no auto-update; the app's About pane just links users to the
  releases page to download the **`.deb`/`.rpm`** manually.

## Required GitHub secrets

These must be configured in the repo (Settings → Secrets and variables →
Actions) for signing to succeed:

**macOS** — `MACOS_CERT_P12_BASE64`, `MACOS_CERT_PASSWORD`, `APPLE_ID`,
`APPLE_APP_PASSWORD`, `APPLE_TEAM_ID`.

**Windows** (Azure Trusted Signing) — `AZURE_CODE_SIGNING_ACCOUNT`,
`AZURE_CERT_PROFILE`, `AZURE_ENDPOINT`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
`AZURE_CLIENT_SECRET`.

**Linux** — none.

## Verifying a release

1. The GitHub Release for the tag exists and carries: `*.dmg`, `*.zip` (mac),
   `*Setup.exe`, `*.nupkg`, `RELEASES` (win), `*.deb`, `*.rpm` (linux).
2. The release is **not** flagged as a draft (the updater ignores drafts).
3. On a machine running the previous version, leave the app open ~15 min:
   - **mac/win** download in the background; **Settings → About** then shows
     “… is ready to install” with **Restart & Update**.
   - **Linux** shows “… is available” with a **Download** button linking to the
     releases page.

### Checking the update feed directly (no install needed)

You can confirm update.electronjs.org sees a release without installing anything.
**The path is `platform-arch`, not just `platform`** — the app requests
`darwin-arm64`, so checking plain `/darwin/` will mislead you (it looks for an
Intel build we don't ship and 404s even when the arm64 zip is present):

```bash
# Ask "is there something newer than <version>?"
curl -s https://update.electronjs.org/reddpy/lychee/darwin-arm64/<version>   # Apple Silicon
curl -s https://update.electronjs.org/reddpy/lychee/win32/<version>/RELEASES # Windows
#   200 + JSON/RELEASES body → update available
#   204 No Content           → already on the latest
#   404                       → wrong path/arch, missing zip, or release flagged prerelease/draft
```

The mac zip must match `.*-(mac|darwin|osx).*\.zip` — our Forge output
(`Lychee-darwin-arm64-<version>.zip`) satisfies this. update.electronjs.org caches
for a few minutes, so give a freshly-published release a moment before checking.

## Local build sanity check (no publish)

```bash
pnpm make          # builds installers for the current OS into out/make/
```

Signing only activates when the relevant env vars are present, so local `make`
produces unsigned artifacts — fine for smoke-testing packaging, not for release.

## Notes

- The updater is intentionally **inert** in dev (`pnpm start`) and E2E builds —
  About shows “Updates are delivered automatically in installed builds.” You can
  only exercise the real update flow from a signed, installed build.
- After packaging locally (`pnpm make` / `E2E=1 pnpm run package`),
  `better-sqlite3` is rebuilt against Electron's ABI; run `pnpm test` (its
  `pretest` rebuilds for Node) before trusting backend test results.
