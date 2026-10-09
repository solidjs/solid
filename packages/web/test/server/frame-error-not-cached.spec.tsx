/**
 * @jsxImportSource @solidjs/web
 *
 * A server component wrapped in `respond(View, { headers })` contributes
 * those headers to the frame response. The component renders while the
 * response is being built, so a throw in that pass is known before the head
 * leaves: the render marks the response, and the transport finalizer
 * declines to store it. The status stays 200 and the body still carries the
 * `:error` record — that is how the client surfaces it. The mark itself
 * never leaves. A render that succeeds keeps the author's headers, and so
 * does a returned `{ error }` value: the author chose that value and the
 * headers that travel with it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { respond } from "@solidjs/web";
import { frameTransformResult } from "../../frames/src/frame-sink.js";
import {
  GET,
  createServerReference,
  handleServerFunctionRequest,
  registerServerReference
} from "../../server-functions/src/server.js";
import { ChunkReader, FAILED_VALUE_HEADER } from "../../server-functions/src/shared.js";

const RequestContext = Symbol.for("solid.RequestContext");
beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});
afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const handle = (request: Request) =>
  handleServerFunctionRequest(request, { transformResult: frameTransformResult });

const cacheable = { headers: { "cache-control": "public, max-age=60" } };

function declare(id: string, fn: () => unknown) {
  return GET(createServerReference(registerServerReference(id, fn)));
}

const get = (id: string) => new Request(`http://localhost/_server/data/${id}`, { method: "GET" });

async function chunksOf(response: Response) {
  const reader: any = new ChunkReader(response.body!);
  const out: any[] = [];
  await reader.drain((data: string) => out.push(JSON.parse(data)));
  return out;
}

describe("a thrown server component is not cached behind respond() headers", () => {
  it("a sync throw answers 200, no-store, with the error record still in the body", async () => {
    declare("frame-error-cache-throw", async () => {
      const user = null;
      return respond(() => <h1>User : {user!.id}</h1>, cacheable);
    });
    const response = await handle(get("frame-error-cache-throw"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get(FAILED_VALUE_HEADER)).toBeNull();
    expect(response.headers.get("X-Frame-Stream")).toBe("frame-error-cache-throw");
    const chunks = await chunksOf(response);
    const error = chunks.find(c => c.type === "error" && !c.key);
    expect(error).toBeTruthy();
    expect(String(error.error)).toContain("id");
  });

  it("a render that succeeds keeps the author's Cache-Control", async () => {
    declare("frame-error-cache-ok", async () => respond(() => <h1>User : ada</h1>, cacheable));
    const response = await handle(get("frame-error-cache-ok"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get(FAILED_VALUE_HEADER)).toBeNull();
    const chunks = await chunksOf(response);
    expect(chunks.map(c => c.type)).toEqual(["start", "html", "complete"]);
  });

  it("a returned { error } value keeps the author's Cache-Control", async () => {
    declare("frame-error-cache-value", async () => respond({ error: "nope" }, cacheable));
    const response = await handle(get("frame-error-cache-value"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get(FAILED_VALUE_HEADER)).toBeNull();
    expect(response.headers.get("X-Frame-Stream")).toBeNull();
    expect(await response.json()).toEqual({ error: "nope" });
  });
});
