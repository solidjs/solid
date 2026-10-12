/**
 * @jsxImportSource @solidjs/web
 *
 * A server component wrapped in `respond(View, { headers })` contributes
 * those headers to the frame response. The component renders while the
 * response is being built, so a throw in that pass is known before the head
 * leaves, and `serverComponentResponse` declares the response uncacheable:
 * `no-store`, with the CDN-targeted fields that would override it at a CDN
 * removed. The status stays 200 and the body still carries the `:error`
 * record — that is how the client surfaces it. A render that succeeds keeps
 * the author's headers, and so does a returned `{ error }` value: the author
 * chose that value and the headers that travel with it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { respond } from "@solidjs/web";
import { frameTransformResult, serverComponentResponse } from "../../frames/src/frame-sink.js";
import {
  GET,
  createServerReference,
  handleServerFunctionRequest,
  registerServerReference
} from "../../server-functions/src/server.js";
import { ChunkReader } from "../../server-functions/src/shared.js";

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
const cdnCacheable = {
  headers: {
    "cache-control": "public, max-age=60",
    "cdn-cache-control": "max-age=600",
    "cloudflare-cdn-cache-control": "max-age=600",
    "surrogate-control": "max-age=600",
    vary: "Accept-Language"
  }
};
const cdnFields = ["cdn-cache-control", "cloudflare-cdn-cache-control", "surrogate-control"];

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
      const user: { id: string } | null = null;
      return respond(() => <h1>User : {user!.id}</h1>, cacheable);
    });
    const response = await handle(get("frame-error-cache-throw"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
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
    const chunks = await chunksOf(response);
    expect(chunks.map(c => c.type)).toEqual(["start", "html", "complete"]);
  });

  it("a returned { error } value keeps the author's Cache-Control", async () => {
    declare("frame-error-cache-value", async () => respond({ error: "nope" }, cacheable));
    const response = await handle(get("frame-error-cache-value"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("X-Frame-Stream")).toBeNull();
    expect(await response.json()).toEqual({ error: "nope" });
  });

  it("a sync throw also drops the CDN-targeted fields that would override no-store", async () => {
    declare("frame-error-cache-cdn-throw", async () => {
      const user: { id: string } | null = null;
      return respond(() => <h1>User : {user!.id}</h1>, cdnCacheable);
    });
    const response = await handle(get("frame-error-cache-cdn-throw"));
    expect(response.headers.get("cache-control")).toBe("no-store");
    for (const name of cdnFields) expect(response.headers.get(name), name).toBeNull();
    expect(response.headers.get("vary")).toBe("Accept-Language");
  });

  it("a render that succeeds keeps the CDN-targeted fields", async () => {
    declare("frame-error-cache-cdn-ok", async () =>
      respond(() => <h1>User : ada</h1>, cdnCacheable)
    );
    const response = await handle(get("frame-error-cache-cdn-ok"));
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    for (const name of cdnFields) expect(response.headers.get(name), name).toBe("max-age=600");
  });

  it("serverComponentResponse called directly declines to store a sync throw", async () => {
    const user: { id: string } | null = null;
    const response = serverComponentResponse(
      () => <h1>User : {user!.id}</h1>,
      { frame: { id: "direct" } },
      cdnCacheable
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    for (const name of cdnFields) expect(response.headers.get(name), name).toBeNull();
    const chunks = await chunksOf(response);
    expect(chunks.some(c => c.type === "error" && !c.key)).toBe(true);
  });
});
