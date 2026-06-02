// E2E-only crash injector — verifies the ErrorBoundary wrappers are actually
// wired into the app (a regression deleting a wrapper passes every unit test, so
// it needs an integration guard).
//
// This entire module is excluded from production bundles: App.tsx loads it via a
// require() inside a `__LYCHEE_E2E__`-guarded branch, and webpack drops a
// require() in a statically-`false` branch — so neither this code nor its
// strings are bundled in prod (verified by grepping app.asar). Only the E2E
// build (E2E=1) keeps it. A test arms a crash by setting window.__lycheeE2ECrash
// to { scope, mode } and reloading (or re-rendering); the matching probe throws
// during render so the enclosing ErrorBoundary with that scope trips. `mode`
// lets a test exercise edge cases (falsy throws, oversized messages, etc.).

type E2ECrashSpec = {
  scope: string;
  mode?: "error" | "null" | "string" | "long";
};

export function E2ECrashProbe({ scope }: { scope: string }): null {
  const spec = (globalThis as { __lycheeE2ECrash?: E2ECrashSpec })
    .__lycheeE2ECrash;
  if (spec?.scope !== scope) return null;
  switch (spec.mode) {
    case "null":
      throw null;
    case "string":
      throw "E2E string-mode failure";
    case "long":
      throw new Error("LONG-" + "x".repeat(12000));
    default:
      throw new Error(`E2E crash probe (${scope})`);
  }
}
