/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#4029 — aborting `renderToStream`'s `signal` mid-render
 * disposes the tree inside the `abort` listener. A cleanup that threw there
 * escaped the `EventTarget` dispatch, which reports listener errors as an
 * uncaught exception: one client leaving mid-stream took the server process
 * down, and `onError` never heard it. The teardown now contains it: the
 * cleanup's throw goes to the render's error hook as a failed render.
 */
import { describe, expect, test } from "vitest";
import { renderToStream, Loading, type ServerErrorContext } from "@solidjs/web";
import { createMemo, onCleanup } from "solid-js";

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

/** Own the process's uncaught channels so an escape fails THIS test. */
async function watchEscapes(run: () => Promise<void>) {
  const events = ["uncaughtException", "unhandledRejection"] as const;
  const previous = events.map(e => process.listeners(e));
  events.forEach(e => process.removeAllListeners(e));
  const escaped: unknown[] = [];
  const capture = (reason: unknown) => escaped.push(reason);
  events.forEach(e => process.on(e, capture));
  try {
    await run();
    for (let turn = 0; turn < 4; turn++) await delay(20);
    return escaped;
  } finally {
    events.forEach((e, i) => {
      process.off(e, capture);
      for (const listener of previous[i]) process.on(e, listener as any);
    });
  }
}

describe("renderToStream: a cleanup that throws during a signal abort (#4029)", () => {
  test("is reported through onError and does not escape the abort listener", async () => {
    const heard: { error: unknown; context: ServerErrorContext }[] = [];
    const never = new Promise<string>(() => {});
    const controller = new AbortController();

    const escaped = await watchEscapes(async () => {
      const stream = renderToStream(
        () => {
          onCleanup(() => {
            throw new Error("cleanup threw");
          });
          return (
            <Loading fallback="waiting">
              {(() => {
                const value = createMemo(async () => never);
                return <p>{value()}</p>;
              })()}
            </Loading>
          );
        },
        {
          signal: controller.signal,
          onError: (error, context) => {
            heard.push({ error, context });
          }
        }
      );
      const { readable, writable } = new TransformStream();
      stream.pipeTo(writable).catch(() => {});
      await readable.getReader().read();
      expect(() => controller.abort()).not.toThrow();
    });

    expect(escaped).toEqual([]);
    expect(heard.map(h => (h.error as Error).message)).toEqual(["cleanup threw"]);
    expect(heard[0].context).toMatchObject({ kind: "render", handling: "failed" });
  });
});
