/**
 * The transport must not tee a body it never reads (#3244, the clone half).
 *
 * `clone()` on a Request/Response is not free and it is not a copy: it tees
 * the body, and the branch nobody drains queues every byte that passes
 * through the branch somebody does. One unread clone therefore costs the
 * whole payload in memory for as long as the read branch runs — defeating
 * the backpressure and cancellation discipline `bufferBodyWithin` already
 * enforces on the upload leg (#3217–#3219).
 *
 * The client made two tees per call: it decoded `response.clone()`, and
 * `extractBody` cloned AGAIN before reading. Nothing ever read the outer
 * response and nothing ever read the intermediate clone, so a streamed
 * result was buffered twice over on top of the copy the caller asked for.
 * The server's argument road stacked the same way: `parseArguments` hands
 * `extractBody` a clone it keeps for the app's own `event.request` reads —
 * a deliberate, documented tee — and `extractBody`'s inner clone turned
 * that into a second, abandoned branch.
 *
 * The invariant pinned here is the one that survives whichever clone turns
 * out to be load-bearing: every clone made on the way to a decode must be
 * READ. `decodeResponse` is the integration-facing entry, whose contract
 * says the caller's response stays readable — so one read clone per call is
 * allowed, and zero is allowed; an abandoned one is the waste. Deliberately
 * structural rather than a heap measurement: the tee is the mechanism, and
 * a byte count taken inside a worker pool measures the other tests as much
 * as this one.
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
import {
  configureServerFunctionsClient,
  createServerReference,
  getServerFunctionsCodec,
  serializeString
} from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
  // What `enableRichArguments()` installs (the rich-args entry has no alias
  // in this config): lets the argument road ride the framed codec encoding,
  // the shape whose abandoned tee costs the most.
  configureServerFunctionsClient({
    serializeArgs: args => serializeString(args, getServerFunctionsCodec())
  });
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
 * Records every body tee that happens while `run` is in flight. A clone
 * left with `bodyUsed === false` is a queue that filled for nobody.
 */
async function tees<T>(
  kind: typeof Request | typeof Response,
  run: () => Promise<T>
): Promise<{ value: T; clones: (Request | Response)[] }> {
  const original = kind.prototype.clone;
  const clones: (Request | Response)[] = [];
  kind.prototype.clone = function clone(this: Request | Response) {
    const teed = original.call(this);
    if (this.body) clones.push(teed);
    return teed;
  } as any;
  try {
    const value = await run();
    return { value, clones };
  } finally {
    kind.prototype.clone = original;
  }
}

const abandoned = (clones: (Request | Response)[]) =>
  clones.filter(clone => !clone.bodyUsed).length;

describe("server-function body buffering (#3244)", () => {
  it("reads every response body it tees, on each encoding a result can ride", async () => {
    // one per format the response side negotiates: the JSON fast path, the
    // streaming codec, and a value with a natural HTTP encoding of its own
    registerServerFunction("buffer-json", async () => ({ items: [1, 2, 3] }));
    registerServerFunction("buffer-serialized", async () => new Date(0));
    registerServerFunction("buffer-native", async () => "here");

    for (const [id, expected] of [
      ["buffer-json", { items: [1, 2, 3] }],
      ["buffer-serialized", new Date(0)],
      ["buffer-native", "here"]
    ] as const) {
      connectTransport();
      const { value, clones } = await tees(Response, () => createServerReference(id)());
      // the result itself is the control: whatever the fix does to the
      // clones, the decoded value may not move
      expect(value).toEqual(expected);
      expect(
        abandoned(clones),
        `${id}: ${abandoned(clones)} of ${clones.length} teed response bodies were never read`
      ).toBe(0);
      expect(clones.length, `${id} teed its body ${clones.length} times`).toBeLessThanOrEqual(1);
    }
  });

  it("does not tee a streamed result once per layer it passes through", async () => {
    // The shape the cost is paid on: a body that arrives over many frames,
    // where each abandoned tee queues the whole stream rather than a header.
    registerServerFunction("buffer-stream", async function* () {
      for (let index = 0; index < 64; index++) yield "x".repeat(1024);
    });
    connectTransport();
    const { value, clones } = await tees(Response, () => createServerReference("buffer-stream")());
    let bytes = 0;
    for await (const frame of value as AsyncIterable<string>) bytes += frame.length;
    expect(bytes).toBe(64 * 1024);
    expect(
      abandoned(clones),
      `${abandoned(clones)} of ${clones.length} teed bodies queued the whole stream for nobody`
    ).toBe(0);
  });

  it("reads every request body it tees on the argument road", async () => {
    // The one deliberate tee is parseArguments' own: it hands the decoder a
    // clone so the app can still read `event.request`. That clone must be
    // the branch that gets READ — a second clone under it (extractBody's)
    // abandoned the first, queueing the whole upload behind the decode.
    registerServerFunction("buffer-args", async (a: { rows: number[] }, b: Date) => ({
      total: a.rows.length,
      time: b.getTime()
    }));
    connectTransport();
    const { value, clones } = await tees(Request, () =>
      // the Date forces the codec road: a serialized (framed, streamable)
      // request body rather than the buffered JSON fast path
      createServerReference("buffer-args")({ rows: [1, 2, 3] }, new Date(0))
    );
    expect(value).toEqual({ total: 3, time: 0 });
    expect(
      abandoned(clones),
      `${abandoned(clones)} of ${clones.length} teed request bodies were never read`
    ).toBe(0);
  });
});
