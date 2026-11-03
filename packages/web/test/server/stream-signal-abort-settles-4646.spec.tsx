/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#4646 — aborting `renderToStream`'s `signal` tore the render
 * down as a disconnect, but a disconnect skipped the consumer completions
 * the failure wind-down runs: `await renderToStream(...)` and `pipeTo`'s
 * promise never settled, the `readable` view and a post-shell
 * `createSSRResponse` body never closed, and a raw `pipe` sink was never
 * ended, holding the request forever.
 *
 * The awaited form rejects with `signal.reason` (renderToStream's `then`
 * JSDoc, #4649). The streaming forms stop writing and end cleanly — a close,
 * not an error: the bytes already sent stay sent (the `signal` option's
 * JSDoc; 12-ssr-http.md "Consuming the stream"). Before the shell,
 * `createSSRResponse` still answers with a bodyless 500. Neither `onError`
 * nor `onCompleteAll` hears an abort.
 */
import { describe, expect, test } from "vitest";
import { renderToStream, createSSRResponse, createRequestEvent } from "@solidjs/web";
import { createMemo, Loading, onCleanup } from "solid-js";
import { watchEscapes } from "./stream-settle-harness.js";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

type Outcome =
  | { state: "resolved"; value: unknown }
  | { state: "rejected"; reason: unknown }
  | { state: "pending" };
const outcome = (p: PromiseLike<unknown>, ms = 500): Promise<Outcome> =>
  Promise.race([
    Promise.resolve(p).then(
      value => ({ state: "resolved" as const, value }),
      (reason: unknown) => ({ state: "rejected" as const, reason })
    ),
    sleep(ms).then(() => ({ state: "pending" as const }))
  ]);

type Phase = "already aborted" | "aborted before the shell" | "aborted after the shell";
const PHASES: Phase[] = ["already aborted", "aborted before the shell", "aborted after the shell"];

// `never`: a source that never settles, so no later flush can finish the
// consumer; otherwise it lands (at 100ms) after the abort (at 30ms). After
// the shell, the source sits under a `<Loading>` so the shell flushes first;
// before it, the source blocks the shell.
function start(phase: Phase, never: boolean, rejectLate = false) {
  const log: string[] = [];
  const calls = { onError: 0, onCompleteAll: 0 };
  const c = new AbortController();
  const source = () =>
    createMemo(() =>
      never
        ? new Promise<string>(() => {})
        : sleep(100).then(() => {
            if (rejectLate) throw new Error("late");
            return "loaded";
          })
    );
  const App = () => {
    const m = source();
    const id = setInterval(() => log.push("tick"), 5);
    onCleanup(() => {
      clearInterval(id);
      log.push("cleanup");
    });
    return phase === "aborted after the shell" ? (
      <div>
        <b>shell</b>
        <Loading fallback={<i>wait</i>}>
          <p>{m()}</p>
        </Loading>
      </div>
    ) : (
      <p>{m()}</p>
    );
  };
  if (phase === "already aborted") c.abort(new Error("gone"));
  const r = renderToStream(App, {
    signal: c.signal,
    onError: () => void calls.onError++,
    onCompleteAll: () => void calls.onCompleteAll++
  });
  if (phase !== "already aborted")
    setTimeout(() => {
      log.push("abort");
      c.abort(new Error("client disconnected"));
    }, 30);
  return { r, c, log, calls };
}

describe("renderToStream: aborting the signal settles every consumer (#4646)", () => {
  for (const never of [false, true]) {
    const source = never ? "a source that never settles" : "a source that settles later";
    for (const phase of PHASES) {
      const postShell = phase === "aborted after the shell";
      const label = `(${phase}, ${source})`;

      test(`await rejects with signal.reason and the render is torn down ${label}`, async () => {
        const { r, c, log, calls } = start(phase, never);
        const o = await outcome(r);
        expect(o.state).toBe("rejected");
        expect((o as { reason: unknown }).reason).toBe(c.signal.reason);
        expect(log).toContain("cleanup");
        const ticks = log.filter(x => x === "tick").length;
        await sleep(150);
        expect(log.filter(x => x === "tick").length).toBe(ticks);
        expect(calls).toEqual({ onError: 0, onCompleteAll: 0 });
      });

      test(`pipeTo resolves and closes the writable, writing nothing after the abort ${label}`, async () => {
        const { r, log, calls } = start(phase, never);
        const events: string[] = [];
        const p = r.pipeTo(
          new WritableStream({
            write: () => void events.push(log.includes("abort") ? "late-write" : "write"),
            close: () => void events.push("close"),
            abort: () => void events.push("abort")
          })
        );
        expect((await outcome(p)).state).toBe("resolved");
        await sleep(150);
        expect(events).toEqual(postShell ? ["write", "close"] : ["close"]);
        expect(calls).toEqual({ onError: 0, onCompleteAll: 0 });
      });

      test(`the readable view closes ${label}`, async () => {
        const { r, calls } = start(phase, never);
        const reader = r.readable.getReader();
        const dec = new TextDecoder();
        let text = "";
        const done = (async () => {
          for (;;) {
            const x = await reader.read();
            if (x.done) return "closed";
            text += dec.decode(x.value);
          }
        })();
        const o = await outcome(done);
        expect(o).toEqual({ state: "resolved", value: "closed" });
        if (postShell) expect(text).toContain("shell");
        else expect(text).toBe("");
        expect(text).not.toContain("loaded");
        expect(calls).toEqual({ onError: 0, onCompleteAll: 0 });
      });

      test(`pipe ends a raw sink once, writing nothing after the abort ${label}`, async () => {
        const { r, log, calls } = start(phase, never);
        const events: string[] = [];
        r.pipe({
          write: (s: string) =>
            void events.push(log.includes("abort") ? "late-write" : `write:${s.includes("shell")}`),
          end: () => void events.push("end")
        });
        await sleep(300);
        expect(events).toEqual(postShell ? ["write:true", "end"] : ["end"]);
        expect(calls).toEqual({ onError: 0, onCompleteAll: 0 });
      });

      test(`createSSRResponse ${postShell ? "ends its 200 body" : "resolves with a bodyless 500"} ${label}`, async () => {
        const { r, calls } = start(phase, never);
        const o = await outcome(createSSRResponse(r, undefined));
        expect(o.state).toBe("resolved");
        const res = (o as { value: Response }).value;
        if (postShell) {
          expect(res.status).toBe(200);
          const body = await outcome(res.text());
          expect(body.state).toBe("resolved");
          const html = (body as { value: string }).value;
          expect(html).toContain("shell");
          expect(html).not.toContain("loaded");
        } else {
          expect(res.status).toBe(500);
          expect(res.body).toBe(null);
        }
        expect(calls).toEqual({ onError: 0, onCompleteAll: 0 });
      });
    }
  }

  for (const phase of PHASES)
    test(`two awaits and a source that rejects later: both reject, nothing escapes (${phase})`, async () => {
      const escaped = await watchEscapes(async () => {
        const { r, c } = start(phase, false, true);
        const [a, b] = await Promise.all([outcome(r), outcome(r)]);
        expect([a, b]).toEqual([
          { state: "rejected", reason: c.signal.reason },
          { state: "rejected", reason: c.signal.reason }
        ]);
        await sleep(150);
      });
      expect(escaped).toEqual([]);
    });

  // The one write after an abort: a Location set after the head went out can
  // only be honored client-side, so the abort-driven `end()` still appends
  // the redirect script before it closes the 200 body.
  test("createSSRResponse still appends the late-Location script when an abort ends the body", async () => {
    const { r, c, calls } = start("aborted after the shell", true);
    const event = createRequestEvent(new Request("http://localhost/"));
    const res = await createSSRResponse(r, event);
    expect(res.status).toBe(200);
    event.response.headers.set("Location", "/next");
    const body = await outcome(res.text());
    expect(c.signal.aborted).toBe(true);
    expect(body.state).toBe("resolved");
    const html = (body as { value: string }).value;
    expect(html).toContain("shell");
    expect(html.endsWith('<script>window.location="/next"</script>')).toBe(true);
    expect(calls).toEqual({ onError: 0, onCompleteAll: 0 });
  });

  test("without an abort the awaited form still resolves with the full page", async () => {
    const html = await renderToStream(
      () => {
        const m = createMemo(() => sleep(10).then(() => "loaded"));
        return <p>{m()}</p>;
      },
      { signal: new AbortController().signal }
    );
    expect(html).toContain("loaded");
  });

  test("an abort after completion leaves a closed pipeTo alone", async () => {
    const c = new AbortController();
    let onCompleteAll = 0;
    const r = renderToStream(
      () => {
        const m = createMemo(() => sleep(10).then(() => "loaded"));
        return <p>{m()}</p>;
      },
      { signal: c.signal, onCompleteAll: () => void onCompleteAll++ }
    );
    const events: string[] = [];
    const p = r.pipeTo(
      new WritableStream({
        write: () => void events.push("write"),
        close: () => void events.push("close"),
        abort: () => void events.push("abort")
      })
    );
    expect((await outcome(p)).state).toBe("resolved");
    await sleep(20);
    const before = [...events];
    c.abort(new Error("late"));
    await sleep(50);
    expect(events).toEqual(before);
    expect(events[events.length - 1]).toBe("close");
    expect(onCompleteAll).toBe(1);
  });
});
