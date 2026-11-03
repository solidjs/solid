/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#4646 — aborting `renderToStream`'s `signal` tore the render
 * down as a disconnect, but a disconnect skipped the consumer completions
 * the failure wind-down runs: `await renderToStream(...)` and `pipeTo`'s
 * promise never settled, holding the request forever. The awaited form
 * rejects with `signal.reason` (renderToStream's `then` JSDoc; 12-ssr-http.md;
 * #4649). The streaming forms only settle: `pipeTo`'s promise resolves, and
 * a disconnect still leaves the sink alone — nothing more is written to it.
 */
import { describe, expect, test } from "vitest";
import { renderToStream, createSSRResponse } from "@solidjs/web";
import { createMemo } from "solid-js";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

type Outcome =
  | { state: "resolved"; value: unknown }
  | { state: "rejected"; reason: unknown }
  | { state: "pending" };
const outcome = (p: PromiseLike<unknown>): Promise<Outcome> =>
  Promise.race([
    Promise.resolve(p).then(
      value => ({ state: "resolved" as const, value }),
      (reason: unknown) => ({ state: "rejected" as const, reason })
    ),
    sleep(500).then(() => ({ state: "pending" as const }))
  ]);

// `never`: a source that never settles, so no later flush can finish the
// consumer; otherwise it lands after the abort.
const App = (never: boolean) => () => {
  const m = createMemo(() =>
    never ? new Promise<string>(() => {}) : sleep(100).then(() => "loaded")
  );
  return <p>{m()}</p>;
};

const start = (never: boolean, preAborted: boolean, c = new AbortController()) => {
  if (preAborted) c.abort(new Error("gone"));
  const r = renderToStream(App(never), { signal: c.signal, onError() {} });
  if (!preAborted) setTimeout(() => c.abort(new Error("client disconnected")), 20);
  return r;
};

describe("renderToStream: aborting the signal settles the consumer (#4646)", () => {
  for (const never of [false, true]) {
    const source = never ? "a source that never settles" : "a source that settles later";
    for (const preAborted of [false, true]) {
      const when = preAborted ? "already aborted" : "aborted mid-render";
      test(`await rejects with signal.reason (${when}, ${source})`, async () => {
        const c = new AbortController();
        const r = await outcome(start(never, preAborted, c));
        expect(r.state).toBe("rejected");
        expect((r as { reason: unknown }).reason).toBe(c.signal.reason);
      });

      test(`pipeTo's promise resolves and the writable gets nothing (${when}, ${source})`, async () => {
        const chunks: unknown[] = [];
        const p = start(never, preAborted).pipeTo(
          new WritableStream({ write: chunk => void chunks.push(chunk) })
        );
        expect((await outcome(p)).state).toBe("resolved");
        expect(chunks).toEqual([]);
      });

      test(`pipe leaves a raw sink alone (${when}, ${source})`, async () => {
        const writes: string[] = [];
        let ended = false;
        start(never, preAborted).pipe({
          write: (s: string) => void writes.push(s),
          end: () => void (ended = true)
        });
        await sleep(300);
        expect(writes).toEqual([]);
        expect(ended).toBe(false);
      });

      test(`createSSRResponse resolves with a bodyless 500 (${when}, ${source})`, async () => {
        const r = await outcome(createSSRResponse(start(never, preAborted), undefined));
        expect(r.state).toBe("resolved");
        const res = (r as { value: Response }).value;
        expect(res.status).toBe(500);
        expect(res.body).toBe(null);
      });
    }
  }

  test("without an abort the awaited form still resolves with the full page", async () => {
    const html = await renderToStream(App(false), { signal: new AbortController().signal });
    expect(html).toContain("loaded");
  });
});
