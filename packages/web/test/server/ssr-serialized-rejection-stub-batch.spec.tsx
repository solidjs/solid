/**
 * @jsxImportSource @solidjs/web
 *
 * A serialized source that rejects while its stub still waits in the pre-shell
 * batch.
 *
 * `serialize()` hands every pending promise to `trackSerialized`, which returns
 * `Promise.race([source, abandon])` for seroval to encode. Before the shell
 * completes, that race is parked in `stubBatch` and only reaches seroval when
 * the batch is flushed — a later macrotask. A source that rejects inside the
 * current one (an async memo that throws straight away, a router `query` whose
 * guard refuses the request) rejects the race while nothing is subscribed to
 * it: Node reports an `unhandledRejection` and, by default, exits the process.
 * The boundary above the read catches the same failure and renders its
 * fallback, so the page itself is fine — only the orphaned race escapes.
 *
 * Detection as in ssr-async-rejection-3570.spec.tsx: each test owns the
 * process's `unhandledRejection` listeners for its duration, so a leak fails
 * THIS test instead of surfacing as a run-level error.
 */
import { describe, expect, test } from "vitest";
import { renderToStream, Loading, Errored } from "@solidjs/web";
import { createMemo, sharedConfig } from "solid-js";

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

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

/** A read that settles a few macrotasks later. */
function useSlow(value: string) {
  return createMemo(async () => {
    await delay(10);
    return value;
  });
}

describe("a serialized source that rejects while its stub waits in the pre-shell batch", () => {
  test("an async memo rejecting in its first microtask, read under <Loading><Errored>", async () => {
    const App = () => {
      const held = useSlow("shell");
      const slow = useSlow("slow");
      const data = createMemo(async (): Promise<string> => {
        throw new Error("refused");
      });
      return (
        <div>
          <span>{held()}</span>
          <Loading fallback="loading slow">
            <span>{slow()}</span>
          </Loading>
          <Loading fallback="loading">
            <Errored fallback={error => <p>{String(error())}</p>}>
              <p>{data()}</p>
            </Errored>
          </Loading>
        </div>
      );
    };
    const { escaped, value } = await watchRejections(() =>
      renderToStream(() => <App />, { onError() {} }).then(html => html)
    );
    expect(messages(escaped)).toEqual([]);
    expect(stripScripts(value)).toContain("refused");
  });

  test("a promise handed straight to serialize(), the way a router query hydrates its result", async () => {
    const App = () => {
      const held = useSlow("shell");
      const slow = useSlow("slow");
      const source = (async (): Promise<string> => {
        throw new Error("refused");
      })();
      (sharedConfig as any).context.serialize("query", source);
      const data = createMemo(() => source);
      return (
        <div>
          <span>{held()}</span>
          <Loading fallback="loading slow">
            <span>{slow()}</span>
          </Loading>
          <Loading fallback="loading">
            <Errored fallback={error => <p>{String(error())}</p>}>
              <p>{data()}</p>
            </Errored>
          </Loading>
        </div>
      );
    };
    const { escaped, value } = await watchRejections(() =>
      renderToStream(() => <App />, { onError() {} }).then(html => html)
    );
    expect(messages(escaped)).toEqual([]);
    expect(stripScripts(value)).toContain("refused");
  });
});
