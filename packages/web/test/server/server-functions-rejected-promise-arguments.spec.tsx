/**
 * A decoded argument must never hand the process a rejection nobody holds.
 *
 * seroval's cross-JSON has two promise spellings, and the decode boundary
 * only ever defused one of them. The spelling an honest encoder emits is
 * the CONSTRUCTOR pair — a pending promise under one id, its resolver under
 * the special reference next to it — settled by a later chunk; that pair is
 * exactly what `createJSONDeserializer.abort` sweeps (`{p, s, f}`), and the
 * comment there explains why: "a rejection nobody awaited ... surfacing as
 * an unhandled rejection". The decoder ALSO accepts an atomic promise node
 * (seroval type 12), which no encoder in this codebase writes. It settles
 * synchronously while the first chunk is still decoding and stores the bare
 * promise, so the sweep never sees it and the guard covers one leg only.
 *
 * Handed to a server function as an argument, an already-rejected promise
 * is a rejection nobody awaits: an ordinary function does not await an
 * argument it never expected to be a promise. Node's default policy for an
 * unhandled rejection is to kill the process — so one 115-byte request ends
 * every in-flight request on the pod, on every tenant it serves. The
 * response is 200: the function ran, and the process dies behind it. The
 * request needs nothing privileged. `Sec-Fetch-Site` is forbidden to page
 * script but is one header to curl, and function ids ship in the client
 * bundle the compiler emits.
 *
 * These tests take over the `unhandledRejection` event for the length of
 * one call. Under the runner vitest owns that event and would report the
 * escape as a file-level error; the process-level answer IS the finding, so
 * it is asserted here by name rather than left to the runner's channel.
 *
 * The resolved-flag control in the first test is the argument that this is
 * the decode boundary's problem and not the payload's: the two frames are
 * the same bytes but for `"s"`.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";
const SERIALIZED_FORMAT = "0";

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const provideEvent = <T,>(_event: unknown, run: () => T): T => run();

/** Wraps a payload in the codec's length-prefixed frame. */
function frame(payload: string) {
  const length = new TextEncoder().encode(payload).byteLength;
  return `;0x${length.toString(16).padStart(8, "0")};${payload}`;
}

/** An argument array whose single element is the given node. */
const argumentArray = (node: string) => `{"t":9,"i":0,"a":[${node}],"o":0}`;

/**
 * The atomic promise node: `s` is the settlement flag (0 rejected, 1
 * fulfilled) and `f` the settled value. Handwritten because the encoder
 * never produces this shape — but the wire is text, and a peer writes
 * whatever it likes.
 */
const REJECTED = `{"t":12,"i":1,"s":0,"f":{"t":13,"i":2,"s":0,"m":"pwned","p":{"k":[],"v":[]}}}`;
const FULFILLED = `{"t":12,"i":1,"s":1,"f":{"t":1,"s":"fine"}}`;
/** The same rejected promise, one level down inside a plain object. */
const NESTED_REJECTED =
  `{"t":10,"i":1,"p":{"k":["deep"],"v":[` +
  `{"t":12,"i":2,"s":0,"f":{"t":13,"i":3,"s":0,"m":"pwned","p":{"k":[],"v":[]}}}` +
  `],"s":1}}`;

/**
 * Runs one dispatch owning `unhandledRejection`, and reports what escaped.
 * Two macrotask turns: Node emits the event after the microtask queue
 * drains, and the argument graph settles inside the dispatch's own await.
 */
async function watchRejections(run: () => Promise<Response>) {
  const previous = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  const escaped: string[] = [];
  const capture = (reason: unknown) => escaped.push(String(reason));
  process.on("unhandledRejection", capture);
  try {
    const response = await run();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    return { escaped, status: response.status };
  } finally {
    process.off("unhandledRejection", capture);
    for (const listener of previous) process.on("unhandledRejection", listener as any);
  }
}

let seq = 0;

/** Registers a function that records the argument it was handed. */
function registerProbe() {
  const id = `rejected-promise-argument-${seq++}`;
  const probe = { id, ran: 0, seen: undefined as unknown };
  registerServerFunction(id, async (first: unknown) => {
    probe.ran++;
    probe.seen = first;
    return "ok";
  });
  return probe;
}

const codecBody = (id: string, node: string) =>
  new Request(`https://app.example/_server/data/${id}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      [BODY_FORMAT_HEADER]: SERIALIZED_FORMAT,
      "Sec-Fetch-Site": "same-origin"
    },
    body: frame(argumentArray(node))
  });

const codecQuery = (id: string, node: string) =>
  new Request(
    `https://app.example/_server/data/${id}?args=${encodeURIComponent(frame(argumentArray(node)))}`,
    { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } }
  );

describe("a decoded argument that is an already-rejected promise", () => {
  it("does not escape as an unhandled rejection when it arrives in the body", async () => {
    // the control first: the same node with the fulfilled flag, which is
    // the only byte that differs, and which nothing about this boundary
    // should treat specially
    const control = registerProbe();
    const fulfilled = await watchRejections(() =>
      handleServerFunctionRequest(codecBody(control.id, FULFILLED), { provideEvent })
    );
    expect(
      fulfilled.escaped,
      `the fulfilled control escaped: ${fulfilled.escaped.join(", ")}`
    ).toEqual([]);

    const probe = registerProbe();
    const { escaped, status } = await watchRejections(() =>
      handleServerFunctionRequest(codecBody(probe.id, REJECTED), { provideEvent })
    );
    expect(
      escaped,
      `status=${status} ran=${probe.ran} argumentIsPromise=${probe.seen instanceof Promise}` +
        ` — an unhandled rejection here is process death under Node's default policy`
    ).toEqual([]);
  });

  it("does not escape when the codec frame rides the url's args instead", async () => {
    const probe = registerProbe();
    const { escaped, status } = await watchRejections(() =>
      handleServerFunctionRequest(codecQuery(probe.id, REJECTED), { provideEvent })
    );
    expect(escaped, `status=${status} ran=${probe.ran}`).toEqual([]);
  });

  it("does not escape when it sits inside an ordinary object argument", async () => {
    const probe = registerProbe();
    const { escaped, status } = await watchRejections(() =>
      handleServerFunctionRequest(codecBody(probe.id, NESTED_REJECTED), { provideEvent })
    );
    expect(
      escaped,
      `status=${status} ran=${probe.ran} — the guard must cover the whole argument` +
        ` graph, the way stripUnsafeArgumentKeys already walks it`
    ).toEqual([]);
  });
});
