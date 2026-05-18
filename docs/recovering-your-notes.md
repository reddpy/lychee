# Recovering your notes

If Lychee won't open after an update, this guide will help you get back in.

## What happened?

Every time Lychee updates, it makes a backup of your notes just before applying the changes. If the update goes wrong and the app won't open, you can swap your current notes file for the backup — like opening a previous version of a document.

> **Before you start:** Restoring a backup means any notes or edits you made *after* the backup was created will be lost. The backup is taken right before each update, so in most cases this is only a few seconds of work — but if you've been using Lychee for a while since the last update, be aware.

---

## Option 1: Do it yourself

It takes about two minutes. You don't need to be technical — you just need to rename a couple of files.

### Step 1 — Quit Lychee completely

Make sure Lychee isn't running. On macOS, right-click the icon in the Dock and choose **Quit** (just closing the window isn't enough).

### Step 2 — Open the Lychee folder

This is the folder where Lychee keeps your notes. The location depends on your operating system:

**macOS**
- Open Finder.
- In the menu bar, click **Go → Go to Folder…** (or press <kbd>⇧⌘G</kbd>).
- Paste this and press Enter:
  ```
  ~/Library/Application Support/Lychee/
  ```

**Windows**
- Press <kbd>Win</kbd> + <kbd>R</kbd> to open the Run dialog.
- Paste this and press Enter:
  ```
  %APPDATA%\Lychee\
  ```

**Linux**
- Open your file manager and navigate to:
  ```
  ~/.config/Lychee/
  ```

### Step 3 — Find the most recent backup

Inside the folder, you'll see a file called `lychee.sqlite3` (your current notes) and one or more files named like:

- `lychee.sqlite3.bak-v1`
- `lychee.sqlite3.bak-v2`
- `lychee.sqlite3.bak-v3`
- *(and so on)*

**Pick the one with the highest number.** That's your most recent backup.

### Step 4 — Swap the files

1. Rename `lychee.sqlite3` to `lychee.sqlite3.broken`.
   *(Don't delete it — keep it around in case it's useful for support.)*
2. Rename the highest-numbered backup (e.g. `lychee.sqlite3.bak-v7`) to `lychee.sqlite3`.

### Step 5 — Open Lychee

Launch Lychee again. You should be back in.

---

## Option 2: Hand it to your AI assistant

If you use Claude Code, Cursor, ChatGPT with shell tools, or any other AI coding agent, you can copy the prompt below and paste it in. The agent will do the file moves for you.

> Lychee (an Electron notes app on my machine) won't open after an update. Please restore the most recent pre-update backup of its database.
>
> 1. Confirm no Lychee process is running before touching any files.
> 2. The Lychee data folder is:
>    - macOS: `~/Library/Application Support/Lychee/`
>    - Windows: `%APPDATA%\Lychee\`
>    - Linux: `~/.config/Lychee/`
> 3. In that folder, list files matching `lychee.sqlite3.bak-v*` and identify the one with the highest version number — that's the most recent backup.
> 4. Rename the current `lychee.sqlite3` to `lychee.sqlite3.broken` so it's preserved for debugging. **Do not delete it.**
> 5. Copy (do not move) the highest-numbered backup file to `lychee.sqlite3`, so the original backup file is preserved too.
> 6. Tell me which backup version was restored, and remind me that any notes made after that backup are no longer in the active database.

---

## Still stuck?

Open an issue at [github.com/reddpy/lychee/issues](https://github.com/reddpy/lychee/issues) and include the `lychee.sqlite3.broken` file if you saved one — it helps figure out what went wrong.
