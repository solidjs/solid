/**
 * A promise the DECODER mints must always have an owner (#3232).
 *
 * A decoded payload is a peer's bytes, and a rejected promise inside it is a
 * rejection nobody is holding: the consumer never expected the slot to be a
 * promise (or abandoned the graph before reading it), so the rejection
 * reaches no handler. Under Node's default policy that ends the process; in
 * a browser it spams the console. The encode side already keeps a fallback
 * owner on every promise IT mints (`guardedPromise` + `.catch(() => {})`,
 * server.ts, #3216) — the decode side must hold itself to the same
 * discipline.
 *
 * Two spellings reach the decoder:
 *
 *  - the constructor pair the streaming encoder emits (a pending promise,
 *    rejected by a later chunk). The end-of-stream sweep defuses it, but
 *    only when the stream ENDS — a rejection frame arriving while another
 *    value keeps the stream open leaves the rejected promise unowned across
 *    real event-loop turns, which is when Node reports it.
 *  - the atomic promise node (seroval type 12), which settles synchronously
 *    inside the chunk that carries it and never enters the sweep's `{p,s,f}`
 *    shape at all.
 *
 * These tests take over `unhandledRejection` for the length of one decode.
 * Under the runner vitest owns that event and would report the escape as a
 * file-level error; the process-level escape IS the finding, so it is
 * asserted here by name.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
import { createServerReference, deserializeStream } from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";
const SERIALIZED_FORMAT = "0";

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const disconnects: (() => void)[] = [];
afterEach(() => {
  while (disconnects.length) disconnects.pop()!();
});

/** Routes the client stub's fetch straight into the built handler. */
function connectTransport() {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const address = input instanceof Request ? input.url : input.toString();
    const request = new Request(
      new URL(address, "http://localhost"),
      input instanceof Request ? input : init
    );
    request.headers.set("Sec-Fetch-Site", "same-origin");
    return handleServerFunctionRequest(request);
  }) as typeof fetch;
  disconnects.push(() => {
    globalThis.fetch = original;
  });
}

/**
 * Runs `run` owning `unhandledRejection`, and reports what escaped. The
 * settle turns are real macrotasks: Node emits the event after a
 * macrotask's microtask queue drains, so a same-tick sweep cannot mask a
 * rejection that sat unowned across a turn.
 */
async function watchRejections<T>(run: () => Promise<T>, settleTurns = 4) {
  const previous = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  const escaped: string[] = [];
  const capture = (reason: unknown) => escaped.push(String(reason));
  process.on("unhandledRejection", capture);
  try {
    const value = await run();
    for (let turn = 0; turn < settleTurns; turn++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return { escaped, value };
  } finally {
    process.off("unhandledRejection", capture);
    for (const listener of previous) process.on("unhandledRejection", listener as any);
  }
}

/** Wraps a payload in the codec's length-prefixed frame. */
function frame(payload: string) {
  const length = new TextEncoder().encode(payload).byteLength;
  return `;0x${length.toString(16).padStart(8, "0")};${payload}`;
}

/**
 * An object whose `slot` is an atomic rejected-promise node (seroval type
 * 12, settlement flag 0). Handwritten because the streaming encoder never
 * emits this spelling — but the wire is text, and a peer writes whatever it
 * likes.
 */
const ATOMIC_REJECTED_GRAPH =
  `{"t":10,"i":0,"p":{"k":["slot"],"v":[` +
  `{"t":12,"i":1,"s":0,"f":{"t":13,"i":2,"s":0,"m":"never read","p":{"k":[],"v":[]}}}` +
  `],"s":1}}`;

describe("decoder-minted rejected promises are owned (#3232)", () => {
  it("does not escape when a rejection frame lands mid-stream and the slot is never read", async () => {
    // The rejected slot settles from an early chunk while `slow` keeps the
    // stream open: the minted rejection sits across real event-loop turns
    // before the end-of-stream sweep could ever defuse it.
    registerServerFunction("decoder-ownership-stream", async () => ({
      fail: Promise.reject(new Error("nobody reads this slot")),
      slow: new Promise(resolve => setTimeout(() => resolve("late"), 60))
    }));
    connectTransport();
    const { escaped, value } = await watchRejections(() =>
      createServerReference("decoder-ownership-stream")()
    );
    expect(
      escaped,
      `the abandoned rejected slot escaped as an unhandled rejection: ${escaped.join(", ")}` +
        ` (decoded keys: ${Object.keys(value as object).join(", ")})`
    ).toEqual([]);
    // the slot still rejects for a consumer that actually reads it
    await expect((value as any).fail).rejects.toBeInstanceOf(Error);
  });

  it("does not escape when the decoder mints an atomic rejected promise node", async () => {
    const { escaped, value } = await watchRejections(() =>
      deserializeStream(
        new Response(frame(ATOMIC_REJECTED_GRAPH), {
          headers: { [BODY_FORMAT_HEADER]: SERIALIZED_FORMAT }
        })
      )
    );
    expect(escaped, `the never-consumed atomic rejection escaped: ${escaped.join(", ")}`).toEqual(
      []
    );
    await expect((value as any).slot).rejects.toMatchObject({ message: "never read" });
  });
});
