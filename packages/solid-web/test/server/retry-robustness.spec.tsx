/**
 * @jsxImportSource @solidjs/web
 */
// Regression coverage for the SSR stack-overflow diagnosis amplifiers
// (router-free minimal repros). The incident's trigger was a plugin
// dev-resolver bug (fixed in the plugin repo); these pin the core behaviors
// that turned that bug into a process kill:
//
// 1. lazy() re-asked `ctx.resolveAssets(moduleUrl)` on every component
//    re-creation across suspended render passes — dev resolvers do real
//    work per call, so retries multiplied it. Now memoized per request.
// 2. buildAsyncWrap re-wrapped an already-wrapped hole on every retry pass,
//    nesting one runWithOwner closure per re-suspension — a long chain
//    overflowed the stack. Now brand-and-reuse (flat).
// 3. A REAL error surfacing in a retry pass (root hole re-pull, boundary
//    resume) had nothing on the stack to catch it and escaped as an
//    unhandled rejection, killing the host process. Now contained: the
//    render reports through `onError` and winds down — the request fails,
//    the process survives.
import { describe, expect, test } from "vitest";
import { renderToStream, Loading } from "@solidjs/web";
import { lazy, NotReadyError } from "solid-js";

function renderComplete(code: () => any, options: any = {}): Promise<string> {
  return new Promise(resolve => {
    renderToStream(code, options).then(resolve);
  });
}

describe("lazy() asset resolution across suspended passes", () => {
  test("asks the manifest resolver exactly once per moduleUrl per request", async () => {
    const resolved: string[] = [];
    // Function manifest = the dev-resolver shape (may answer async).
    const manifest = (moduleUrl: string) => {
      resolved.push(moduleUrl);
      return Promise.resolve({ js: ["/assets/mod.js"], css: [] });
    };
    const Mod = () => <b>mod-content</b>;
    const LazyMod = lazy(() => Promise.resolve({ default: Mod }), "./Mod.tsx");
    // Re-suspends the boundary twice, so its discovery pass runs three
    // times and <LazyMod /> is re-created on each — the exact re-creation
    // pattern that multiplied resolver work.
    let passes = 0;
    const Gate = () => {
      if (passes < 2) {
        passes++;
        throw new NotReadyError(Promise.resolve() as any);
      }
      return <i>gated</i>;
    };

    const html = await renderComplete(
      () => (
        <Loading fallback={<span>waiting</span>}>
          <LazyMod />
          <Gate />
        </Loading>
      ),
      { manifest }
    );

    expect(html).toContain("mod-content");
    expect(html).toContain("gated");
    expect(passes).toBe(2);
    expect(resolved).toEqual(["./Mod.tsx"]);
  });
});

describe("retry wrapper flattening", () => {
  test("a hole that re-suspends thousands of times completes instead of overflowing the stack", async () => {
    // Each retry pass used to add one runWithOwner layer around the hole;
    // by the Nth pass invoking it cost O(N) stack frames. 6000 passes
    // overflowed the default stack before the fix and are flat after it.
    const N = 6000;
    let attempts = 0;
    const html = await renderComplete(() => (
      <Loading fallback={<span>deep-wait</span>}>
        <div>
          {() => {
            if (attempts < N) {
              attempts++;
              throw new NotReadyError(Promise.resolve() as any);
            }
            return "deep-done";
          }}
        </div>
      </Loading>
    ));
    expect(attempts).toBe(N);
    expect(html).toContain("deep-done");
  }, 30_000);
});

describe("real errors in retry passes fail the request, not the process", () => {
  test("root hole (no boundary): retry error routes to onError and the render settles", async () => {
    let first = true;
    const errors: any[] = [];
    const html = await renderComplete(
      () => (
        <div>
          {() => {
            if (first) {
              first = false;
              throw new NotReadyError(Promise.resolve() as any);
            }
            throw new Error("boom on retry");
          }}
        </div>
      ),
      { onError: (err: any) => errors.push(err) }
    );
    // The render wound down (abandon) — the await settling at all is the
    // containment: before the fix this throw escaped the flush microtask as
    // an unhandled rejection.
    expect(errors.map(e => e?.message)).toContain("boom on retry");
    expect(html).not.toContain("boom on retry");
  });

  test("boundary resume: retry error settles the fragment and the render completes", async () => {
    let first = true;
    const html = await renderComplete(() => (
      <Loading fallback={<span>fb</span>}>
        <div>
          {() => {
            if (first) {
              first = false;
              throw new NotReadyError(Promise.resolve() as any);
            }
            throw new Error("boundary boom");
          }}
        </div>
      </Loading>
    ));
    // The boundary settled through its error protocol: the fragment slot
    // rejects with the error (serialized for the client's boundary error
    // path) and the document still completes — the async resume loop leaked
    // nothing to the process. The render settling at all is the containment.
    expect(html).toContain('new Error("boundary boom")');
  });
});
