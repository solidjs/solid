/**
 * @jsxImportSource @solidjs/web
 *
 * Stage 8 B6 — `GET` server components end to end, the server half. A
 * server component declared with `GET(fn)` answers a GET at its data
 * address with a frame stream (length-prefixed records, cacheable on the
 * url alone) and a GET at its live address with the same records framed as
 * server-sent events — what `curl -N` shows. The `GET()` grant governs a
 * frame response exactly as it governs a codec one: an undeclared component
 * refuses GET, and a declared one passes the origin gate. The client's POST
 * fallback for long arguments decodes at the data address into the same
 * frame stream.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { frameTransformResult } from "../../frames/src/frame-sink.js";
import {
  GET,
  createServerReference,
  getServerFunctionInvocation,
  handleServerFunctionRequest,
  live,
  registerServerFunction,
  registerServerReference,
  serverFunctionUrl
} from "../../server-functions/src/server.js";
import { ChunkReader, EventStreamReader } from "../../server-functions/src/shared.js";

const RequestContext = Symbol.for("solid.RequestContext");
beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});
afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const handle = (request: Request) =>
  handleServerFunctionRequest(request, { transformResult: frameTransformResult });

const get = (address: "live" | "data", id: string, args?: unknown[], headers: HeadersInit = {}) =>
  new Request(
    `http://localhost/_server/${address}/${id}` +
      (args ? `?args=${encodeURIComponent(JSON.stringify(args))}` : ""),
    { method: "GET", headers }
  );

/** Markup with the text-hole markers dropped, for reading what it says. */
const textOf = (html: string) => html.replace(/<!--\$-->|<!--\/-->/g, "");

/** Every chunk of a frame body, read with the reader the content type selects. */
async function chunksOf(response: Response) {
  const live = (response.headers.get("Content-Type") || "").startsWith("text/event-stream");
  const reader: any = live
    ? new (EventStreamReader as any)(response.body, {})
    : new ChunkReader(response.body!);
  const out: any[] = [];
  await reader.drain((data: string) => out.push(JSON.parse(data)));
  return out;
}

/** A GET-declared server component whose argument shows in its markup. */
function declareGreeting(id: string) {
  const seen: any[] = [];
  const ref = GET(
    createServerReference(
      registerServerReference(id, async (name: string) => {
        seen.push(getServerFunctionInvocation());
        return () => <p class="greeting">hello {name}</p>;
      })
    )
  );
  return { ref, seen };
}

describe("GET server components end to end (Stage 8 B6)", () => {
  it("a GET at the data address answers a frame stream, arguments from the query, past the origin gate", async () => {
    const { seen } = declareGreeting("frame-get-data");
    // The request a cache or a `<link rel="preload">` makes: no client
    // runtime headers at all, and (a declared read) any origin.
    const response = await handle(
      get("data", "frame-get-data", ["ann"], { "Sec-Fetch-Site": "cross-site" })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Frame-Stream")).toBe("frame-get-data");
    expect(response.headers.get("Content-Type")).toBe("application/x-frame-stream");
    expect(seen).toEqual([{ id: "frame-get-data", live: false }]);
    const text = await response.clone().text();
    expect(text).toMatch(/^;0x[0-9a-f]{8};\{/);
    const chunks = await chunksOf(response);
    expect(chunks.map(c => c.type)).toEqual(["start", "html", "complete"]);
    expect(textOf(chunks[1].html)).toContain("hello ann");
  });

  it("a GET at the live address answers the same records as an event stream — what `curl -N` shows", async () => {
    const { seen } = declareGreeting("frame-get-live");
    const data = await chunksOf(await handle(get("data", "frame-get-live", ["bo"])));

    const response = await handle(get("live", "frame-get-live", ["bo"]));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Frame-Stream")).toBe("frame-get-live");
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(seen[1]).toEqual({ id: "frame-get-live", live: true });
    const text = await response.clone().text();
    // One `data:` line per frame record, blank-line separated; no length prefixes.
    const lines = text.split("\n").filter(l => l.startsWith("data: "));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^data: \{"type":"start"/);
    expect(text).not.toMatch(/;0x[0-9a-f]{8};/);
    const chunks = await chunksOf(response);
    expect(chunks.map(c => c.type)).toEqual(data.map(c => c.type));
    expect(chunks[1].html).toBe(data[1].html);
    expect(textOf(chunks[1].html)).toContain("hello bo");
  });

  it("the grant governs frame responses: an undeclared server component refuses GET at either address", async () => {
    let ran = 0;
    registerServerFunction("frame-get-undeclared", async () => {
      ran++;
      return () => <p>never</p>;
    });
    const data = await handle(
      get("data", "frame-get-undeclared", [], { "Sec-Fetch-Site": "same-origin" })
    );
    expect(data.status).toBe(405);
    expect(data.headers.get("Allow")).toContain("POST");
    const liveResponse = await handle(
      get("live", "frame-get-undeclared", [], { "Sec-Fetch-Site": "same-origin" })
    );
    expect(liveResponse.status).toBe(405);
    // A cross-site GET never reaches the body: the origin gate, not a 405.
    const cross = await handle(
      get("data", "frame-get-undeclared", [], { "Sec-Fetch-Site": "cross-site" })
    );
    expect(cross.status).toBe(403);
    expect(ran).toBe(0);
  });

  it("the POST fallback for long arguments decodes at the data address into the same frame stream", async () => {
    declareGreeting("frame-get-long");
    const name = "n".repeat(3000);
    const response = await handle(
      new Request("http://localhost/_server/data/frame-get-long", {
        method: "POST",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          // JSON-safe arguments travel as JSON, the way the client's
          // fallback sends them (see GET's client half).
          "Content-Type": "application/json",
          "X-Server-Function-Format": "8"
        },
        body: JSON.stringify([name])
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/x-frame-stream");
    const chunks = await chunksOf(response);
    expect(chunks.map(c => c.type)).toEqual(["start", "html", "complete"]);
    expect(textOf(chunks[1].html)).toContain("hello " + name);
  });

  it("serverFunctionUrl renders the GET component's data url, and a live reference's live address (open (d))", async () => {
    const { ref } = declareGreeting("frame-get-url");
    expect(serverFunctionUrl(ref as any, "ann")).toBe(
      "/_server/data/frame-get-url?args=%5B%22ann%22%5D"
    );
    const standing = live(ref as any);
    const url = serverFunctionUrl(standing as any, "ann");
    expect(url).toBe("/_server/live/frame-get-url?args=%5B%22ann%22%5D");
    // A fetch of it IS the live call: the event stream.
    const response = await handle(new Request("http://localhost" + url, { method: "GET" }));
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const chunks = await chunksOf(response);
    expect(textOf(chunks[1].html)).toContain("hello ann");
  });
});
