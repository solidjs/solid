/**
 * HTTP-layer hygiene of `handleServerFunctionRequest` (#3069, #3071):
 *
 * - The method allowlist: POST always dispatches; GET and HEAD dispatch only
 *   to `GET`-declared functions (HEAD used to bypass the gate entirely and
 *   execute any registered function); every other verb answers 405.
 * - HEAD responses carry the equivalent GET's status and headers, minus the
 *   body.
 * - GET/HEAD requests to declared functions skip the CSRF gate, so their
 *   responses carry no `Vary: Sec-Fetch-Site, Origin, Referer` and shared
 *   caches can store them. POST dispatch stays gated.
 * - Every response defaults to `Cache-Control: no-store` unless the function
 *   set its own cache policy — caching is opt-in on the wire.
 * - The endpoint has no CORS surface at all: no `Access-Control-*` header is
 *   ever emitted, so a browser preflight fails and the gate is never the
 *   only thing standing between a cross-origin page and a dispatch.
 * - Conditional requests and `Range` are not part of the contract: a
 *   declared read answers in full, never with a 304 or a 206 it cannot back.
 *
 * Runs against the built bundles like the other server-function specs.
 */
import { describe, expect, it, vi } from "vitest";
import {
  GET as serverGET,
  createServerReference,
  handleServerFunctionRequest,
  registerServerFunction,
  registerServerReference
} from "@solidjs/web/server-functions/server";

const provideEvent = <T,>(_event: unknown, run: () => T): T => run();

function readRequest(id: string, method: string, headers: Record<string, string> = {}) {
  return new Request(`https://app.example/_server/${id}`, { method, headers });
}

function postRequest(id: string, headers: Record<string, string> = {}) {
  return new Request(`https://app.example/_server/${id}`, {
    method: "POST",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      ...headers,
      "X-Server-Function-Instance": "server-function:test"
    }
  });
}

function declareGET(id: string, fn: (...args: any[]) => any) {
  serverGET(createServerReference(registerServerReference(id, fn)));
}

describe("server-function method allowlist (#3069)", () => {
  it("gates HEAD exactly like GET: 405 for undeclared functions, nothing executes", async () => {
    const fn = vi.fn(async () => "side effect happened");
    registerServerFunction("hygiene-post-only", fn);

    for (const method of ["HEAD", "GET"]) {
      const response = await handleServerFunctionRequest(
        readRequest("hygiene-post-only", method, { "Sec-Fetch-Site": "same-origin" }),
        { provideEvent }
      );
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST");
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("rejects other verbs too — the gate is an allowlist, not a GET special case", async () => {
    const fn = vi.fn(async () => "ok");
    registerServerFunction("hygiene-verbs", fn);

    for (const method of ["PUT", "DELETE", "PATCH"]) {
      const response = await handleServerFunctionRequest(
        new Request("https://app.example/_server/hygiene-verbs", {
          method,
          headers: { "Sec-Fetch-Site": "same-origin" }
        }),
        { provideEvent }
      );
      expect(response.status).toBe(405);
    }
    expect(fn).not.toHaveBeenCalled();

    // and on a GET-declared function the Allow header advertises the reads
    declareGET("hygiene-declared-verbs", async () => "ok");
    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/hygiene-declared-verbs", {
        method: "PUT",
        headers: { "Sec-Fetch-Site": "same-origin" }
      }),
      { provideEvent }
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST, GET, HEAD");
  });

  it("HEAD on a declared function runs it and returns the GET response minus the body", async () => {
    let calls = 0;
    declareGET("hygiene-head-ok", async (n: number = 1) => {
      calls++;
      return { doubled: n * 2 };
    });

    const get = await handleServerFunctionRequest(readRequest("hygiene-head-ok", "GET"), {
      provideEvent
    });
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ doubled: 2 });

    const head = await handleServerFunctionRequest(readRequest("hygiene-head-ok", "HEAD"), {
      provideEvent
    });
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect(head.headers.get("Content-Type")).toBe(get.headers.get("Content-Type"));
    expect(calls).toBe(2);
  });

  it("a GET declaration dies with the binding it was made about (#3129)", async () => {
    // The declaration grants two things — GET dispatch and the origin-gate
    // exemption (#3114) — and both were granted to a FUNCTION. Rebinding
    // the id (a collision between integrations, a module re-evaluated in a
    // live process after an edit dropped the wrapper) must revoke them:
    // otherwise the function now answering to the id inherits a grant it
    // never signed, and a mutation becomes reachable over GET, from any
    // origin, with the user's ambient cookies.
    const read = vi.fn(async () => "READ");
    declareGET("hygiene-rebind", read);
    const before = await handleServerFunctionRequest(readRequest("hygiene-rebind", "GET"), {
      provideEvent
    });
    expect(before.status).toBe(200);
    expect(read).toHaveBeenCalledTimes(1);

    // the id changes hands
    const mutation = vi.fn(async () => "MUTATED");
    registerServerFunction("hygiene-rebind", mutation);

    // both grants are gone, in gate order: a bare GET — the exact request
    // the stale grant used to answer — now meets the re-armed origin gate
    // (403), and a same-origin GET gets past it only to find the method
    // allowlist no longer advertising the reads (405)
    const bare = await handleServerFunctionRequest(readRequest("hygiene-rebind", "GET"), {
      provideEvent
    });
    expect(bare.status).toBe(403);
    const sameOrigin = await handleServerFunctionRequest(
      readRequest("hygiene-rebind", "GET", { "Sec-Fetch-Site": "same-origin" }),
      { provideEvent }
    );
    expect(sameOrigin.status).toBe(405);
    expect(sameOrigin.headers.get("Allow")).toBe("POST");
    expect(mutation).not.toHaveBeenCalled();

    // the default transport is untouched: the new function dispatches
    // over gated POST like any undeclared function
    const post = await handleServerFunctionRequest(postRequest("hygiene-rebind"), {
      provideEvent
    });
    expect(post.status).toBe(200);
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it("re-registering the same function keeps its declaration; a redeclaring rebind re-grants", async () => {
    // Same identity, same grant: registering the callback the declaration
    // was made about is not a change of hands (integrations re-running
    // their registration path must not silently lose GET).
    const read = async () => "READ";
    declareGET("hygiene-rebind-same", read);
    registerServerFunction("hygiene-rebind-same", read);
    const kept = await handleServerFunctionRequest(readRequest("hygiene-rebind-same", "GET"), {
      provideEvent
    });
    expect(kept.status).toBe(200);

    // The re-evaluated-module path: registration and declaration travel
    // together in module order, so a function that still wraps GET()
    // re-grants itself immediately after the rebind revokes.
    declareGET("hygiene-rebind-redeclare", async () => "v1");
    declareGET("hygiene-rebind-redeclare", async () => "v2");
    const redeclared = await handleServerFunctionRequest(
      readRequest("hygiene-rebind-redeclare", "GET"),
      { provideEvent }
    );
    expect(redeclared.status).toBe(200);
    expect(await redeclared.text()).toContain("v2");
  });

  it("matches the method exactly: a lowercased `post` is not POST", async () => {
    // The comparison is `===` against the uppercase token, and the platform
    // `Request` constructor normalizes the six well-known methods, so this
    // can only arrive from an adapter that builds the request itself — h3,
    // express, a serverless shim reading `req.method` off a socket. Those
    // are exactly the deployments where a case-folding "fix" would be
    // proposed, and case-folding here would let `head`/`options` through
    // the allowlist by a spelling the allowlist never named.
    const fn = vi.fn(async () => "side effect happened");
    registerServerFunction("hygiene-method-case", fn);

    const request = postRequest("hygiene-method-case");
    Object.defineProperty(request, "method", { value: "post", configurable: true });

    const response = await handleServerFunctionRequest(request, { provideEvent });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(fn).not.toHaveBeenCalled();
  });

  it("advertises Allow on OPTIONS and on a verb it has never heard of", async () => {
    // OPTIONS gets no special handling — there is no CORS surface for it to
    // describe (below) and no `Allow`-only branch — so it lands on the same
    // 405 as any other verb, carrying the same advertisement. A method the
    // runtime has never seen behaves identically: the allowlist is closed,
    // and `Allow` is the complete answer to "then what may I send?".
    registerServerFunction("hygiene-allow-post", async () => "ok");
    declareGET("hygiene-allow-read", async () => "read");

    for (const method of ["OPTIONS", "FROB"]) {
      const postOnly = await handleServerFunctionRequest(
        readRequest("hygiene-allow-post", method, { "Sec-Fetch-Site": "same-origin" }),
        { provideEvent }
      );
      expect([method, postOnly.status, postOnly.headers.get("Allow")]).toEqual([
        method,
        405,
        "POST"
      ]);

      const declared = await handleServerFunctionRequest(
        readRequest("hygiene-allow-read", method, { "Sec-Fetch-Site": "same-origin" }),
        { provideEvent }
      );
      expect([method, declared.status, declared.headers.get("Allow")]).toEqual([
        method,
        405,
        "POST, GET, HEAD"
      ]);
    }
  });

  it("honours no method-override header or query parameter", async () => {
    // Every one of these is a convention some framework or proxy honours,
    // and honouring any of them would reintroduce the hole #3069 closed:
    // a GET — issued by a link checker, a prefetcher, an <img> on someone
    // else's page — carrying a header or a query parameter that turns it
    // into a dispatch of an undeclared function.
    const fn = vi.fn(async () => "side effect happened");
    registerServerFunction("hygiene-override", fn);

    for (const header of ["X-HTTP-Method-Override", "X-Method-Override", "X-HTTP-Method"]) {
      const response = await handleServerFunctionRequest(
        readRequest("hygiene-override", "GET", {
          "Sec-Fetch-Site": "same-origin",
          [header]: "POST"
        }),
        { provideEvent }
      );
      expect([header, response.status]).toEqual([header, 405]);
    }

    const query = await handleServerFunctionRequest(
      new Request("https://app.example/_server/hygiene-override?_method=POST", {
        headers: { "Sec-Fetch-Site": "same-origin" }
      }),
      { provideEvent }
    );
    expect(query.status).toBe(405);
    expect(fn).not.toHaveBeenCalled();
  });
});

/**
 * The endpoint has no CORS surface (#3069). Nothing here emits an
 * `Access-Control-*` header, on any status, so a cross-origin `fetch` from
 * a page never gets past the browser: the preflight has no
 * `Access-Control-Allow-Origin` to read, and a simple request's response is
 * unreadable. That is the layer BELOW the origin gate — the gate stops the
 * dispatch, the missing CORS headers stop the browser from ever asking —
 * and the reason a deployment must opt in at its own edge, deliberately,
 * rather than find that the RPC endpoint quietly answers everybody.
 */
describe("no CORS surface (#3069)", () => {
  it("emits no Access-Control-* header on any path", async () => {
    registerServerFunction("hygiene-cors", async () => "ok");
    registerServerFunction("hygiene-cors-throw", async () => {
      throw new Error("boom");
    });
    declareGET("hygiene-cors-read", async () => "read");

    const responses = await Promise.all([
      handleServerFunctionRequest(postRequest("hygiene-cors"), { provideEvent }),
      handleServerFunctionRequest(postRequest("hygiene-cors-throw"), { provideEvent }),
      handleServerFunctionRequest(postRequest("hygiene-cors-missing"), { provideEvent }),
      handleServerFunctionRequest(readRequest("hygiene-cors-read", "GET"), { provideEvent }),
      handleServerFunctionRequest(readRequest("hygiene-cors-read", "HEAD"), { provideEvent }),
      handleServerFunctionRequest(
        readRequest("hygiene-cors", "GET", { "Sec-Fetch-Site": "same-origin" }),
        { provideEvent }
      ),
      handleServerFunctionRequest(postRequest("hygiene-cors", { "Sec-Fetch-Site": "cross-site" }), {
        provideEvent
      })
    ]);

    // 200, 500, 404, 200, 200, 405, 403 — the whole span of answers
    expect(responses.map(response => response.status)).toEqual([200, 500, 404, 200, 200, 405, 403]);
    for (const response of responses) {
      const names = [...response.headers.keys()].filter(name =>
        name.toLowerCase().startsWith("access-control")
      );
      expect(names).toEqual([]);
    }
  });

  it("fails a browser preflight closed", async () => {
    const fn = vi.fn(async () => "ok");
    registerServerFunction("hygiene-preflight", fn);
    declareGET("hygiene-preflight-read", async () => "read");

    // What Chrome sends ahead of a cross-origin `fetch` with a JSON body
    for (const id of ["hygiene-preflight", "hygiene-preflight-read"]) {
      const response = await handleServerFunctionRequest(
        new Request(`https://app.example/_server/${id}`, {
          method: "OPTIONS",
          headers: {
            Origin: "https://evil.example",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "cross-site",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type"
          }
        }),
        { provideEvent }
      );
      // The gate answers first — a preflight is not a read, so even a
      // declared function is gated on OPTIONS — and either way the browser
      // finds no allow-origin to honour.
      expect([id, response.status]).toEqual([id, 403]);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("server-function cache hygiene (#3071)", () => {
  it("declared reads skip the CSRF gate: no origin proof required, no Vary emitted", async () => {
    declareGET("hygiene-read-ungated", async () => ({ who: "public menu" }));

    // no Sec-Fetch-Site / Origin / Referer at all — a CDN edge or curl
    const bare = await handleServerFunctionRequest(readRequest("hygiene-read-ungated", "GET"), {
      provideEvent
    });
    expect(bare.status).toBe(200);
    expect(bare.headers.get("Vary")).toBeNull();

    // even explicitly cross-site: SOP already blocks cross-origin reads
    const crossSite = await handleServerFunctionRequest(
      readRequest("hygiene-read-ungated", "GET", { "Sec-Fetch-Site": "cross-site" }),
      { provideEvent }
    );
    expect(crossSite.status).toBe(200);
  });

  it("POST dispatch stays gated and keeps its Vary", async () => {
    const fn = vi.fn(async () => "ok");
    registerServerFunction("hygiene-post-gated", fn);

    const rejected = await handleServerFunctionRequest(
      postRequest("hygiene-post-gated", { "Sec-Fetch-Site": "cross-site" }),
      { provideEvent }
    );
    expect(rejected.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();

    const accepted = await handleServerFunctionRequest(postRequest("hygiene-post-gated"), {
      provideEvent
    });
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("Vary")).toBe("Sec-Fetch-Site, Origin, Referer");
  });

  it("defaults every response to Cache-Control: no-store", async () => {
    registerServerFunction("hygiene-no-store", async () => ({ private: true }));
    declareGET("hygiene-no-store-get", async () => ({ public: true }));

    const post = await handleServerFunctionRequest(postRequest("hygiene-no-store"), {
      provideEvent
    });
    expect(post.status).toBe(200);
    expect(post.headers.get("Cache-Control")).toBe("no-store");

    // opt-in stays opt-in even for declared reads
    const get = await handleServerFunctionRequest(readRequest("hygiene-no-store-get", "GET"), {
      provideEvent
    });
    expect(get.headers.get("Cache-Control")).toBe("no-store");

    const missing = await handleServerFunctionRequest(
      readRequest("hygiene-nonexistent", "GET", { "Sec-Fetch-Site": "same-origin" }),
      { provideEvent }
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBe("no-store");

    const undeclared = await handleServerFunctionRequest(
      readRequest("hygiene-no-store", "GET", { "Sec-Fetch-Site": "same-origin" }),
      { provideEvent }
    );
    expect(undeclared.status).toBe(405);
    expect(undeclared.headers.get("Cache-Control")).toBe("no-store");
  });

  it("preserves a cache policy the function set itself", async () => {
    declareGET(
      "hygiene-opt-in",
      async () => new Response(null, { headers: { "Cache-Control": "public, max-age=60" } })
    );

    // the scripted transport's own address (#3094)
    const scripted = await handleServerFunctionRequest(
      new Request("https://app.example/_server/data/hygiene-opt-in", { method: "GET" }),
      { provideEvent }
    );
    expect(scripted.status).toBe(200);
    expect(scripted.headers.get("Cache-Control")).toBe("public, max-age=60");

    // the plain-HTTP address serves the response verbatim, policy included
    const plain = await handleServerFunctionRequest(
      new Request("https://app.example/_server/hygiene-opt-in", { method: "GET" }),
      { provideEvent }
    );
    expect(plain.status).toBe(200);
    expect(plain.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("keeps the instance header inert at the bare address (#3094)", async () => {
    declareGET(
      "hygiene-inert-header",
      async () => new Response(null, { headers: { "Cache-Control": "public, max-age=60" } })
    );

    // The bare address is plain HTTP no matter what headers ride along: the
    // shape and the cache policy are functions of the url alone, so the
    // author's policy survives and no codec shape can be summoned into a
    // shared cache by a header the cache does not key on.
    const tagged = await handleServerFunctionRequest(
      new Request("https://app.example/_server/hygiene-inert-header", {
        method: "GET",
        headers: { "X-Server-Function-Instance": "server-function:test" }
      }),
      { provideEvent }
    );
    expect(tagged.status).toBe(200);
    expect(tagged.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(tagged.headers.has("X-Server-Function-Format")).toBe(false);
  });

  it("keeps no-store on the refusals built before dispatch, not only the ones above", async () => {
    // 404 and 405 are covered above; these are the refusals assembled on
    // other branches, each a plain `new Response(...)` that a later edit
    // could easily add without the default. A cached 403 or 413 is the
    // worse failure of the two directions: a CDN that stored one serves
    // the refusal to the user who WOULD have been allowed, and the app
    // looks broken to exactly the people it works for.
    registerServerFunction("hygiene-refusals", async () => {
      throw new Error("boom");
    });

    const refusals: [number, Response][] = [
      // arguments that are not the encoding the url claims
      [
        400,
        await handleServerFunctionRequest(postRequest("hygiene-refusals?args=hello"), {
          provideEvent
        })
      ],
      // the origin gate
      [
        403,
        await handleServerFunctionRequest(
          postRequest("hygiene-refusals", { "Sec-Fetch-Site": "cross-site" }),
          { provideEvent }
        )
      ],
      // arguments past the configured bound
      [
        413,
        await handleServerFunctionRequest(postRequest(`hygiene-refusals?args=${"x".repeat(200)}`), {
          bodySizeLimit: 10,
          provideEvent
        })
      ],
      // the function itself threw
      [500, await handleServerFunctionRequest(postRequest("hygiene-refusals"), { provideEvent })]
    ];

    for (const [expected, response] of refusals) {
      expect([expected, response.status]).toEqual([expected, expected]);
      expect([expected, response.headers.get("Cache-Control")]).toEqual([expected, "no-store"]);
    }
  });

  it("merges the gate's Vary onto the author's rather than replacing it", async () => {
    // The gate's `Vary` has to be added to a gated response, and the
    // function may have set one of its own for reasons the runtime knows
    // nothing about (content negotiation, a per-locale answer). Replacing
    // it would silently collapse those variants onto one cache entry.
    registerServerFunction(
      "hygiene-vary-merge",
      async () => new Response("v", { headers: { Vary: "Accept-Language" } })
    );

    const response = await handleServerFunctionRequest(postRequest("hygiene-vary-merge"), {
      provideEvent
    });
    expect(response.headers.get("Vary")).toBe("Accept-Language, Sec-Fetch-Site, Origin, Referer");
  });

  it("does not list a field the author already named, whatever its case", async () => {
    // Field names are case-insensitive, so `origin` and `Origin` are one
    // field. Appending the second spelling would grow the header on every
    // hop through a proxy that re-adds its own, and some caches treat a
    // repeated name as a distinct key.
    registerServerFunction(
      "hygiene-vary-dedupe",
      async () => new Response("v", { headers: { Vary: "origin, accept-language" } })
    );

    const response = await handleServerFunctionRequest(postRequest("hygiene-vary-dedupe"), {
      provideEvent
    });
    // the author's spelling survives; only the fields it lacks are appended
    expect(response.headers.get("Vary")).toBe("origin, accept-language, Sec-Fetch-Site, Referer");
  });

  it("leaves `Vary: *` alone", async () => {
    // `*` already means "never reuse this for another request" — strictly
    // stronger than naming three fields. Appending to it would produce
    // `*, Sec-Fetch-Site, ...`, which is not a weaker rule but a
    // malformed one, and caches disagree about what to do with it.
    registerServerFunction(
      "hygiene-vary-star",
      async () => new Response("v", { headers: { Vary: "*" } })
    );

    const response = await handleServerFunctionRequest(postRequest("hygiene-vary-star"), {
      provideEvent
    });
    expect(response.headers.get("Vary")).toBe("*");
  });
});

/**
 * HEAD over a result that is still being produced (#3069). HEAD runs the
 * function — that is what makes its headers those of the equivalent GET —
 * so a streaming result leaves a live source behind with nobody to read
 * it. Dropping the body means CANCELLING that source, not draining it: an
 * unbounded or slow stream drained to completion is a request that never
 * finishes and memory that nobody accounted for, on a verb that link
 * checkers, uptime probes and prefetchers send unprompted.
 */
describe("HEAD over a streamed result (#3069)", () => {
  it("answers the GET's headers with no body, and cancels the source", async () => {
    let pulls = 0;
    let cancelled = false;
    const streamed = () =>
      new Response(
        new ReadableStream({
          // never closes: a drained body would hang this test rather than
          // fail it, which is the honest shape of the bug
          pull(controller) {
            pulls++;
            controller.enqueue(new TextEncoder().encode("chunk"));
          },
          cancel() {
            cancelled = true;
          }
        }),
        { headers: { "Content-Type": "text/plain", "X-Marker": "kept" } }
      );
    declareGET("hygiene-head-stream", streamed);

    const get = await handleServerFunctionRequest(readRequest("hygiene-head-stream", "GET", {}), {
      provideEvent
    });
    const getHeaders = [...get.headers].sort();
    await get.body!.cancel();

    pulls = 0;
    cancelled = false;
    const head = await handleServerFunctionRequest(readRequest("hygiene-head-stream", "HEAD", {}), {
      provideEvent
    });

    expect([...head.headers].sort()).toEqual(getHeaders);
    expect(head.body).toBeNull();
    // give a drain a chance to run away with it before asserting
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(cancelled).toBe(true);
    // the stream fills its queue once on construction; anything beyond
    // that is the runtime pumping a body it is about to throw away
    expect(pulls).toBeLessThanOrEqual(1);
  });
});

/**
 * A declared read answers the whole result or nothing (#3071). It is a
 * function call rendered as a GET, not a stored representation: there is
 * no validator to compare against and no stable byte range to serve a
 * slice of, since the answer is recomputed per call. So the conditional
 * and range headers a cache, a proxy or a media element may attach are
 * ignored, and the response advertises no range support to invite them.
 * The alternative — answering 304 without an `ETag` anyone issued, or 206
 * over bytes that will differ next call — is a wrong answer delivered with
 * confidence, and the caller has no way to tell.
 */
describe("conditional requests and Range on a declared read", () => {
  it("answers in full, never a 304 or a 206", async () => {
    declareGET("hygiene-conditional", async () => ({ hello: "world" }));
    const body = JSON.stringify({ hello: "world" });

    const conditionals: Record<string, string>[] = [
      { "If-None-Match": '"anything"' },
      { "If-Modified-Since": new Date().toUTCString() },
      { "If-Match": '"anything"' },
      { Range: "bytes=0-3" }
    ];
    for (const headers of conditionals) {
      const response = await handleServerFunctionRequest(
        readRequest("hygiene-conditional", "GET", headers),
        { provideEvent }
      );
      const label = Object.keys(headers)[0];
      expect([label, response.status]).toEqual([label, 200]);
      expect([label, await response.text()]).toEqual([label, body]);
      expect([label, response.headers.get("Accept-Ranges")]).toEqual([label, null]);
      expect([label, response.headers.get("Content-Range")]).toEqual([label, null]);
    }
  });
});
