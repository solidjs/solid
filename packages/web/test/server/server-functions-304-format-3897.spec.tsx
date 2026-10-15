/**
 * A browser-managed conditional GET replays the cached body (#3897).
 *
 * The first answer stores `{ value: 17 }` under its body-format tag. The
 * revalidation is a 304, which RFC 9111 §3.2 applies as an update to that
 * stored entry: header fields the 304 carries replace the stored ones, and
 * the body stays the original payload. The browser then hands the page a
 * 200 whose body is the cached JSON and whose headers are the freshened
 * set. Stamping a different `X-Server-Function-Format` onto the 304
 * retargets that body, and the decoder answers `undefined`.
 *
 * A scripted 304 with no cached body still resolves to `undefined`
 * (`server-functions-redirect-status`, #3101). This file only guards the
 * tag a 304 must not use to overwrite a stored representation.
 *
 * Runs against the built bundles (server-functions/dist/*, wired up in
 * vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRequestEvent, respond } from "@solidjs/web";
import {
  GET as serverGET,
  createServerReference,
  decodeResponse,
  handleServerFunctionRequest,
  registerServerReference
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";

// Hop-by-hop and content-framing fields a cache does not take from a 304.
// Everything else the 304 carries replaces the stored field (RFC 9111 §3.2).
const NOT_FRESHENED = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
  "content-range"
]);

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

function declareGET(id: string, fn: (...args: any[]) => any) {
  serverGET(createServerReference(registerServerReference(id, fn)));
}

/** A scripted GET, the address `GET(fn)()` requests. */
function scriptedGet(id: string, headers: Record<string, string> = {}) {
  return new Request(`https://app.example/_server/data/${id}`, {
    method: "GET",
    headers
  });
}

/**
 * The stored entry after a cache applies the 304: original body, status
 * the browser reports (200), headers freshened from the 304.
 */
function freshen(stored: Response, update: Response, body: string) {
  const headers = new Headers(stored.headers);
  update.headers.forEach((value, name) => {
    if (!NOT_FRESHENED.has(name)) headers.set(name, value);
  });
  return new Response(body, { status: 200, headers });
}

describe("a 304 does not retarget a cached GET representation (#3897)", () => {
  it("replays the cached { value: 17 } after a browser conditional GET", async () => {
    const headers = {
      etag: '"constant"',
      "cache-control": "private, max-age=0, must-revalidate"
    };
    const calls: (string | null)[] = [];
    declareGET("conditional-3897", () => {
      const conditional = getRequestEvent()!.request.headers.get("if-none-match");
      calls.push(conditional);
      return conditional === '"constant"'
        ? new Response(null, { status: 304, headers })
        : respond({ value: 17 }, { headers });
    });

    const fresh = await handleServerFunctionRequest(scriptedGet("conditional-3897"));
    expect(fresh.status).toBe(200);
    const storedFormat = fresh.headers.get(BODY_FORMAT_HEADER);
    expect(storedFormat).toBeTruthy();
    const body = await fresh.text();
    expect(JSON.parse(body)).toEqual({ value: 17 });

    const notModified = await handleServerFunctionRequest(
      scriptedGet("conditional-3897", { "If-None-Match": '"constant"' })
    );
    expect(notModified.status).toBe(304);
    expect(notModified.body).toBeNull();
    expect(notModified.headers.get("etag")).toBe('"constant"');
    expect(notModified.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
    // Absent keeps the stored tag. The same tag is a no-op update. A
    // different tag is the overwrite: the cached body is decoded as void.
    expect(notModified.headers.get(BODY_FORMAT_HEADER) ?? storedFormat).toBe(storedFormat);

    const replay = freshen(fresh, notModified, body);
    expect(replay.headers.get(BODY_FORMAT_HEADER)).toBe(storedFormat);
    expect(await decodeResponse(replay)).toEqual({ value: 17 });
    expect(calls).toEqual([null, '"constant"']);
  });

  it("a 204 still carries the void tag — it is the stored answer", async () => {
    declareGET("void-204-3897", () => respond(undefined, { status: 204 }));
    const response = await handleServerFunctionRequest(scriptedGet("void-204-3897"));
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(response.headers.get(BODY_FORMAT_HEADER)).toBe("9");
  });
});
