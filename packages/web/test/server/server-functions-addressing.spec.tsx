/**
 * The wire addresses of a server function call (#3070, #3094): the plain-HTTP
 * address `<endpoint>/<id>` — rendered into documents, hit by form posts and
 * hand-driven callers — and the data address `<endpoint>/data/<id>` the
 * client transport's own calls go to. Arguments ride the query on both.
 *
 * The id is in the path because that is what per-function policy keys on —
 * edge rules, cache policies by path pattern, log aggregation, route labels —
 * and because it leaves one place in the request carrying it, so nothing can
 * disagree with what a cache stored the response under. Arguments stay in the
 * query, which caches key on, log tooling scrubs, and path normalization
 * leaves alone. The two caller kinds get differently shaped answers (codec
 * encodings vs plain HTTP), and a shared cache stores one answer per url —
 * splitting the shapes across two paths is what keeps one caller kind's
 * cached answer from ever being replayed to the other (#3094).
 *
 * Like the extension specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  GET as serverGET,
  createServerReference as createServerSideReference,
  handleServerFunctionRequest,
  parseServerFunctionUrl as parseServerFunctionUrlServer,
  registerServerFunction,
  registerServerReference,
  serverFunctionUrl as serverFunctionUrlServer
} from "@solidjs/web/server-functions/server";
import {
  GET,
  configureServerFunctionsClient,
  createServerReference,
  parseServerFunctionUrl,
  serverFunctionUrl,
  subscribeFlightData
} from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

/** The client transport's fetch, dispatching into the built server handler. */
function connectTransport(seen: Request[]) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request =
      input instanceof Request
        ? input
        : new Request(new URL(input.toString(), "http://localhost"), init);
    seen.push(request);
    request.headers.set("Sec-Fetch-Site", "same-origin");
    return handleServerFunctionRequest(request);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** A call made without the client runtime: no instance header. */
function unscripted(url: string, init: RequestInit = {}) {
  return handleServerFunctionRequest(
    new Request(`http://localhost${url}`, {
      ...init,
      headers: { "Sec-Fetch-Site": "same-origin", ...init.headers }
    })
  );
}

describe("server-function addressing (#3070, built bundles)", () => {
  it("addresses a GET call by path and carries its arguments in the query", async () => {
    serverGET(
      createServerSideReference(registerServerReference("addr-get-0", async (n: number) => n * 2))
    );
    const seen: Request[] = [];
    const restore = connectTransport(seen);
    try {
      const fetchDouble = GET(createServerReference("addr-get-0"));
      // `.url` is the PLAIN-HTTP address — what renders into a document
      expect(fetchDouble.url).toBe("/_server/addr-get-0");
      expect(await fetchDouble(21)).toBe(42);
    } finally {
      restore();
    }
    // the transport's own call goes to the data address (#3094)
    expect(seen.map(request => request.url)).toEqual([
      "http://localhost/_server/data/addr-get-0?args=%5B21%5D"
    ]);
  });

  it("addresses a POST call by path, with nothing in the query", async () => {
    registerServerFunction("addr-post-0", async (word: string) => word.toUpperCase());
    const seen: Request[] = [];
    const restore = connectTransport(seen);
    try {
      expect(await createServerReference("addr-post-0")("solid")).toBe("SOLID");
    } finally {
      restore();
    }
    expect(seen.map(request => request.url)).toEqual(["http://localhost/_server/data/addr-post-0"]);
  });

  it("falls back to POST when the arguments outgrow the url", async () => {
    serverGET(
      createServerSideReference(
        registerServerReference("addr-long-0", async (text: string) => text.length)
      )
    );
    const seen: Request[] = [];
    const restore = connectTransport(seen);
    try {
      const measure = GET(createServerReference("addr-long-0"));
      // short arguments stay on the cacheable transport
      expect(await measure("solid")).toBe(5);
      // long ones dispatch, uncached, rather than meeting a 414 somewhere
      expect(await measure("x".repeat(3000))).toBe(3000);
    } finally {
      restore();
    }
    expect(seen.map(request => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "GET /_server/data/addr-long-0",
      "POST /_server/data/addr-long-0"
    ]);
    expect(new URL(seen[1].url).search).toBe("");
  });

  it("keeps the fallback a read: no single-flight collection asked for", async () => {
    serverGET(
      createServerSideReference(
        registerServerReference("addr-long-1", async (text: string) => text.length)
      )
    );
    const seen: Request[] = [];
    const restore = connectTransport(seen);
    // subscribing IS the single-flight opt-in — a mutation-shaped call would
    // now ask the server to collect, and a read must not
    const unsubscribe = subscribeFlightData(() => {});
    try {
      const measure = GET(createServerReference("addr-long-1"));
      expect(await measure("x".repeat(3000))).toBe(3000);
    } finally {
      unsubscribe();
      restore();
    }
    expect(seen[0].method).toBe("POST");
    expect(seen[0].headers.get("X-Single-Flight")).toBeNull();
  });

  it("carries bound arguments in the query with the body as the trailing one", async () => {
    let seen: unknown[] = [];
    registerServerFunction("addr-bound-0", async (...args: unknown[]) => {
      seen = args;
      return "saved";
    });
    const body = new FormData();
    body.set("title", "Async Solid");
    // what a rendered `<form action>` for a bound action posts, with no client
    // runtime on the other end: the outcome rides the no-JS redirect
    const response = await unscripted(serverFunctionUrl("addr-bound-0", ["story-7"]), {
      method: "POST",
      body,
      headers: { referer: "http://localhost/stories" }
    });
    expect(response.status).toBe(303);
    expect(seen[0]).toBe("story-7");
    expect((seen[1] as FormData).get("title")).toBe("Async Solid");
  });

  it("builds and reads back the urls integrations compose", async () => {
    expect(serverFunctionUrl("addr-url-0")).toBe("/_server/addr-url-0");
    expect(serverFunctionUrl("addr-url-0", ["story-7"])).toBe(
      "/_server/addr-url-0?args=%5B%22story-7%22%5D"
    );
    expect(parseServerFunctionUrl("/_server/addr-url-0?args=%5B%22story-7%22%5D")).toBe(
      "addr-url-0"
    );
    // the data address reads back to the same id — telemetry reading the
    // transport's own requests resolves them like rendered urls
    expect(parseServerFunctionUrl("/_server/data/addr-url-0")).toBe("addr-url-0");
    expect(parseServerFunctionUrl("/somewhere/else")).toBeNull();
    // the server entry ships the same pair, so isomorphic integration code
    // resolves on either side
    expect(serverFunctionUrlServer("addr-url-0", ["story-7"])).toBe(
      "/_server/addr-url-0?args=%5B%22story-7%22%5D"
    );
    expect(parseServerFunctionUrlServer("/_server/addr-url-0")).toBe("addr-url-0");
  });

  it("hands an unscripted read its own query as one URLSearchParams", async () => {
    // What `<form method="get" action={fn.url}>` sends: the browser replaces
    // the action url's query with the form's fields, and the address in the
    // path is what survives it.
    serverGET(
      createServerSideReference(
        registerServerReference("addr-form-0", async (params: URLSearchParams) => ({
          q: params.get("q"),
          page: params.get("page")
        }))
      )
    );
    const response = await unscripted("/_server/addr-form-0?q=solid&page=2");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ q: "solid", page: "2" });
  });

  it("describes the same read on HEAD: same arguments, no body", async () => {
    serverGET(
      createServerSideReference(
        registerServerReference("addr-form-2", async (params: URLSearchParams) => params.get("q"))
      )
    );
    const response = await unscripted("/_server/addr-form-2?q=solid", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });

  it("keeps the address well-formed when the endpoint carries a trailing slash", () => {
    try {
      configureServerFunctionsClient({ endpoint: "/rpc/" });
      expect(serverFunctionUrl("addr-mount-0")).toBe("/rpc/addr-mount-0");
      expect(parseServerFunctionUrl("/rpc/addr-mount-0")).toBe("addr-mount-0");
    } finally {
      configureServerFunctionsClient({ endpoint: "/_server" });
    }
  });

  it("round-trips an id through characters the path has to encode", async () => {
    registerServerFunction("addr#dev-name", async () => "ok");
    const response = await unscripted(serverFunctionUrl("addr#dev-name"), { method: "POST" });
    expect(await response.text()).toBe("ok");
  });

  it("answers the same url the same way, scripted or not", async () => {
    // The reading is decided by the url alone: a cache keys on the url, so a
    // request header must never change what a call means.
    serverGET(
      createServerSideReference(
        registerServerReference("addr-invariant-0", async (value: unknown) =>
          value instanceof URLSearchParams ? `params:${value.get("q")}` : `other:${typeof value}`
        )
      )
    );
    const scripted = await unscripted("/_server/addr-invariant-0?q=solid", {
      headers: { "X-Server-Function-Instance": "server-function:test" }
    });
    const plain = await unscripted("/_server/addr-invariant-0?q=solid");
    expect(await scripted.text()).toBe("params:solid");
    expect(await plain.text()).toBe("params:solid");
  });

  it("shapes the answer by the url alone (#3094)", async () => {
    // The two caller kinds get differently shaped answers — the codec's at
    // the data address, plain HTTP at the bare one — and a shared cache
    // stores one answer per url. So the shape must be a function of the url,
    // never of a request header: at either address, the same url answers
    // with the same shape whether or not the instance header rides along.
    serverGET(
      createServerSideReference(
        registerServerReference(
          "addr-shape-0",
          async () =>
            new Response("<rss/>", {
              headers: { "Content-Type": "application/rss+xml" }
            })
        )
      )
    );

    // data address: the codec shape, header or no header
    const dataTagged = await unscripted("/_server/data/addr-shape-0", {
      headers: { "X-Server-Function-Instance": "server-function:test" }
    });
    const dataPlain = await unscripted("/_server/data/addr-shape-0");
    expect(dataTagged.headers.has("X-Server-Function-Format")).toBe(true);
    expect(dataPlain.headers.has("X-Server-Function-Format")).toBe(true);

    // bare address: the raw Response verbatim
    const bare = await unscripted("/_server/addr-shape-0");
    expect(bare.headers.has("X-Server-Function-Format")).toBe(false);
    expect(bare.headers.get("Content-Type")).toBe("application/rss+xml");
    expect(await bare.text()).toBe("<rss/>");
  });

  it("reserves `args` on the query: anything but an argument array is a 400", async () => {
    serverGET(
      createServerSideReference(
        registerServerReference("addr-broken-0", async (value: unknown) => typeof value)
      )
    );
    for (const query of ["args=hello", "args=5", "args=%22ab%22", "args=%7B%7D"]) {
      const response = await unscripted(`/_server/addr-broken-0?${query}`);
      expect([query, response.status]).toEqual([query, 400]);
    }
    const scripted = await unscripted("/_server/addr-broken-0?args=hello", {
      headers: { "X-Server-Function-Instance": "server-function:test" }
    });
    expect(scripted.status).toBe(400);
  });

  it("ignores the id header and the query parameter that used to address a call", async () => {
    registerServerFunction("addr-header-a", async () => "a");
    registerServerFunction("addr-header-b", async () => "b");
    const swapped = await unscripted("/_server/addr-header-b", {
      method: "POST",
      headers: { "X-Server-Function-Id": "addr-header-a" }
    });
    expect(await swapped.text()).toBe("b");
    expect((await unscripted("/_server?id=addr-header-a", { method: "POST" })).status).toBe(404);
  });

  it("keeps a url under the limit on the cacheable transport", async () => {
    serverGET(
      createServerSideReference(
        registerServerReference("addr-long-2", async (text: string) => text.length)
      )
    );
    const seen: Request[] = [];
    const restore = connectTransport(seen);
    try {
      const measure = GET(createServerReference("addr-long-2"));
      expect(await measure("x".repeat(1900))).toBe(1900);
      expect(await measure("x".repeat(2100))).toBe(2100);
    } finally {
      restore();
    }
    expect(seen.map(request => request.method)).toEqual(["GET", "POST"]);
  });

  it("answers 404 when the request is not under the configured mount", async () => {
    registerServerFunction("addr-mount-1", async () => "ok");
    expect((await unscripted("/app/_server/addr-mount-1", { method: "POST" })).status).toBe(404);
  });

  it("answers 404 for a path the address gives no meaning to", async () => {
    registerServerFunction("addr-extra-0", async () => "ok");
    expect((await unscripted("/_server", { method: "POST" })).status).toBe(404);
    expect((await unscripted("/_server/", { method: "POST" })).status).toBe(404);
    expect((await unscripted("/_server/addr-extra-0/extra", { method: "POST" })).status).toBe(404);
    expect((await unscripted("/_server/data/", { method: "POST" })).status).toBe(404);
    expect((await unscripted("/_server/data/addr-extra-0/extra", { method: "POST" })).status).toBe(
      404
    );
  });

  it("a function id spelled `data` still parses at the bare address", async () => {
    // the literal `data` segment cannot shadow an id: an id occupies exactly
    // one segment, so segment count decides which address this is
    registerServerFunction("data", async () => "the id named data");
    const bare = await unscripted("/_server/data", { method: "POST" });
    expect(await bare.text()).toBe("the id named data");
    const scripted = await unscripted("/_server/data/data", {
      method: "POST",
      headers: { "X-Server-Function-Instance": "server-function:test" }
    });
    expect(scripted.status).toBe(200);
  });

  it("refuses to render bound arguments JSON cannot carry", () => {
    expect(() => serverFunctionUrl("addr-bound-1", [new Date()])).toThrow(/JSON-safe/);
  });

  it("does not fold an encoded path or control character onto the plain id", async () => {
    // The segment is percent-DECODED before the registry is asked, so what
    // arrives is a different string than the id it was built from and the
    // lookup misses. The failure mode this rules out is the opposite one:
    // a runtime that normalized, trimmed or stripped the decoded segment
    // would let a caller reach `addr-encoded` by an address that no edge
    // rule, cache key or log line agrees is `addr-encoded` — per-function
    // policy keyed on the path stops applying to a call that dispatches.
    const fn = vi.fn(async () => "reached");
    registerServerFunction("addr-encoded", fn);

    for (const path of [
      "/_server/%2e%2e%2faddr-encoded", // `../addr-encoded`
      "/_server/data/%2e%2e%2faddr-encoded",
      "/_server/addr-encoded%00", // a trailing NUL
      "/_server/addr-encoded%20", // trailing space
      "/_server/addr-encoded%0a", // trailing newline
      "/_server/%20addr-encoded" // leading space
    ]) {
      const response = await unscripted(path, { method: "POST" });
      expect([path, response.status]).toEqual([path, 404]);
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("reads the `data` segment and the mount literally", async () => {
    // `data` is a path segment, not a keyword: matched case-sensitively
    // like every other segment, so `DATA` is simply a two-segment path the
    // addresses give no meaning to. The mount is compared at a segment
    // boundary for the same reason — a sibling route whose path merely
    // STARTS with the mount is somebody else's route, and answering on it
    // would put a dispatch behind an address the app never advertised.
    const fn = vi.fn(async () => "reached");
    registerServerFunction("addr-literal", fn);

    for (const path of [
      "/_server/DATA/addr-literal",
      "/_server/Data/addr-literal",
      "/_serverfoo/data/addr-literal",
      "/_serverfoo/addr-literal"
    ]) {
      const response = await unscripted(path, { method: "POST" });
      expect([path, response.status]).toEqual([path, 404]);
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("answers an unknown id before buffering the request body", async () => {
    // An id is a compiler-minted string; a 200 KB one is somebody probing.
    // It has to cost nothing to say no: the id is resolved from the path
    // before the body is buffered or decoded, so the refusal is a registry
    // miss and the payload behind it is never paid for. Moving the bounds
    // check ahead of the lookup — a plausible-looking tidy-up — would make
    // every junk address cost a full body read first.
    registerServerFunction("addr-oversized", async () => "ok");
    // a chunked upload, so the body is only paid for if something reads it
    let pulls = 0;
    const body = new ReadableStream({
      pull(controller) {
        pulls++;
        controller.enqueue(new TextEncoder().encode("[]"));
        if (pulls >= 64) controller.close();
      }
    });
    const response = await handleServerFunctionRequest(
      new Request(`http://localhost/_server/${"z".repeat(200_000)}`, {
        method: "POST",
        body,
        // @ts-expect-error a streaming request body needs the node duplex flag
        duplex: "half",
        headers: { "Sec-Fetch-Site": "same-origin" }
      })
    );

    expect(response.status).toBe(404);
    // one pull is the stream filling its own queue on construction; more
    // than that is the runtime reading a payload it has already decided
    // to refuse
    expect(pulls).toBeLessThanOrEqual(1);
  });
});
