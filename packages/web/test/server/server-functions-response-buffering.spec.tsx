/**
 * The transport must not tee a response body it never reads.
 *
 * `Response.clone()` is not free and it is not a copy: it tees the body, and
 * the branch nobody drains queues every byte that passes through the branch
 * somebody does. One unread clone therefore costs the whole payload in
 * memory, for as long as the read branch runs.
 *
 * The client makes two of them per call. It decodes `response.clone()`, and
 * `extractBody` clones AGAIN before reading. Nothing ever reads the outer
 * response, and nothing ever reads the intermediate clone, so a streamed
 * result is buffered twice over on top of the copy the caller asked for.
 * Measured peak heap+external over the baseline for one streamed result:
 * 16 MiB -> 47.9, 64 MiB -> 162.6, 128 MiB -> 310.9 — around 2.4x the
 * payload, against ~0.4x with the redundant tees gone and the decoded
 * frames byte-identical.
 *
 * The invariant pinned here is the one that survives whichever clone turns
 * out to be load-bearing: every clone the transport makes on the way to a
 * result must be READ. Exactly one of the two has a reason to exist —
 * `decodeResponse` is the integration-facing entry, where the caller still
 * owns the response it handed over and may read it again, and its contract
 * says so out loud — so one clone per call is allowed and zero is allowed;
 * two, with the first abandoned, is the waste.
 *
 * Deliberately structural rather than a heap measurement: the tee is the
 * mechanism, and a byte count taken inside a worker pool measures the other
 * tests as much as this one.
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
import { createServerReference } from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");

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
 * Records every body tee that happens while `run` is in flight. A clone
 * left with `bodyUsed === false` is a queue that filled for nobody.
 */
async function tees<T>(run: () => Promise<T>): Promise<{ value: T; clones: Response[] }> {
  const original = Response.prototype.clone;
  const clones: Response[] = [];
  Response.prototype.clone = function clone(this: Response) {
    const teed = original.call(this);
    if (this.body) clones.push(teed);
    return teed;
  };
  try {
    const value = await run();
    return { value, clones };
  } finally {
    Response.prototype.clone = original;
  }
}

const abandoned = (clones: Response[]) => clones.filter(clone => !clone.bodyUsed).length;

describe("server-function response buffering", () => {
  it("reads every body it tees, on each encoding a result can ride", async () => {
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
      const { value, clones } = await tees(() => createServerReference(id)());
      // the result itself is the control: whatever the fix does to the
      // clones, the decoded value may not move
      expect(value).toEqual(expected);
      expect(
        abandoned(clones),
        `${id}: ${abandoned(clones)} of ${clones.length} teed bodies were never read`
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
    const { value, clones } = await tees(() => createServerReference("buffer-stream")());
    let bytes = 0;
    for await (const frame of value as AsyncIterable<string>) bytes += frame.length;
    expect(bytes).toBe(64 * 1024);
    expect(
      abandoned(clones),
      `${abandoned(clones)} of ${clones.length} teed bodies queued the whole stream for nobody`
    ).toBe(0);
  });
});
