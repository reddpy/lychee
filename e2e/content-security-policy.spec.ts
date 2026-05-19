import { test, expect } from './electron-app';

// Verifies the strict packaged-build CSP registered in src/index.ts actually
// enforces what it claims to. Asserts real renderer behavior (fetch throwing,
// securitypolicyviolation events firing), not the CSP string itself — so if
// someone loosens a directive, the test catches it via the changed behavior.
//
// CSP only applies when app.isPackaged. E2E runs the packaged binary, so these
// assertions hold. Probes are inlined per-test (not factored into a helper) to
// avoid Function/eval indirection, which would itself be CSP-relevant.

type Violation = { directive: string; blockedURI: string };

test.describe('Content Security Policy (packaged build)', () => {
  test("connect-src blocks fetch('data:...') from the renderer", async ({ window }) => {
    const result = await window.evaluate(async () => {
      const violations: Violation[] = [];
      const handler = (e: SecurityPolicyViolationEvent) =>
        violations.push({ directive: e.violatedDirective, blockedURI: e.blockedURI });
      document.addEventListener('securitypolicyviolation', handler);
      let fetchThrew = false;
      try {
        await fetch('data:text/plain,blocked');
      } catch {
        fetchThrew = true;
      }
      await new Promise((r) => setTimeout(r, 50));
      document.removeEventListener('securitypolicyviolation', handler);
      return { fetchThrew, violations };
    });
    expect(result.fetchThrew, 'fetch(data:) should throw under connect-src').toBe(true);
    expect(
      result.violations.some((v) => v.directive.startsWith('connect-src')),
      `expected connect-src violation, got: ${JSON.stringify(result.violations)}`,
    ).toBe(true);
  });

  test("connect-src blocks fetch('http://...') (plain HTTP, only https: is allowed)", async ({ window }) => {
    const result = await window.evaluate(async () => {
      const violations: Violation[] = [];
      const handler = (e: SecurityPolicyViolationEvent) =>
        violations.push({ directive: e.violatedDirective, blockedURI: e.blockedURI });
      document.addEventListener('securitypolicyviolation', handler);
      let fetchThrew = false;
      try {
        // TEST-NET-1 reserved IP so we cannot accidentally hit a real host.
        await fetch('http://192.0.2.1/');
      } catch {
        fetchThrew = true;
      }
      await new Promise((r) => setTimeout(r, 50));
      document.removeEventListener('securitypolicyviolation', handler);
      return { fetchThrew, violations };
    });
    expect(result.fetchThrew, 'fetch(http:) should throw under connect-src').toBe(true);
    expect(
      result.violations.some((v) => v.directive.startsWith('connect-src')),
      `expected connect-src violation, got: ${JSON.stringify(result.violations)}`,
    ).toBe(true);
  });

  test("script-src has no 'unsafe-inline' — injected inline <script> does not execute", async ({ window }) => {
    const result = await window.evaluate(async () => {
      const violations: Violation[] = [];
      const handler = (e: SecurityPolicyViolationEvent) =>
        violations.push({ directive: e.violatedDirective, blockedURI: e.blockedURI });
      document.addEventListener('securitypolicyviolation', handler);
      delete (window as unknown as { __cspProbe?: unknown }).__cspProbe;
      const s = document.createElement('script');
      s.textContent = "window.__cspProbe = 'leaked'";
      document.head.appendChild(s);
      await new Promise((r) => setTimeout(r, 50));
      const probeRan = (window as unknown as { __cspProbe?: unknown }).__cspProbe === 'leaked';
      s.remove();
      document.removeEventListener('securitypolicyviolation', handler);
      return { probeRan, violations };
    });
    expect(result.probeRan, 'inline script should be blocked from executing').toBe(false);
    expect(
      result.violations.some((v) => v.directive.startsWith('script-src')),
      `expected script-src violation, got: ${JSON.stringify(result.violations)}`,
    ).toBe(true);
  });

  test("script-src has no 'unsafe-eval' — new Function() throws in the renderer", async ({ window }) => {
    // page.evaluate runs via CDP and bypasses CSP, so the eval has to happen
    // through a path the renderer itself would take: schedule it via setTimeout
    // (the function body is parsed at call time inside the page's main world).
    const evalThrew = await window.evaluate(async () => {
      return await new Promise<boolean>((resolve) => {
        try {
          // String-form setTimeout is parsed and executed by the renderer like
          // eval/Function — blocked when 'unsafe-eval' is absent.
          // eslint-disable-next-line no-implied-eval
          (window as any).setTimeout("(window).__evalProbe = 'leaked'", 0);
          // Give it a tick to fail, then read the probe.
          setTimeout(() => {
            const ran = (window as unknown as { __evalProbe?: unknown }).__evalProbe === 'leaked';
            delete (window as unknown as { __evalProbe?: unknown }).__evalProbe;
            resolve(!ran);
          }, 50);
        } catch {
          resolve(true);
        }
      });
    });
    expect(evalThrew, 'string-form setTimeout (eval-equivalent) should be blocked').toBe(true);
  });

  test("object-src 'none' blocks <object> embeds", async ({ window }) => {
    const result = await window.evaluate(async () => {
      const violations: Violation[] = [];
      const handler = (e: SecurityPolicyViolationEvent) =>
        violations.push({ directive: e.violatedDirective, blockedURI: e.blockedURI });
      document.addEventListener('securitypolicyviolation', handler);
      const obj = document.createElement('object');
      obj.data = 'data:text/html,<p>blocked</p>';
      document.body.appendChild(obj);
      await new Promise((r) => setTimeout(r, 50));
      obj.remove();
      document.removeEventListener('securitypolicyviolation', handler);
      return { violations };
    });
    expect(
      result.violations.some((v) => v.directive.startsWith('object-src')),
      `expected object-src violation, got: ${JSON.stringify(result.violations)}`,
    ).toBe(true);
  });

  test("frame-src 'none' blocks all iframes", async ({ window }) => {
    const result = await window.evaluate(async () => {
      const violations: Violation[] = [];
      const handler = (e: SecurityPolicyViolationEvent) =>
        violations.push({ directive: e.violatedDirective, blockedURI: e.blockedURI });
      document.addEventListener('securitypolicyviolation', handler);
      const frame = document.createElement('iframe');
      frame.src = 'https://attacker.example/';
      document.body.appendChild(frame);
      await new Promise((r) => setTimeout(r, 100));
      frame.remove();
      document.removeEventListener('securitypolicyviolation', handler);
      return { violations };
    });
    expect(
      result.violations.some((v) => v.directive.startsWith('frame-src')),
      `expected frame-src violation, got: ${JSON.stringify(result.violations)}`,
    ).toBe(true);
  });

  test("script-src blocks external HTTPS scripts (only 'self' is allowed)", async ({ window }) => {
    const result = await window.evaluate(async () => {
      const violations: Violation[] = [];
      const handler = (e: SecurityPolicyViolationEvent) =>
        violations.push({ directive: e.violatedDirective, blockedURI: e.blockedURI });
      document.addEventListener('securitypolicyviolation', handler);
      const s = document.createElement('script');
      s.src = 'https://attacker.example/payload.js';
      document.head.appendChild(s);
      await new Promise((r) => setTimeout(r, 100));
      s.remove();
      document.removeEventListener('securitypolicyviolation', handler);
      return { violations };
    });
    expect(
      result.violations.some((v) => v.directive.startsWith('script-src')),
      `expected script-src violation for external HTTPS, got: ${JSON.stringify(result.violations)}`,
    ).toBe(true);
  });

  // ── Positive: deliberate exceptions stay deliberate ───────────────────────

  test("img-src allows lychee-image:// (guards the deliberate exception for stored images)", async ({ window }) => {
    // We don't care if the file resolves — only that CSP doesn't pre-block it.
    // A 404 will fire an `error` event but no `securitypolicyviolation` event.
    const result = await window.evaluate(async () => {
      const violations: Violation[] = [];
      const handler = (e: SecurityPolicyViolationEvent) =>
        violations.push({ directive: e.violatedDirective, blockedURI: e.blockedURI });
      document.addEventListener('securitypolicyviolation', handler);
      const img = document.createElement('img');
      img.src = 'lychee-image://image/csp-probe-nonexistent.png';
      document.body.appendChild(img);
      await new Promise((r) => setTimeout(r, 100));
      img.remove();
      document.removeEventListener('securitypolicyviolation', handler);
      return { violations };
    });
    expect(
      result.violations.filter((v) => v.directive.startsWith('img-src')),
      'lychee-image:// must not trigger an img-src violation',
    ).toEqual([]);
  });

  test("style-src 'unsafe-inline' allows inline styles (Tailwind/Lexical depend on this)", async ({ window }) => {
    const result = await window.evaluate(async () => {
      const violations: Violation[] = [];
      const handler = (e: SecurityPolicyViolationEvent) =>
        violations.push({ directive: e.violatedDirective, blockedURI: e.blockedURI });
      document.addEventListener('securitypolicyviolation', handler);
      const probe = document.createElement('div');
      probe.setAttribute('style', 'color: rgb(1, 2, 3); position: absolute; top: -9999px;');
      document.body.appendChild(probe);
      await new Promise((r) => setTimeout(r, 50));
      const applied = getComputedStyle(probe).color === 'rgb(1, 2, 3)';
      probe.remove();
      document.removeEventListener('securitypolicyviolation', handler);
      return { applied, violations };
    });
    expect(result.applied, 'inline style attribute must apply (unsafe-inline)').toBe(true);
    expect(
      result.violations.filter((v) => v.directive.startsWith('style-src')),
      'inline style attribute must not trigger a style-src violation',
    ).toEqual([]);
  });

  test("base-uri 'self' blocks <base href='https://attacker.example/'>", async ({ window }) => {
    const result = await window.evaluate(async () => {
      const violations: Violation[] = [];
      const handler = (e: SecurityPolicyViolationEvent) =>
        violations.push({ directive: e.violatedDirective, blockedURI: e.blockedURI });
      document.addEventListener('securitypolicyviolation', handler);
      const base = document.createElement('base');
      base.href = 'https://attacker.example/';
      document.head.appendChild(base);
      await new Promise((r) => setTimeout(r, 50));
      base.remove();
      document.removeEventListener('securitypolicyviolation', handler);
      return { violations };
    });
    expect(
      result.violations.some((v) => v.directive.startsWith('base-uri')),
      `expected base-uri violation, got: ${JSON.stringify(result.violations)}`,
    ).toBe(true);
  });
});
