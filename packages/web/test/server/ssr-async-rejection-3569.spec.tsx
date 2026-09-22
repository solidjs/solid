/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#3569 — `renderToStream` with a rejecting async read as the
 * DIRECT child of `<Loading>` (no element between them, no `<Errored>`):
 * `onError` fired, then `TypeError: Cannot read properties of undefined
 * (reading 'emit')` escaped from `traceMetaMarkup`/`doShell`, and the
 * awaited promise never settled (a hung request). Two independent layers:
 *
 *  (a) ROUTING (solid-js, `runDiscovery`): a template hole
 *      (`<p>{data()}</p>`) that throws is routed through `ssrHandleError` to
 *      the boundary's own ErrorContext handler, which — once the fragment is
 *      registered — owns the error: `<key>_fr` rejects and the client
 *      re-renders the subtree (`handling: "client"`). A bare child throws
 *      straight out of `fn()`, bypassing that handler, so `finalizeError`
 *      saw an uncontained error and, pre-flush, failed the whole request.
 *      Same rejection, same boundary, two verdicts depending only on whether
 *      the read sat inside an element. Bare child ≡ template hole now.
 *
 *  (b) CONTAINMENT (@solidjs/web, `failRender`): the wind-down disposed the
 *      render (clearing `context.trace`) but never completed the consumer,
 *      and seroval's `onDone` still ran `doShell()` on the disposed render —
 *      the 'emit' TypeError. A render failure now completes the consumer
 *      (the awaited promise resolves with whatever HTML was produced, a
 *      pipe/pipeTo sink is ended) and `onDone` does nothing on a dead render.
 *
 * Rulings these tests follow (not decide):
 *  - ssr-stream.spec.tsx "pre-flush rejection under Errored > Loading rejects
 *    the fragment without a boundary error record (#2997)": pre-flush, the
 *    fragment channel owns the error — `_fr` rejects with it, NO fallback is
 *    server-rendered, the placeholder inlines away.
 *  - server-error-hook.spec.tsx "<Loading> fragments and the failed request":
 *    a rejected fragment is one `handling: "client"` call; a failure nothing
 *    contains is one `handling: "failed"` call and the request fails.
 *  - `renderToStream(...).then` (server.ts): "Render errors route through
 *    `onError` and the promise resolves with whatever HTML the render
 *    produced; it never rejects." retry-robustness.spec.tsx pins the
 *    renderer's own retry failures to exactly that; a boundary-originated
 *    failure gets the same treatment here.
 */
import { describe, expect, test } from "vitest";
import { renderToStream, Loading, Errored, type ServerErrorContext } from "@solidjs/web";
import { NotReadyError, createMemo } from "solid-js";
import type { JSX } from "@solidjs/web";
import { hydrationRecordKeys } from "../harness/hydration-records.js";

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

/** See ssr-async-rejection-3570.spec.tsx — own the listener so a leak fails THIS test. */
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
/** Markup without hydration keys, markers and scripts — what the user sees. */
const bare = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/ _hk=[^\s>]+/g, "");

/**
 * Race a promise against a deadline so a hang is an assertion failure with
 * a name, not a vitest timeout.
 */
type Settled<T> = { settled: true; value: T } | { settled: false };
async function settleOrHang<T>(p: Promise<T>, ms = 500): Promise<Settled<T>> {
  let timer: any;
  const hang = new Promise<Settled<T>>(r => (timer = setTimeout(() => r({ settled: false }), ms)));
  try {
    return await Promise.race([p.then(value => ({ settled: true as const, value })), hang]);
  } finally {
    clearTimeout(timer);
  }
}

/** `.pipe()` into a string sink; resolves when `end()` is called, or reports the hang. */
function pipeOrHang(
  code: () => any,
  options: any,
  ms = 500
): Promise<{ ended: boolean; out: string }> {
  return new Promise(resolve => {
    let out = "";
    const timer = setTimeout(() => resolve({ ended: false, out }), ms);
    renderToStream(code, options).pipe({
      write(chunk: string) {
        out += chunk;
      },
      end() {
        clearTimeout(timer);
        resolve({ ended: true, out });
      }
    });
  });
}

type Heard = { error: unknown; context: ServerErrorContext };
function recorder() {
  const heard: Heard[] = [];
  const onError = (error: unknown, context: ServerErrorContext) => {
    heard.push({ error, context });
  };
  return { heard, onError };
}

/** An async memo that rejects ~5ms after creation — after the shell can flush. */
function useLateReject(message = "fetch failed") {
  return createMemo(async () => {
    await delay(5);
    throw new Error(message);
  });
}

/** An async memo that rejects in its first microtask — before any shell flush. */
function useEarlyReject(message = "fetch failed early") {
  return createMemo(async (): Promise<string> => {
    throw new Error(message);
  });
}

describe("#3569 (a) a bare child's rejection routes like a template hole's", () => {
  test("await: <Loading>{data()}</Loading> settles — the fragment rejects, the client re-renders (#2997), one `client` call", async () => {
    const { heard, onError } = recorder();
    const App = () => {
      const data = useLateReject();
      return (
        <div>
          <Loading fallback={<i>loading</i>}>{data()}</Loading>
          <span>tail</span>
        </div>
      );
    };
    const { escaped, value } = await watchRejections(() =>
      settleOrHang(renderToStream(() => <App />, { onError }).then(html => html))
    );
    expect(messages(escaped)).toEqual([]);
    expect(value.settled).toBe(true);
    const html = (value as { value: string }).value;
    // The error reached the boundary's channel: `_fr` rejects with it, the
    // client re-renders the subtree fresh. Pre-flush (the awaited form has
    // no shell handoff) the placeholder inlines away — no fallback DOM.
    expect(bare(html)).toContain("<span>tail</span>");
    expect(html).toContain("fetch failed");
    expect(bare(html)).not.toContain("<i>loading</i>");
    expect(hydrationRecordKeys(html).filter(k => k.endsWith("_fr"))).toHaveLength(1);
    expect(heard.map(h => h.context.handling)).toEqual(["client"]);
    expect((heard[0].error as Error).message).toBe("fetch failed");
  });

  test("await: a component whose return IS the read (<Loading><Inner/></Loading>) is the same bare shape", async () => {
    const { heard, onError } = recorder();
    const App = () => {
      const data = useLateReject();
      const Inner = () => data();
      return (
        <Loading fallback={<i>loading</i>}>
          <Inner />
        </Loading>
      );
    };
    const { escaped, value } = await watchRejections(() =>
      settleOrHang(renderToStream(() => <App />, { onError }).then(html => html))
    );
    expect(messages(escaped)).toEqual([]);
    expect(value.settled).toBe(true);
    expect((value as { value: string }).value).toContain("fetch failed");
    expect(heard.map(h => h.context.handling)).toEqual(["client"]);
  });

  test("await: bare child and element-wrapped child produce the same record set and verdict", async () => {
    const bare = recorder();
    const wrapped = recorder();
    const Bare = () => {
      const data = useLateReject();
      return <Loading fallback={<i>loading</i>}>{data()}</Loading>;
    };
    const Wrapped = () => {
      const data = useLateReject();
      return (
        <Loading fallback={<i>loading</i>}>
          <p>{data()}</p>
        </Loading>
      );
    };
    const { escaped, value } = await watchRejections(() =>
      Promise.all([
        settleOrHang(renderToStream(() => <Bare />, { onError: bare.onError }).then(h => h)),
        settleOrHang(renderToStream(() => <Wrapped />, { onError: wrapped.onError }).then(h => h))
      ])
    );
    expect(messages(escaped)).toEqual([]);
    const [b, w] = value;
    expect(b.settled && w.settled).toBe(true);
    const bareHtml = (b as { value: string }).value;
    const wrappedHtml = (w as { value: string }).value;
    expect(hydrationRecordKeys(bareHtml).sort()).toEqual(hydrationRecordKeys(wrappedHtml).sort());
    expect(bare.heard.map(h => h.context.handling)).toEqual(
      wrapped.heard.map(h => h.context.handling)
    );
    expect(bare.heard.map(h => h.context.handling)).toEqual(["client"]);
  });

  test("pipe(): a rejection BEFORE the shell flushes ends the stream — the fragment rejects, no fallback DOM", async () => {
    const { heard, onError } = recorder();
    const App = () => {
      const data = useEarlyReject();
      return (
        <div>
          <Loading fallback={<i>loading</i>}>{data()}</Loading>
          <span>tail</span>
        </div>
      );
    };
    const { escaped, value } = await watchRejections(() => pipeOrHang(() => <App />, { onError }));
    expect(messages(escaped)).toEqual([]);
    expect(value.ended).toBe(true);
    expect(bare(value.out)).toContain("<span>tail</span>");
    expect(value.out).toContain("fetch failed early");
    expect(bare(value.out)).not.toContain("<i>loading</i>");
    expect(hydrationRecordKeys(value.out).filter(k => k.endsWith("_fr"))).toHaveLength(1);
    expect(heard.map(h => h.context.handling)).toEqual(["client"]);
  });

  test("pipe(): a rejection AFTER the shell flushed streams the fallback, then the rejected fragment", async () => {
    // This shape already worked on `next` (post-flush `done()` answers true);
    // pinned so the routing change keeps the streamed verdict identical.
    const { heard, onError } = recorder();
    const App = () => {
      const data = useLateReject();
      return <Loading fallback={<i>loading</i>}>{data()}</Loading>;
    };
    const { escaped, value } = await watchRejections(() => pipeOrHang(() => <App />, { onError }));
    expect(messages(escaped)).toEqual([]);
    expect(value.ended).toBe(true);
    expect(bare(value.out)).toContain("<i>loading</i>");
    expect(value.out).toContain("fetch failed");
    expect(hydrationRecordKeys(value.out).filter(k => k.endsWith("_fr"))).toHaveLength(1);
    expect(heard.map(h => h.context.handling)).toEqual(["client"]);
  });

  test("await: under <Errored>, the bare shape still rejects the fragment without a boundary error record (#2997)", async () => {
    const { heard, onError } = recorder();
    const App = () => {
      const data = useLateReject();
      return (
        <div>
          <Errored fallback={<p>caught</p>}>
            <Loading fallback={<i>loading</i>}>{data()}</Loading>
          </Errored>
          <span>tail</span>
        </div>
      );
    };
    const { escaped, value } = await watchRejections(() =>
      settleOrHang(renderToStream(() => <App />, { onError }).then(html => html))
    );
    expect(messages(escaped)).toEqual([]);
    expect(value.settled).toBe(true);
    const html = (value as { value: string }).value;
    expect(bare(html)).toContain("<span>tail</span>");
    expect(html).toContain("fetch failed");
    expect(bare(html)).not.toContain("caught");
    // The memo's rejected flight ("0", created in App) + the fragment's
    // `_fr` — and nothing else: the Errored carries no record, the server
    // rendered no fallback DOM for it. (Unfixed, a third record "2" carried
    // the error: the bare throw escalated to the parent handler, which
    // serialized a fallback record for DOM that was never emitted.)
    expect(hydrationRecordKeys(html).sort()).toEqual(["0", "200_fr"]);
    expect(heard.map(h => h.context.handling)).toEqual(["client"]);
  });

  test("the synchronous first pass is unchanged: a sync throw under <Loading> in <Errored> renders the parent's fallback", async () => {
    const { heard, onError } = recorder();
    function Bad(): JSX.Element {
      throw new Error("sync boom");
    }
    const html = await renderToStream(
      () => (
        <Errored fallback={(e: any) => <p>caught:{String(e().message)}</p>}>
          <Loading fallback={<i>loading</i>}>
            <Bad />
          </Loading>
        </Errored>
      ),
      { onError }
    );
    expect(bare(html)).toContain("<p>caught:sync boom</p>");
    expect(heard.map(h => h.context.handling)).toEqual(["fallback"]);
  });

  test("the synchronous first pass is unchanged: a hole's sync throw is routed once — the parent's fallback renders once", async () => {
    // A hole already ran `ssrHandleError` (the Errored's handler rethrows
    // after rendering); the boundary must not route the same error again.
    const { heard, onError } = recorder();
    let fallbackRenders = 0;
    const html = await renderToStream(
      () => (
        <Errored
          fallback={(e: any) => {
            fallbackRenders++;
            return <p>caught:{String(e().message)}</p>;
          }}
        >
          <Loading fallback={<i>loading</i>}>
            <div>
              {
                (() => {
                  throw new Error("hole boom");
                }) as unknown as JSX.Element
              }
            </div>
          </Loading>
        </Errored>
      ),
      { onError }
    );
    expect(bare(html)).toContain("<p>caught:hole boom</p>");
    expect(fallbackRenders).toBe(1);
    expect(heard.map(h => h.context.handling)).toEqual(["fallback"]);
  });
});

describe("#3569 (b) a render failure completes the consumer", () => {
  // A failure that reaches `failRender` regardless of (a): a `<Loading>`
  // whose child plants a fresh pending source on every pass trips the
  // boundary's convergence budget (#3003). That error is the boundary
  // machinery's own — no hole, no bare child — so it takes `finalizeError`'s
  // uncontained path: pre-flush, no parent handler → the request fails.
  const NeverConverges = () => {
    throw new NotReadyError(Promise.resolve() as any);
  };

  /**
   * The failing boundary, plus a root read that holds the shell until the
   * failure has been reported — so for the piped forms the failure lands
   * strictly pre-flush (post-flush a boundary's `done()` answers true and
   * the fragment channel takes over; that shape already worked).
   */
  function failingPreShell() {
    let releaseShell!: () => void;
    const gate = new Promise<string>(r => (releaseShell = () => r("shell")));
    const { heard, onError } = recorder();
    const App = () => {
      const held = createMemo(() => gate);
      return (
        <div>
          {held()}
          <Loading fallback={<i>loading</i>}>
            <NeverConverges />
          </Loading>
        </div>
      );
    };
    const options = {
      onError(error: unknown, context: ServerErrorContext) {
        onError(error, context);
        setTimeout(releaseShell, 0);
      }
    };
    return { App, options, heard };
  }

  test("await: resolves (with the HTML produced — none, pre-shell), one `failed` call, nothing leaks", async () => {
    const { App, options, heard } = failingPreShell();
    const { escaped, value } = await watchRejections(() =>
      settleOrHang(
        renderToStream(() => <App />, options).then(html => html),
        2000
      )
    );
    expect(messages(escaped)).toEqual([]);
    expect(value.settled).toBe(true);
    // `then` never rejects: it resolves with whatever the render produced.
    expect((value as { value: string }).value).toBe("");
    expect(heard.map(h => h.context.handling)).toEqual(["failed"]);
    expect(String((heard[0].error as Error).message)).toContain("did not converge");
  }, 10_000);

  test("pipe(): the sink is ended even though the shell never flushed", async () => {
    const { App, options, heard } = failingPreShell();
    const { escaped, value } = await watchRejections(() =>
      pipeOrHang(() => <App />, options, 2000)
    );
    expect(messages(escaped)).toEqual([]);
    expect(heard.map(h => h.context.handling)).toEqual(["failed"]);
    expect(value.ended).toBe(true);
    expect(value.out).toBe("");
  }, 10_000);

  test("readable: the stream closes so a Response body completes", async () => {
    const { App, options, heard } = failingPreShell();
    const { escaped, value } = await watchRejections(() => {
      const stream = renderToStream(() => <App />, options);
      return settleOrHang(new Response(stream.readable).text(), 2000);
    });
    expect(messages(escaped)).toEqual([]);
    expect(value.settled).toBe(true);
    expect((value as { value: string }).value).toBe("");
    expect(heard.map(h => h.context.handling)).toEqual(["failed"]);
  }, 10_000);
});
