// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DragOverlayItem } from "../sidebar/drag-overlay-item";
import { NEW_NOTE_TITLE } from "../../shared/note-title";
import type { DocumentRow } from "../../shared/documents";

// End-to-end coverage that a real note-title display surface renders the shared
// fallback (not a hardcoded "Untitled"/"New Note"). DragOverlayItem is the
// simplest consumer — pure, prop-driven, no store/DnD context — so it stands in
// for the wiring every list/tab/breadcrumb surface now shares via
// displayNoteTitle. The fallback logic itself is unit-tested in
// shared/note-title.test.ts.

function makeDoc(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: "doc-1",
    title: "",
    content: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    parentId: null,
    emoji: null,
    deletedAt: null,
    sortOrder: 0,
    metadata: {},
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(ui: React.ReactElement) {
  act(() => root.render(ui));
}

describe("DragOverlayItem note-title display", () => {
  it("renders the real title when present", () => {
    render(<DragOverlayItem doc={makeDoc({ title: "Tokyo Trip" })} />);
    expect(container.textContent).toContain("Tokyo Trip");
    expect(container.textContent).not.toContain(NEW_NOTE_TITLE);
  });

  it("renders the canonical fallback for an empty title (the reported bug)", () => {
    render(<DragOverlayItem doc={makeDoc({ title: "" })} />);
    expect(container.textContent).toContain(NEW_NOTE_TITLE);
    expect(container.textContent).not.toContain("Untitled");
  });

  it("renders the canonical fallback for the legacy Untitled sentinel", () => {
    render(<DragOverlayItem doc={makeDoc({ title: "Untitled" })} />);
    expect(container.textContent).toContain(NEW_NOTE_TITLE);
  });
});
