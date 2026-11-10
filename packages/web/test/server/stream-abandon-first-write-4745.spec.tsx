/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#4745: a render abandoned from inside `pipe`'s first write.
 * `pipe` hands the shell over with `buffer.write(tmp)` and flushes on the
 * next line. A shell of 16384 characters or more goes out on that first call,
 * and the render can be abandoned right there: `createSSRResponse` does it
 * when the stub carries a `Location` (a pre-flush redirect), `guardSink`
 * when the sink's `write` throws, and `onAbort` when the signal is aborted.
 * `abandon` swaps the buffer for one that had `write` but no `flush`, so the
 * flush on the next line threw a TypeError inside a promise callback, and
 * nothing handled the rejection, which ends the process under Node's
 * default. A smaller shell goes out on the `flush()` call itself and never
 * hits this, so the two sizes are pinned side by side. `pipeTo` chains its
 * writes on a promise, so a write that fails there abandons the render on a
 * later turn. It was never affected, and the last case pins that.
 */
import { describe, expect, test } from "vitest";
import { createRequestEvent, createSSRResponse, renderToStream } from "@solidjs/web";
import { onCleanup } from "solid-js";
import { watchEscapes } from "./stream-settle-harness.js";

// `coalesceWrites` writes through once its buffer holds this many characters.
const WRITE_THROUGH = 16384;
// Lengths of the page's text. The shell adds its markup on top, so the two
// land on either side of the write-through size.
const SIZES = [
  ["below the write-through size", 1024],
  ["above the write-through size", WRITE_THROUGH]
] as const;

function page(size: number, ran: string[]) {
  return () => {
    onCleanup(() => ran.push("cleanup"));
    return <main>{"x".repeat(size)}</main>;
  };
}

describe("renderToStream: a render abandoned inside pipe's first write (#4745)", () => {
  test.each(SIZES)("a pre-flush redirect, shell %s", async (_, size) => {
    const ran: string[] = [];
    const event = createRequestEvent(new Request("http://localhost/"));
    event.response.status = 307;
    event.response.headers.set("Location", "/next");
    let response: Response | undefined;
    const escaped = await watchEscapes(async () => {
      response = await createSSRResponse(renderToStream(page(size, ran)), event);
    });
    expect(escaped).toEqual([]);
    expect(response!.status).toBe(307);
    expect(response!.headers.get("Location")).toBe("/next");
    expect(response!.body).toBeNull();
    expect(ran).toEqual(["cleanup"]);
  });

  test.each(SIZES)("a sink whose write throws, shell %s", async (_, size) => {
    const ran: string[] = [];
    const calls = { write: 0, end: 0 };
    const escaped = await watchEscapes(async () => {
      renderToStream(page(size, ran)).pipe({
        write() {
          calls.write++;
          throw new Error("socket closed");
        },
        end() {
          calls.end++;
        }
      });
    });
    expect(escaped).toEqual([]);
    expect(calls).toEqual({ write: 1, end: 0 });
    expect(ran).toEqual(["cleanup"]);
  });

  test.each(SIZES)("a signal aborted from inside the write, shell %s", async (_, size) => {
    const ran: string[] = [];
    const calls = { write: 0, end: 0 };
    const controller = new AbortController();
    const escaped = await watchEscapes(async () => {
      renderToStream(page(size, ran), { signal: controller.signal }).pipe({
        write() {
          calls.write++;
          controller.abort();
        },
        end() {
          calls.end++;
        }
      });
    });
    expect(escaped).toEqual([]);
    expect(calls).toEqual({ write: 1, end: 1 });
    expect(ran).toEqual(["cleanup"]);
  });

  test.each(SIZES)("pipeTo with a write that rejects, shell %s", async (_, size) => {
    const ran: string[] = [];
    let writes = 0;
    let settled = false;
    const escaped = await watchEscapes(async () => {
      await renderToStream(page(size, ran)).pipeTo(
        new WritableStream({
          write() {
            writes++;
            return Promise.reject(new Error("socket closed"));
          }
        })
      );
      settled = true;
    });
    expect(escaped).toEqual([]);
    expect(writes).toBe(1);
    expect(settled).toBe(true);
    expect(ran).toEqual(["cleanup"]);
  });
});
