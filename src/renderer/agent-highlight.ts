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

/** Content fingerprint of a block, independent of its node key. */
function signature(node: LexicalNode): string {
  const text = node.getTextContent();
  try {
    return `${node.getType()}\u0000${text}\u0000${JSON.stringify(node.exportJSON())}`;
  } catch {
    return `${node.getType()}\u0000${text}`;
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
