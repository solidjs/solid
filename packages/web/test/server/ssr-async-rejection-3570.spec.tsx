/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#3570 — `renderToString` with an async source that rejects
 * AFTER the synchronous render returned.
 *
 * Every server async flight settles an internal deferred
 * (`createDeferredPromise` in solid-js's server signals). Under
 * `renderToStream` that deferred is serialized into the stream (and guarded
 * there); under `renderToString` there is no serialization channel
 * (`ctx.async` is unset) and no reader ever awaits the `NotReadyError`'s
 * source — the sync `<Loading>` path answers with the fallback and moves
 * on. The flight's terminal `deferred.reject(error)` then rejected a promise
 * with zero subscribers: an `unhandledRejection` that exits Node with code 1,
 * long after the HTML was returned. No `<Errored>` can catch it — the
 * render is over.
 *
 * The contract pinned here: the HTML the sync render already produced is
 * unaffected (the `<Loading>` serialized `$$f`, so the client re-runs the
 * source after hydration and meets the error itself) and NOTHING leaks to
 * the process.
 *
 * Detection: vitest's own `unhandledRejection` listener reports a leak as a
 * run-level "Unhandled Rejection" error, not as a failure of the test that
 * caused it. Each test here owns the listener for its duration so the leak
 * fails THIS test, red on `next` before the fix.
 */
import { describe, expect, test } from "vitest";
import { renderToString, renderToStream, Loading, Errored } from "@solidjs/web";
import { NoHydration, createMemo, createProjection, createStore } from "solid-js";

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Own `process`'s `unhandledRejection` listeners for the duration of `run`
 * and collect every rejection that escaped. Settle turns are macrotasks:
 * Node emits the event once a macrotask's microtask queue has drained, so a
 * single `await` of the render is not enough to observe a late leak.
 */
async function watchRejections<T>(run: () => Promise<T> | T, settleTurns = 4) {
  const previous = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  const escaped: unknown[] = [];
  const capture = (reason: unknown) => escaped.push(reason);
  process.on("unhandledRejection", capture);
  try {
    const value = await run();
    for (let turn = 0; turn < settleTurns; turn++) await delay(20);
    return { escaped, value };
  } finally {
    process.off("unhandledRejection", capture);
    for (const listener of previous) process.on("unhandledRejection", listener as any);
  }
}

const messages = (escaped: unknown[]) => escaped.map(e => (e as Error).message);
const stripScripts = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "");

/** An async memo that rejects ~5ms after creation — after any sync render. */
function useLateReject(message = "fetch failed") {
  return createMemo(async () => {
    await delay(5);
    throw new Error(message);
  });
}

describe("#3570 renderToString: a post-render async rejection must not escape the process", () => {
  test("an unread async memo", async () => {
    const App = () => {
      useLateReject();
      return <div>static</div>;
    };
    const { escaped, value } = await watchRejections(() => renderToString(() => <App />));
    expect(stripScripts(value)).toContain("static");
    expect(messages(escaped)).toEqual([]);
  });

  test("an async memo read under <Loading>: the fallback is served, nothing leaks", async () => {
    const App = () => {
      const data = useLateReject();
      return <Loading fallback="loading">{data()}</Loading>;
    };
    const { escaped, value } = await watchRejections(() => renderToString(() => <App />));
    expect(stripScripts(value)).toContain("loading");
    // The sync render can only ever answer "fallback" for an unresolved
    // source ($$f): the client renders the content itself after hydration.
    expect(value).toContain('"$$f"');
    expect(messages(escaped)).toEqual([]);
  });

  test("an async memo read under <Errored><Loading>: the boundary cannot see a post-render rejection, and nothing leaks", async () => {
    const App = () => {
      const data = useLateReject();
      return (
        <Errored fallback="error">
          <Loading fallback="loading">{data()}</Loading>
        </Errored>
      );
    };
    const { escaped, value } = await watchRejections(() => renderToString(() => <App />));
    expect(stripScripts(value)).toContain("loading");
    expect(stripScripts(value)).not.toContain("error");
    expect(messages(escaped)).toEqual([]);
  });

  test("a rejection that lands in the first microtask is still after the sync render", async () => {
    const App = () => {
      const data = createMemo(async (): Promise<string> => {
        throw new Error("fetch failed early");
      });
      return <Loading fallback="loading">{data()}</Loading>;
    };
    const { escaped, value } = await watchRejections(() => renderToString(() => <App />));
    expect(stripScripts(value)).toContain("loading");
    expect(messages(escaped)).toEqual([]);
  });

  test("every server async source shape shares the deferred: store, projection, async generator", async () => {
    const App = () => {
      const [store] = createStore(async (_draft: { v?: string }) => {
        await delay(5);
        throw new Error("store failed");
      }, {});
      const proj = createProjection(async (_draft: { v?: string }) => {
        await delay(5);
        throw new Error("projection failed");
      }, {});
      const gen = createMemo(async function* () {
        await delay(5);
        throw new Error("generator failed");
      });
      return (
        <Loading fallback="loading">
          {store.v}
          {proj.v}
          {gen()}
        </Loading>
      );
    };
    const { escaped, value } = await watchRejections(() => renderToString(() => <App />));
    expect(stripScripts(value)).toContain("loading");
    expect(messages(escaped)).toEqual([]);
  });

  test("renderToStream with an unread source that does not serialize (<NoHydration>) has the same unobserved deferred", async () => {
    // `serializes` is false in a NoHydration zone: no stream channel guards
    // the deferred, and an unread source has no reader awaiting its
    // NotReadyError either — the leak is not renderToString-specific.
    const Inner = () => {
      useLateReject();
      return <div>static</div>;
    };
    const App = () => (
      <NoHydration>
        <Inner />
      </NoHydration>
    );
    const { escaped, value } = await watchRejections(() =>
      renderToStream(() => <App />, { onError() {} })
    );
    expect(stripScripts(value)).toContain("static");
    expect(messages(escaped)).toEqual([]);
  });
});
