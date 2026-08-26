/**
 * @jsxImportSource @solidjs/web
 */
// #3068: reading a property of a PENDING projection proxy in a component
// body must converge, not hang the stream. An async generator's first yield
// is always at least a microtask away, so the body-time read throws
// NotReadyError and the component becomes a retry hole. The retry re-runs
// the whole body — and `createProjection` used to allocate a FRESH pending
// proxy (new owner child, new deferred, new serialized promise) on every
// pass, so the read could never succeed: 0 bytes flushed, one core pinned,
// unbounded blockingPromises growth. The fix is the same slot memory that
// converges memo retries (#3003): owner ids are stable across re-runs, so a
// re-created projection at a pending slot joins the in-flight instance and
// at a settled slot adopts its answer.
import { describe, expect, test } from "vitest";
import { renderToStream, Loading } from "@solidjs/web";
import { createProjection, createStore } from "solid-js";

function renderComplete(code: () => any, options: any = {}): Promise<string> {
  return new Promise(resolve => {
    renderToStream(code, options).then(resolve);
  });
}

describe("body-time property read of a pending projection (#3068)", () => {
  test("root hole: the render converges and streams the settled value", async () => {
    let runs = 0;
    const App = () => {
      const state = createProjection<{ items: string[] }>(
        async function* (draft) {
          runs++;
          await Promise.resolve();
          draft.items = ["a", "b"];
          yield;
        },
        { items: [] }
      );
      // The reported trigger: derive a value from the store in the body.
      // The proxy is pending here — this read throws NotReadyError.
      const value = { items: state.items };
      return <div>{value.items.join(",")}</div>;
    };
    // Call-expression child: the compiler wraps it in _$scope, reserving one
    // id slot so retry passes re-derive the same owner ids (the contract the
    // slot memory keys on).
    const renderApp = () => <App />;

    const html = await renderComplete(() => <main>{renderApp()}</main>);
    expect(html).toContain("a,b");
    // The retry pass re-creates the projection at the same slot; it must
    // join/adopt the first instance, not start the generator again.
    expect(runs).toBe(1);
  }, 5_000);

  test("under a Loading boundary: fragment resume converges the same way", async () => {
    const App = () => {
      const state = createProjection<{ n: number }>(
        async function* (draft) {
          await Promise.resolve();
          draft.n = 42;
          yield;
        },
        { n: 0 }
      );
      const doubled = state.n * 2; // body-time read of the pending proxy
      return <span>doubled:{doubled}</span>;
    };
    const renderApp = () => <App />;

    const html = await renderComplete(() => (
      <main>
        <Loading fallback={<i>waiting</i>}>{renderApp()}</Loading>
      </main>
    ));
    // Hydration markers may split the text (`doubled:<!--$-->84<!--/-->`).
    expect(html).toMatch(/doubled:(<!--\$-->)?84/);
  }, 5_000);

  test("createStore(asyncGen) routes through the same slot memory", async () => {
    const App = () => {
      const [state] = createStore<{ label: string }>(
        async function* (draft) {
          await Promise.resolve();
          draft.label = "ready";
          yield;
        },
        { label: "seed" }
      );
      const snapshot = state.label; // body-time read
      return <p>{snapshot}</p>;
    };
    const renderApp = () => <App />;

    const html = await renderComplete(() => <main>{renderApp()}</main>);
    expect(html).toContain("ready");
  }, 5_000);

  test("promise-form projection converges too", async () => {
    // Same class, promise branch: the derive awaits before returning a
    // replacement, so the proxy is pending at body-read time.
    const App = () => {
      const state = createProjection<{ v: string }>(
        async () => {
          await Promise.resolve();
          return { v: "settled" };
        },
        { v: "" }
      );
      const read = state.v;
      return <b>{read}</b>;
    };
    const renderApp = () => <App />;

    const html = await renderComplete(() => <main>{renderApp()}</main>);
    expect(html).toContain("settled");
  }, 5_000);
});
