import type { EditorState, LexicalNode } from "lexical";
import { $getRoot } from "lexical";

/**
 * Keys of the top-level blocks that were added or changed between two editor
 * states, computed by content (not node key).
 *
 * This matters because a live agent edit is applied as a full document replace:
 * the whole body is cleared and re-imported, so every block gets a brand-new
 * node key even when its content is untouched. A key diff would therefore flag
 * the entire note; a content diff (LCS on block signatures) flags only the
 * blocks whose content actually changed.
 */

/**
 * Per-device / transient fields that must not count as a content change.
 * Decorator nodes (images, bookmarks, media) carry these; after a full replace
 * they can differ from the previous node even when the visible content is
 * identical, which would falsely flag unchanged media as changed.
 */
const VOLATILE_KEYS = new Set(["loading", "hydrationAttempted", "autoResolve", "src", "__src"]);

/** Content fingerprint of a block, independent of its node key. */
function signature(node: LexicalNode): string {
  const type = node.getType();
  try {
    const json = JSON.stringify(node.exportJSON(), (key, value) =>
      VOLATILE_KEYS.has(key) ? undefined : value,
    );
    // Text content is always included so two decorators with the same JSON
    // still compare by what they render.
    return `${type}\u0000${node.getTextContent()}\u0000${json}`;
  } catch {
    return `${type}\u0000${node.getTextContent()}`;
  }
}

export function changedTopLevelKeys(prev: EditorState, next: EditorState): string[] {
  const before = prev.read(() => $getRoot().getChildren().map(signature));
  const after = next.read(() =>
    $getRoot()
      .getChildren()
      .map((node) => ({ key: node.getKey(), sig: signature(node) })),
  );

  // Longest common subsequence of block signatures; matched blocks are unchanged.
  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] =
        before[i] === after[j].sig
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const matched = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j].sig) {
      matched[j] = true;
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  const changed: string[] = [];
  for (let k = 0; k < m; k += 1) {
    if (!matched[k]) changed.push(after[k].key);
  }
  return changed;
}
