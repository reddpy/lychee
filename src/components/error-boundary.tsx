import React from "react";

// Forward an uncaught render error to the crash reporter. The reporter itself
// is not built yet (see issue #119 follow-up); until it lands we at least log
// to the console so the error survives in DevTools / packaged logs. Keep this
// as the single choke point so wiring up a real reporter is a one-line change.
function reportRenderError(
  scope: string,
  error: unknown,
  info: React.ErrorInfo,
): void {
  console.error(`[ErrorBoundary:${scope}] uncaught render error`, error, info);
}

/** Extract a human-readable message from an arbitrary thrown value. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

type ErrorBoundaryProps = {
  /** Identifies which boundary tripped, for logs and the crash reporter. */
  scope: string;
  children: React.ReactNode;
  /**
   * When any value in this array changes (by identity), a tripped boundary
   * clears itself and re-renders its children. Use it so a crash scoped to one
   * input (e.g. the active document) recovers when that input changes, instead
   * of staying stuck on the fallback until a full reload.
   */
  resetKeys?: readonly unknown[];
  /**
   * Custom fallback. Receives the caught value and a reset callback that clears
   * the boundary so React re-attempts the subtree. Defaults to the full-window
   * "Something went wrong" screen.
   */
  fallback?: (error: unknown, reset: () => void) => React.ReactNode;
};

type ErrorBoundaryState = {
  // Tracked separately from `error` because a thrown value can be falsy
  // (`throw null`, `throw ""`); keying off the value alone would let those
  // slip through and unmount the tree to a blank screen.
  hasError: boolean;
  error: unknown;
  prevResetKeys: readonly unknown[];
};

function resetKeysChanged(
  a: readonly unknown[],
  b: readonly unknown[],
): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return true;
  }
  return false;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    prevResetKeys: this.props.resetKeys ?? [],
  };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    const next = props.resetKeys ?? [];
    if (!resetKeysChanged(state.prevResetKeys, next)) return null;
    // Keys changed: always record them, and clear a tripped boundary so the
    // subtree gets another attempt.
    return state.hasError
      ? { hasError: false, error: null, prevResetKeys: next }
      : { prevResetKeys: next };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    reportRenderError(this.props.scope, error, info);
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(this.state.error, this.reset);
    }

    return <DefaultFallback message={messageOf(this.state.error)} />;
  }
}

/** Full-window recovery screen used when no custom fallback is supplied. */
function DefaultFallback({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex h-full w-full flex-col items-center justify-center gap-5 overflow-auto bg-[hsl(var(--background))] p-8 text-center select-none"
    >
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-lg font-medium text-[hsl(var(--foreground))]">
          Something went wrong
        </h1>
        <p className="max-w-md text-sm text-[hsl(var(--muted-foreground))]">
          Lychee hit an unexpected error and couldn&apos;t keep going. Reloading
          usually fixes it — your notes are saved.
        </p>
      </div>
      {message ? (
        <pre className="max-h-32 max-w-md overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-2 text-left text-xs whitespace-pre-wrap text-[hsl(var(--muted-foreground))]">
          {message}
        </pre>
      ) : null}
      <button
        type="button"
        onClick={() => location.reload()}
        className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90"
      >
        Reload
      </button>
    </div>
  );
}
