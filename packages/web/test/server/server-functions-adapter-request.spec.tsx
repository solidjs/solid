/**
 * A host adapter's request need not carry undici's internals (#3311).
 *
 * `bodySizeLimit` buffers a POST body through a counting read, then puts
 * the bytes back in front of the decoder. The rebuild used the copy
 * constructor, `new Request(request, { body })`, which reaches into the
 * source's private state — and srvx, the server layer under Nitro, hands
 * out a lazy `NodeRequest` that only WEARS `Request.prototype`:
 * `instanceof Request` says yes, the native constructor never ran, and the
 * copy threw "Cannot read private member #state". The bare catch around the
 * buffering then answered 400 "Malformed server function arguments", so
 * every POST server function under Nitro failed with a message pointing at
 * the caller's payload, whatever the payload was.
 *
 * Two invariants: the rebuild reads the request's PARTS (url, method,
 * headers, signal — the ones the runtime already reads to get this far), so
 * a request that serves those dispatches; and the 400 covers the READ only.
 * Putting the bytes back is the runtime's own step, and its failure keeps
 * its own error instead of being relabelled as the caller's.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";
const JSON_FORMAT = "8";

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

/**
 * srvx's `NodeRequest`, reduced to the trait that matters: a class that is
 * not a Request — the native constructor never runs — whose prototype is
 * spliced under `Request.prototype` so `instanceof` still says Request, and
 * whose parts are served by getters over the host's own objects. Backed by
 * a real Request so the parts are exactly what a conforming host produces.
 */
function adapterRequest(native: Request, parts: { signal?: AbortSignal } = {}): Request {
  class LazyRequest {
    get url() {
      return native.url;
    }
    get method() {
      return native.method;
    }
    get headers() {
      return native.headers;
    }
    get signal() {
      return parts.signal ?? native.signal;
    }
    get body() {
      return native.body;
    }
  }
  Object.setPrototypeOf(LazyRequest.prototype, Request.prototype);
  return new LazyRequest() as unknown as Request;
}

// the reporter's curl: a scripted JSON-tagged POST, same-origin by Origin
function post(functionId: string, args: unknown[]) {
  return new Request(`https://app.example/_server/data/${functionId}`, {
    method: "POST",
    body: JSON.stringify(args),
    headers: {
      "Content-Type": "application/json",
      Origin: "https://app.example",
      [BODY_FORMAT_HEADER]: JSON_FORMAT
    }
  });
}

describe("server functions on an adapter's lazy request (#3311)", () => {
  it("dispatches a capped POST whose request only wears Request.prototype", async () => {
    const fn = vi.fn(async (...args: unknown[]) => ({ argc: args.length }));
    registerServerFunction("adapter-request-echo", fn);
    const native = post("adapter-request-echo", ["en", "home", []]);
    const lazy = adapterRequest(native);

    // the trait under test: the copy constructor has no state to copy from
    expect(lazy).toBeInstanceOf(Request);
    expect(() => new Request(lazy, { body: new Uint8Array() })).toThrow(TypeError);

    let handed: Request | undefined;
    const response = await handleServerFunctionRequest(lazy, {
      createEvent: request => {
        handed = request;
        return { request, locals: {} };
      }
    });
    expect(response.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0]).toEqual(["en", "home", []]);

    // the request the app is handed kept every part the adapter served...
    expect(handed!.url).toBe(native.url);
    expect(handed!.method).toBe("POST");
    expect(handed!.headers.get(BODY_FORMAT_HEADER)).toBe(JSON_FORMAT);
    expect(handed!.headers.get("content-type")).toBe("application/json");
    // ...and its body is still the app's to read: the decoder took a clone
    expect(await handed!.text()).toBe('["en","home",[]]');
  });

  it("keeps a rebuild failure's own error instead of answering malformed arguments", async () => {
    const fn = vi.fn(async () => "ran");
    registerServerFunction("adapter-request-rebuild-failure", fn);
    // A signal the counting read is content with (aborted, reason, the two
    // listener methods) that is not an AbortSignal, so the read succeeds
    // and only the rebuild refuses it. Whatever the runtime does with that
    // failure, it is not the caller's malformed payload: no 400 relabel.
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener() {},
      removeEventListener() {}
    } as unknown as AbortSignal;
    const lazy = adapterRequest(post("adapter-request-rebuild-failure", []), { signal });

    await expect(handleServerFunctionRequest(lazy)).rejects.toBeInstanceOf(TypeError);
    expect(fn).not.toHaveBeenCalled();
  });
});
