/**
 * Stream detection in the JSON decoder requires a real stream. A plain
 * object that happens to carry a `__SEROVAL_STREAM__` key is ordinary data
 * (up to seroval 1.6.7 `isStream` is only that key check): it reaches the
 * function as written, and the body's end-of-stream sweep (`abort` /
 * `close` / `open`) leaves it alone instead of calling stream methods it
 * does not have.
 *
 * seroval 1.6.7's own encoder refuses to send such a value (it takes the
 * key for a stream), but any HTTP client can: the request below is the
 * client's real encoding of `{ marker: true }` with the key renamed on the
 * wire and the frames re-measured.
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
import {
  configureServerFunctionsClient,
  createServerReference,
  getServerFunctionsCodec,
  serializeString
} from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";
const JSON_FORMAT = "8";

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
  configureServerFunctionsClient({
    serializeArgs: args => serializeString(args, getServerFunctionsCodec())
  });
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Rewrites each length-prefixed frame (`;0x` + 8 hex digits + `;` + payload)
// and re-measures it.
function rewriteFrames(
  body: Uint8Array,
  rewrite: (payload: string) => string
): Uint8Array<ArrayBuffer> {
  const out: Uint8Array[] = [];
  let at = 0;
  while (at < body.length) {
    const length = parseInt(decoder.decode(body.subarray(at + 3, at + 11)), 16);
    const payload = encoder.encode(
      rewrite(decoder.decode(body.subarray(at + 12, at + 12 + length)))
    );
    out.push(encoder.encode(`;0x${payload.length.toString(16).padStart(8, "0")};`), payload);
    at += 12 + length;
  }
  const joined = new Uint8Array(out.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of out) joined.set(c, (offset += c.length) - c.length);
  return joined;
}

function connectRenamingTransport(from: string, to: string) {
  const original = globalThis.fetch;
  const formats: (string | null)[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request =
      input instanceof Request
        ? input
        : new Request(new URL(input.toString(), "https://app.example"), init);
    formats.push(request.headers.get(BODY_FORMAT_HEADER));
    const body = rewriteFrames(new Uint8Array(await request.arrayBuffer()), payload =>
      payload.split(JSON.stringify(from)).join(JSON.stringify(to))
    );
    const headers = new Headers(request.headers);
    headers.set("Sec-Fetch-Site", "same-origin");
    headers.delete("Content-Length");
    return handleServerFunctionRequest(
      new Request(request.url, { method: request.method, headers, body })
    );
  }) as typeof fetch;
  return {
    formats,
    restore() {
      globalThis.fetch = original;
    }
  };
}

describe("a request body carrying a `__SEROVAL_STREAM__` key", () => {
  it("decodes it as ordinary data and ends the body cleanly", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    let received: unknown;
    registerServerFunction("stream-tag-as-data", async (value: unknown, _n: number) => {
      received = value;
      return "ok";
    });
    const transport = connectRenamingTransport("marker", "__SEROVAL_STREAM__");
    try {
      // NaN keeps the arguments off the JSON fast path, so the body rides
      // the codec and the server decodes it with the JSON deserializer.
      const result = await createServerReference("stream-tag-as-data")({ marker: true }, NaN);
      expect(transport.formats[0]).not.toBe(JSON_FORMAT);
      expect(result).toBe("ok");
      expect(received).toEqual({ __SEROVAL_STREAM__: true });
      // The end-of-body sweep runs after the drain settles.
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(rejections.map(String)).toEqual([]);
    } finally {
      transport.restore();
      process.off("unhandledRejection", onRejection);
    }
  });
});
