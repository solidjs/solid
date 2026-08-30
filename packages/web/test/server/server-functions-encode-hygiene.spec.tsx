/**
 * Encoding-layer hygiene of `handleServerFunctionRequest` (#3093, #3095):
 *
 * - The error header is a classification label — the structured error
 *   travels in the body — so its value is bounded. Unbounded, a long
 *   message (nine-fold inflated by percent-encoding for non-latin1) blows
 *   past receiver header limits and the whole response stops being
 *   readable: a network error in place of the application error (#3093).
 * - Null-body statuses (204, 205, 304) answer void results with a real
 *   null-body response instead of a `TypeError` from the `Response`
 *   constructor that dispatch's catch used to sanitize into a phantom
 *   generic error at 200. A value-carrying result on such a status is an
 *   authoring error and is reported legibly, naming the status (#3095).
 *
 * Like the other server-function specs, these run against the built
 * bundles (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { markSafeError, respond } from "@solidjs/web";
import {
  ERROR_HEADER,
  decodeErrorHeaderValue,
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

/** Routes the client stub's fetch straight into the handler. */
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
  return () => {
    globalThis.fetch = original;
  };
}

/** A scripted POST as the client runtime sends it. */
function scriptedPost(id: string) {
  return new Request(`https://app.example/_server/data/${id}`, {
    method: "POST",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "X-Server-Function-Instance": "server-function:test"
    }
  });
}

describe("error header value is bounded (#3093)", () => {
  it("caps a long ASCII message to a readable prefix", async () => {
    const message = "E".repeat(32 * 1024);
    registerServerFunction("encode-header-ascii", async () => {
      throw markSafeError(new Error(message));
    });

    const response = await handleServerFunctionRequest(scriptedPost("encode-header-ascii"));
    const header = response.headers.get(ERROR_HEADER)!;
    expect(header.length).toBeLessThanOrEqual(1024);
    expect(message.startsWith(header)).toBe(true);
  });

  it("keeps the encoded form of a non-latin1 message under the bound", async () => {
    // percent-encoding expands Cyrillic ~9x: unbounded, ~1.8 KB of text
    // already crosses nginx's default proxy buffers
    const message = "Ошибка".repeat(8 * 1024);
    registerServerFunction("encode-header-cyrillic", async () => {
      throw markSafeError(new Error(message));
    });

    const response = await handleServerFunctionRequest(scriptedPost("encode-header-cyrillic"));
    expect(response.headers.get(ERROR_HEADER)!.length).toBeLessThanOrEqual(1024);
  });

  it("loses nothing: the full error still arrives through the body", async () => {
    const message = "Э".repeat(32 * 1024);
    registerServerFunction("encode-header-body", async () => {
      throw markSafeError(new Error(message));
    });

    const restore = connectTransport();
    try {
      await expect(createServerReference("encode-header-body")()).rejects.toMatchObject({
        message
      });
    } finally {
      restore();
    }
  });

  it("leaves short messages untouched", async () => {
    registerServerFunction("encode-header-short", async () => {
      throw markSafeError(new Error("boom"));
    });

    const response = await handleServerFunctionRequest(scriptedPost("encode-header-short"));
    expect(response.headers.get(ERROR_HEADER)).toBe("boom");
  });
});

describe("null-body statuses (#3095)", () => {
  it("a void envelope answers the real status with no body", async () => {
    for (const status of [204, 205] as const) {
      registerServerFunction(`encode-void-${status}`, async () =>
        respond(undefined, { status, headers: { "X-Marker": "kept" } })
      );

      const response = await handleServerFunctionRequest(scriptedPost(`encode-void-${status}`));
      expect(response.status).toBe(status);
      expect(response.body).toBeNull();
      expect(response.headers.get("X-Marker")).toBe("kept");
      expect(response.headers.has(ERROR_HEADER)).toBe(false);
    }
  });

  it("a raw null-body Response survives the trip and resolves undefined", async () => {
    registerServerFunction("encode-raw-204", async () => new Response(null, { status: 204 }));

    const wire = await handleServerFunctionRequest(scriptedPost("encode-raw-204"));
    expect(wire.status).toBe(204);
    expect(wire.body).toBeNull();
    expect(wire.headers.has(ERROR_HEADER)).toBe(false);

    const restore = connectTransport();
    try {
      await expect(createServerReference("encode-raw-204")()).resolves.toBeUndefined();
    } finally {
      restore();
    }
  });

  it("a value on a null-body status fails legibly, naming the status", async () => {
    registerServerFunction("encode-value-204", async () => respond({ a: 1 }, { status: 204 }));

    const wire = await handleServerFunctionRequest(scriptedPost("encode-value-204"));
    // an honest failure, not a phantom sanitized 200
    expect(wire.status).toBe(500);
    expect(wire.headers.has(ERROR_HEADER)).toBe(true);

    const restore = connectTransport();
    try {
      const call = createServerReference("encode-value-204")();
      await expect(call).rejects.toThrowError(/204/);
      await expect(call).rejects.not.toThrowError(/Internal Server Error/);
    } finally {
      restore();
    }
  });
});

/**
 * The bound is enforced by re-encoding a shrinking slice of the SOURCE,
 * never by cutting the encoded form — a percent escape severed in half
 * (`%D0` without its second byte) leaves a header that no longer decodes.
 * Asserting only the length cannot tell the two implementations apart:
 * ASCII encodes to itself, and a truncated Cyrillic value is still short
 * enough to pass. Decoding it is what pins the difference.
 */
describe("the bound applies to the source, not to the encoding (#3093)", () => {
  // A percent escape is six characters (`%D0%AF`), so where the ceiling
  // lands inside the encoded form depends on what precedes the run. With
  // no padding it lands on an escape boundary and a naive
  // `encode(message).slice(0, LIMIT)` produces a value that still decodes
  // — that case cannot tell the two implementations apart. One character
  // of padding moves the ceiling into the middle of an escape, and the
  // naive form stops decoding. Both are here so the property is stated
  // rather than sampled.
  for (const padding of [0, 1]) {
    it(`a bounded non-latin1 header decodes back to a prefix of the message (padding ${padding})`, async () => {
      const message = `${"x".repeat(padding)}${"\u042f".repeat(600)}`;
      const id = `bounded-cyrillic-roundtrip-${padding}`;
      registerServerFunction(id, async () => {
        throw markSafeError(new Error(message));
      });

      const response = await handleServerFunctionRequest(scriptedPost(id));
      const encoded = response.headers.get(ERROR_HEADER)!;

      expect(encoded.length).toBeLessThanOrEqual(1024);
      const decoded = decodeErrorHeaderValue(encoded);
      expect(decoded.length).toBeGreaterThan(0);
      expect(message.startsWith(decoded)).toBe(true);
    });
  }
});
