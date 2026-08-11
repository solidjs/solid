/**
 * @jsxImportSource @solidjs/web
 */
// Regression coverage for the beta.33 dev-streaming livelock (router-free
// minimal repro of the fullstack template's param-route-under-layout hang).
//
// The shape: a lazy component is RE-CREATED on every suspended render pass —
// a layout whose compute re-runs re-invokes `createComponent(LazyChild)`
// fresh each retry (the router's outlet does exactly this through its
// children/flatten chain). With an ASYNC asset resolver (the dev-server
// manifest shape), every re-creation armed a fresh `assetsPending` gate even
// after the module and its assets had settled:
//
//   - the per-request `_lazyAssets` cache memoized the resolver's PROMISE
//     forever, so each new wrap chained `.then` off an already-resolved
//     promise — pending at the render memo's compute, settled one microtask
//     later;
//   - the moduleUrl-less path chained `p.then(...)` per creation with the
//     same post-settle geometry.
//
// Each pass threw NotReadyError on a gate that resolved immediately after,
// so the boundary resume loop re-rendered forever on the microtask queue —
// timers starved, ids and serializer state grew without bound, and the dev
// server died on heap exhaustion (~30s per request). Production manifests
// answer synchronously and never enter the async branch, which is why only
// dev streaming SSR fell over.
//
// The fix makes both gates settle structurally: the cache entry upgrades to
// the resolved VALUE when the resolver settles, and a re-creation after the
// module import settled reads `$$moduleUrl` synchronously instead of
// chaining another promise hop. These tests bound the re-creation loop with
// a give-up branch so the PRE-fix behavior is a clean assertion failure
// (sentinel content + runaway creation count) instead of a suite hang.
import { describe, expect, test } from "vitest";
import { renderToStream, Loading } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { lazy } from "solid-js";

function renderComplete(code: () => any, options: any = {}): Promise<string> {
  return new Promise(resolve => {
    renderToStream(code, options).then(resolve);
  });
}

// Async resolver = the dev-server manifest shape (answers from the live
// module graph on a later tick).
const asyncManifest = (moduleUrl: string) =>
  Promise.resolve({ js: [`/assets/${moduleUrl.replace(/[^a-z]/gi, "")}.js`], css: [] });

// A hole that re-creates `make()`'s component on every retry pass and pulls
// it in the same run, so a NotReady from the fresh creation re-suspends the
// pass — the layout re-render pattern, bounded so non-convergence terminates.
function recreatingHole(make: () => JSX.Element, counter: { creations: number }): JSX.Element {
  return (() => {
    if (++counter.creations > 60) return "gave-up-livelock";
    const el = make() as unknown as () => any;
    return el();
  }) as unknown as JSX.Element;
}

describe("lazy() converges across re-creations with an async asset resolver", () => {
  test("moduleUrl-less lazy ($$moduleUrl module) settles instead of livelocking", async () => {
    const Child = lazy(() =>
      Promise.resolve({
        default: () => <b>deferred-child</b>,
        $$moduleUrl: "./Child.tsx"
      } as any)
    );
    const counter = { creations: 0 };

    const html = await renderComplete(
      () => (
        <Loading fallback={<span>waiting</span>}>
          <div>
            {recreatingHole(
              () => (
                <Child />
              ),
              counter
            )}
          </div>
        </Loading>
      ),
      { manifest: asyncManifest }
    );

    // Pre-fix: every post-settle re-creation threw NotReadyError on a fresh
    // one-microtask gate, so the hole never resolved — the bound tripped and
    // the sentinel shipped after 60 wasted passes.
    expect(html).toContain("deferred-child");
    expect(html).not.toContain("gave-up-livelock");
    // Convergence budget: module settle + resolver settle + success. A few
    // passes are legitimate; dozens means the gates regressed.
    expect(counter.creations).toBeLessThan(10);
  });

  test("explicit-moduleUrl lazy settles instead of livelocking", async () => {
    const Child = lazy(() => Promise.resolve({ default: () => <b>keyed-child</b> }), "./Keyed.tsx");
    const counter = { creations: 0 };

    const html = await renderComplete(
      () => (
        <Loading fallback={<span>waiting</span>}>
          <div>
            {recreatingHole(
              () => (
                <Child />
              ),
              counter
            )}
          </div>
        </Loading>
      ),
      { manifest: asyncManifest }
    );

    expect(html).toContain("keyed-child");
    expect(html).not.toContain("gave-up-livelock");
    expect(counter.creations).toBeLessThan(10);
  });
});
