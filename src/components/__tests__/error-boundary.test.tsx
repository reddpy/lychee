// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "../error-boundary";

// Renders without @testing-library: createRoot + React.act is enough to drive
// the boundary and assert on the resulting DOM. console.error is silenced
// because both React and the boundary log caught render errors by design.

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render(ui: React.ReactElement) {
  act(() => root.render(ui));
}

const FALLBACK_TEXT = "Something went wrong";

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary scope="test">
        <div>healthy content</div>
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain("healthy content");
    expect(container.textContent).not.toContain(FALLBACK_TEXT);
  });

  it("shows the fallback and the message when a child throws an Error", () => {
    function Boom(): React.ReactElement {
      throw new Error("kaboom message");
    }
    render(
      <ErrorBoundary scope="test">
        <Boom />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain(FALLBACK_TEXT);
    expect(container.textContent).toContain("kaboom message");
    expect(container.querySelector("button")?.textContent).toBe("Reload");
  });

  // Regression: a falsy thrown value (`throw null`) must NOT slip through the
  // boundary and unmount the tree to a blank screen.
  it("shows the fallback even when a child throws a falsy value", () => {
    function ThrowNull(): React.ReactElement {
      throw null;
    }
    render(
      <ErrorBoundary scope="test">
        <ThrowNull />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain(FALLBACK_TEXT);
    // No Error → no message box, but the recovery UI is still present.
    expect(container.querySelector("button")?.textContent).toBe("Reload");
  });

  it("forwards the caught error to the reporter (console.error)", () => {
    function Boom(): React.ReactElement {
      throw new Error("reported");
    }
    render(
      <ErrorBoundary scope="sidebar">
        <Boom />
      </ErrorBoundary>,
    );
    const calls = (console.error as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(
      calls.some((args) =>
        args.some(
          (a) => typeof a === "string" && a.includes("ErrorBoundary:sidebar"),
        ),
      ),
    ).toBe(true);
  });

  // Regression: a crash scoped to one input must recover when resetKeys change,
  // instead of staying stuck on the fallback until a full reload.
  it("recovers when resetKeys change", () => {
    let shouldThrow = true;
    function Conditional(): React.ReactElement {
      if (shouldThrow) throw new Error("doc-specific crash");
      return <div>recovered content</div>;
    }

    render(
      <ErrorBoundary scope="editor" resetKeys={["doc-a"]}>
        <Conditional />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain(FALLBACK_TEXT);

    // Navigate to a different "doc" and stop throwing.
    shouldThrow = false;
    render(
      <ErrorBoundary scope="editor" resetKeys={["doc-b"]}>
        <Conditional />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain("recovered content");
    expect(container.textContent).not.toContain(FALLBACK_TEXT);
  });

  it("stays on the fallback when resetKeys are unchanged", () => {
    let shouldThrow = true;
    function Conditional(): React.ReactElement {
      if (shouldThrow) throw new Error("crash");
      return <div>recovered content</div>;
    }

    render(
      <ErrorBoundary scope="editor" resetKeys={["same"]}>
        <Conditional />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain(FALLBACK_TEXT);

    // Even though the child would now succeed, an unchanged key must not reset.
    shouldThrow = false;
    render(
      <ErrorBoundary scope="editor" resetKeys={["same"]}>
        <Conditional />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain(FALLBACK_TEXT);
    expect(container.textContent).not.toContain("recovered content");
  });

  // The boundary must hold for ANY thrown value, not just Error/null — keying
  // off the value's truthiness (the original bug) would let several of these
  // through to a blank screen.
  it.each<[string, () => never]>([
    ["null", () => { throw null; }],
    ["undefined", () => { throw undefined; }],
    ["empty string", () => { throw ""; }],
    ["zero", () => { throw 0; }],
    ["false", () => { throw false; }],
    ["a plain object", () => { throw { code: 1 }; }],
  ])("shows the fallback when a child throws %s", (_label, doThrow) => {
    function Boom(): React.ReactElement {
      doThrow();
      throw new Error("unreachable: doThrow always throws");
    }
    render(
      <ErrorBoundary scope="test">
        <Boom />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain(FALLBACK_TEXT);
    expect(container.querySelector("button")?.textContent).toBe("Reload");
  });

  it("renders a thrown string as the message", () => {
    function Boom(): React.ReactElement {
      throw "raw string failure";
    }
    render(
      <ErrorBoundary scope="test">
        <Boom />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain("raw string failure");
  });

  it("marks the fallback with role=alert for assistive tech", () => {
    function Boom(): React.ReactElement {
      throw new Error("x");
    }
    render(
      <ErrorBoundary scope="test">
        <Boom />
      </ErrorBoundary>,
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("renders a custom fallback and its reset callback clears the boundary", () => {
    let shouldThrow = true;
    function Conditional(): React.ReactElement {
      if (shouldThrow) throw new Error("crash");
      return <div>recovered content</div>;
    }
    const fallback = (_error: unknown, reset: () => void) => (
      <div>
        <span>custom fallback ui</span>
        <button onClick={reset}>Try again</button>
      </div>
    );

    render(
      <ErrorBoundary scope="test" fallback={fallback}>
        <Conditional />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain("custom fallback ui");
    // Default fallback must NOT be used when a custom one is supplied.
    expect(container.textContent).not.toContain(FALLBACK_TEXT);

    shouldThrow = false;
    act(() => {
      container.querySelector("button")?.click();
    });
    expect(container.textContent).toContain("recovered content");
    expect(container.textContent).not.toContain("custom fallback ui");
  });

  it("resets when the number of resetKeys changes (length change)", () => {
    let shouldThrow = true;
    function Conditional(): React.ReactElement {
      if (shouldThrow) throw new Error("crash");
      return <div>recovered content</div>;
    }

    render(
      <ErrorBoundary scope="editor" resetKeys={["a"]}>
        <Conditional />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain(FALLBACK_TEXT);

    shouldThrow = false;
    render(
      <ErrorBoundary scope="editor" resetKeys={["a", "b"]}>
        <Conditional />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain("recovered content");
  });

  // resetKeys only recovers if the underlying cause is gone; a persistent crash
  // must re-trip the boundary, not get papered over.
  it("re-trips when the child still throws after resetKeys change", () => {
    function Boom(): React.ReactElement {
      throw new Error("persistent crash");
    }

    render(
      <ErrorBoundary scope="editor" resetKeys={["a"]}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain(FALLBACK_TEXT);

    render(
      <ErrorBoundary scope="editor" resetKeys={["b"]}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain(FALLBACK_TEXT);
    expect(container.textContent).toContain("persistent crash");
  });
});
