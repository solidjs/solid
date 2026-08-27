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
  return new Request(`https://app.example/_server?id=${id}`, { method, headers });
}

function postRequest(id: string, headers: Record<string, string> = {}) {
  return new Request("https://app.example/_server", {
    method: "POST",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      ...headers,
      "X-Server-Function-Id": id,
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
        new Request("https://app.example/_server?id=hygiene-verbs", {
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
      new Request("https://app.example/_server?id=hygiene-declared-verbs", {
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

    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server?id=hygiene-opt-in", {
        method: "GET",
        headers: { "X-Server-Function-Instance": "server-function:test" }
      }),
      { provideEvent }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
  });
});
