/**
 * Cross-origin callers and the origin gate (#3538).
 *
 * `csrf.origin` reads as "these origins may call server functions", but
 * the gate used to refuse `Sec-Fetch-Site: cross-site` before the matcher
 * was consulted — so an explicitly listed origin was refused by every
 * current browser, and the matcher only ever ran for clients sending no
 * fetch metadata. Now a `cross-site`/`same-site` request that carries an
 * `Origin` is decided BY the matcher, and an admitted cross-origin caller
 * gets the CORS answer the browser needs to read the response:
 *
 * - `Access-Control-Allow-Origin` echoes the exact `Origin`, with
 *   `Vary: Origin`.
 * - `Access-Control-Allow-Credentials: true` ONLY when the deployment set
 *   `csrf.allowCredentials` — listing an origin must not silently turn on
 *   cookie sharing.
 * - `Access-Control-Expose-Headers` names the protocol's response headers
 *   so the client transport can read its own tags.
 * - The `OPTIONS` preflight is answered for the transport's methods and
 *   headers.
 *
 * Everything else is pinned unchanged: no matcher means no cross-origin
 * caller is admitted (today's default), `none` stays refused, a listed
 * origin's failure still fails closed, and the same-origin path is
 * byte-identical to before — no `Access-Control-*` header anywhere.
 *
 * Runs against the built bundles like the other server-function specs.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createServerReference,
  ERROR_HEADER,
  GET as serverGET,
  handleServerFunctionRequest,
  registerServerFunction,
  registerServerReference,
  UNKNOWN_HEADER
} from "@solidjs/web/server-functions/server";
import type { ServerFunctionCSRFOptions } from "@solidjs/web/server-functions/server";

const provideEvent = <T,>(_event: unknown, run: () => T): T => run();

const APP = "https://app.example.test";
const OTHER = "https://other.example.test";
const API = "https://api.example.test";

function post(id: string, headers: Record<string, string> = {}, data = true) {
  return new Request(`${API}/_server/${data ? "data/" : ""}${id}`, {
    method: "POST",
    headers
  });
}

function crossSite(id: string, origin = APP, extra: Record<string, string> = {}) {
  return post(id, {
    Origin: origin,
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Mode": "cors",
    ...extra
  });
}

function preflight(id: string, origin = APP, extra: Record<string, string> = {}) {
  // What Chrome sends ahead of a cross-origin `fetch` with the transport's
  // JSON body and protocol tag.
  return new Request(`${API}/_server/data/${id}`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-Mode": "cors",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,x-server-function-format",
      ...extra
    }
  });
}

function corsHeaders(response: Response) {
  return Object.fromEntries(
    [...response.headers.entries()].filter(([name]) => name.startsWith("access-control-"))
  );
}

function varyNames(response: Response) {
  return (response.headers.get("Vary") || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

function declareGET(id: string, fn: (...args: any[]) => any) {
  serverGET(createServerReference(registerServerReference(id, fn)));
}

describe("a listed cross-origin caller (#3538)", () => {
  it("admits a cross-site call whose Origin the allowlist names, with the CORS answer", async () => {
    const fn = vi.fn(async () => "ok");
    registerServerFunction("cors-listed", fn);
    const csrf: ServerFunctionCSRFOptions = { origin: [APP, OTHER] };

    const response = await handleServerFunctionRequest(crossSite("cors-listed"), {
      csrf,
      provideEvent
    });

    expect(response.status).toBe(200);
    expect(fn).toHaveBeenCalledOnce();
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(varyNames(response)).toContain("origin");
    // an allowlist entry is not a cookie-sharing decision
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("echoes the exact Origin, never a wildcard, and each listed origin gets its own", async () => {
    registerServerFunction("cors-echo", async () => "ok");
    const csrf: ServerFunctionCSRFOptions = { origin: [APP, OTHER] };

    for (const origin of [APP, OTHER]) {
      const response = await handleServerFunctionRequest(crossSite("cors-echo", origin), {
        csrf,
        provideEvent
      });
      expect([origin, response.status]).toEqual([origin, 200]);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    }
  });

  it("admits a same-site sibling the allowlist names — a subdomain is cross-origin to CORS", async () => {
    const fn = vi.fn(async () => "ok");
    registerServerFunction("cors-same-site", fn);
    const sibling = "https://app.example.test";

    const response = await handleServerFunctionRequest(
      post("cors-same-site", { Origin: sibling, "Sec-Fetch-Site": "same-site" }),
      { csrf: { origin: sibling }, provideEvent }
    );

    expect(response.status).toBe(200);
    expect(fn).toHaveBeenCalledOnce();
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(sibling);
  });

  it("asks a function matcher, and hands it the browser's Origin", async () => {
    registerServerFunction("cors-matcher", async () => "ok");
    const seen: Array<[string, string]> = [];
    const csrf: ServerFunctionCSRFOptions = {
      origin: async (origin, request) => {
        seen.push([origin, request.headers.get("Sec-Fetch-Site")!]);
        return origin === APP;
      }
    };

    const admitted = await handleServerFunctionRequest(crossSite("cors-matcher"), {
      csrf,
      provideEvent
    });
    expect(admitted.status).toBe(200);
    expect(admitted.headers.get("Access-Control-Allow-Origin")).toBe(APP);

    const refused = await handleServerFunctionRequest(crossSite("cors-matcher", OTHER), {
      csrf,
      provideEvent
    });
    expect(refused.status).toBe(403);
    expect(corsHeaders(refused)).toEqual({});

    expect(seen).toEqual([
      [APP, "cross-site"],
      [OTHER, "cross-site"]
    ]);
  });

  it("fails closed on a matcher that answers anything but `true` (#3169)", async () => {
    const fn = vi.fn(async () => "ok");
    registerServerFunction("cors-matcher-truthy", fn);

    for (const verdict of ["yes", 1, {}, [], Promise.resolve("yes")] as unknown[]) {
      const response = await handleServerFunctionRequest(crossSite("cors-matcher-truthy"), {
        csrf: { origin: (() => verdict) as any },
        provideEvent
      });
      expect(response.status).toBe(403);
      expect(corsHeaders(response)).toEqual({});
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("exposes the protocol's response headers so the client can read its own tags", async () => {
    registerServerFunction("cors-expose-throw", async () => {
      throw new Error("boom");
    });
    const csrf: ServerFunctionCSRFOptions = { origin: APP };

    const response = await handleServerFunctionRequest(crossSite("cors-expose-throw"), {
      csrf,
      provideEvent
    });
    expect(response.status).toBe(500);
    expect(response.headers.has(ERROR_HEADER)).toBe(true);
    const exposed = (response.headers.get("Access-Control-Expose-Headers") || "")
      .split(",")
      .map(name => name.trim().toLowerCase());
    expect(exposed).toContain(ERROR_HEADER.toLowerCase());
    expect(exposed).toContain("x-server-function-format");
    // the CORS answer does not list itself, and cookies cannot be exposed
    expect(exposed.some(name => name.startsWith("access-control-"))).toBe(false);
    expect(exposed).not.toContain("set-cookie");
  });

  it("labels the unknown-id 404 readably for a listed origin — skew recovery is client-side", async () => {
    // #3136 answers the labelled 404 BEFORE the gate so a client can tell
    // version skew from a CDN 404. A cross-origin client can only read the
    // label through CORS, so the label rides the CORS answer too.
    const response = await handleServerFunctionRequest(crossSite("cors-unknown-function"), {
      csrf: { origin: APP },
      provideEvent
    });
    expect(response.status).toBe(404);
    expect(response.headers.get(UNKNOWN_HEADER)).toBe("true");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(response.headers.get("Access-Control-Expose-Headers")!.toLowerCase()).toContain(
      UNKNOWN_HEADER.toLowerCase()
    );
  });

  it("admits a metadata-less browser whose Origin the allowlist names, with CORS", async () => {
    // Older WebKit sends `Origin` without `Sec-Fetch-Site`. The matcher
    // already decided this road; the Origin differs from the request's own,
    // so the caller is cross-origin and the response has to be readable.
    registerServerFunction("cors-no-metadata", async () => "ok");

    const response = await handleServerFunctionRequest(post("cors-no-metadata", { Origin: APP }), {
      csrf: { origin: APP },
      provideEvent
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APP);
  });
});

describe("what stays refused (#3538)", () => {
  it("refuses a cross-site call whose Origin is not listed, without a CORS answer", async () => {
    const fn = vi.fn(async () => "ok");
    registerServerFunction("cors-unlisted", fn);

    const response = await handleServerFunctionRequest(crossSite("cors-unlisted", OTHER), {
      csrf: { origin: APP },
      provideEvent
    });

    expect(response.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
    expect(corsHeaders(response)).toEqual({});
  });

  it("refuses every cross-site call when no matcher is configured — today's default", async () => {
    const fn = vi.fn(async () => "ok");
    registerServerFunction("cors-default", fn);

    for (const csrf of [undefined, true, {}] as const) {
      // even an Origin equal to the request's own: the browser said
      // cross-site, and the default matcher is not an allowlist
      for (const origin of [APP, API]) {
        const response = await handleServerFunctionRequest(crossSite("cors-default", origin), {
          csrf: csrf as any,
          provideEvent
        });
        expect([origin, response.status]).toEqual([origin, 403]);
        expect(corsHeaders(response)).toEqual({});
      }
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("refuses a cross-site call that carries no Origin, listed matcher or not", async () => {
    const fn = vi.fn(async () => "ok");
    registerServerFunction("cors-no-origin", fn);

    const response = await handleServerFunctionRequest(
      post("cors-no-origin", { "Sec-Fetch-Site": "cross-site" }),
      { csrf: { origin: () => true }, provideEvent }
    );
    expect(response.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
  });

  it("refuses `Sec-Fetch-Site: none` even when the Origin is listed", async () => {
    const fn = vi.fn(async () => "ok");
    registerServerFunction("cors-none", fn);

    const response = await handleServerFunctionRequest(
      post("cors-none", { Origin: APP, "Sec-Fetch-Site": "none" }),
      { csrf: { origin: APP }, provideEvent }
    );
    expect(response.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
    expect(corsHeaders(response)).toEqual({});
  });

  it("refuses `Origin: null` cross-site — an opaque origin is not one an allowlist names", async () => {
    const fn = vi.fn(async () => "ok");
    registerServerFunction("cors-opaque", fn);

    const response = await handleServerFunctionRequest(crossSite("cors-opaque", "null"), {
      csrf: { origin: APP },
      provideEvent
    });
    expect(response.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("the same-origin path is untouched (#3538)", () => {
  it("emits no Access-Control-* header on a same-origin call, matcher configured or not", async () => {
    registerServerFunction("cors-same-origin", async () => "ok");
    registerServerFunction("cors-same-origin-throw", async () => {
      throw new Error("boom");
    });

    for (const csrf of [undefined, { origin: [APP, OTHER] }] as const) {
      const responses = await Promise.all([
        handleServerFunctionRequest(post("cors-same-origin", { "Sec-Fetch-Site": "same-origin" }), {
          csrf: csrf as any,
          provideEvent
        }),
        handleServerFunctionRequest(
          post("cors-same-origin-throw", { "Sec-Fetch-Site": "same-origin" }),
          { csrf: csrf as any, provideEvent }
        ),
        handleServerFunctionRequest(
          post("cors-same-origin-missing", { "Sec-Fetch-Site": "same-origin" }),
          { csrf: csrf as any, provideEvent }
        ),
        // `Origin` equal to the request's own, with no fetch metadata: the
        // matcher admits it, but nothing about it is cross-origin
        handleServerFunctionRequest(post("cors-same-origin", { Origin: API }), {
          csrf: csrf === undefined ? undefined : { origin: [API, APP] },
          provideEvent
        })
      ]);
      expect(responses.map(response => response.status)).toEqual([200, 500, 404, 200]);
      for (const response of responses) expect(corsHeaders(response)).toEqual({});
    }
  });

  it("answers a same-origin call byte-identically whether or not an allowlist exists", async () => {
    registerServerFunction("cors-identical", async () => ({ ok: true }));

    const [plain, listed] = await Promise.all([
      handleServerFunctionRequest(post("cors-identical", { "Sec-Fetch-Site": "same-origin" }), {
        provideEvent
      }),
      handleServerFunctionRequest(post("cors-identical", { "Sec-Fetch-Site": "same-origin" }), {
        csrf: { origin: [APP], allowCredentials: true },
        provideEvent
      })
    ]);
    expect(listed.status).toBe(plain.status);
    expect([...listed.headers.entries()]).toEqual([...plain.headers.entries()]);
    expect(await listed.text()).toBe(await plain.text());
  });

  it("keeps a plain OPTIONS — no preflight headers — on the 405 it always got", async () => {
    registerServerFunction("cors-plain-options", async () => "ok");

    const response = await handleServerFunctionRequest(
      new Request(`${API}/_server/cors-plain-options`, {
        method: "OPTIONS",
        headers: { "Sec-Fetch-Site": "same-origin" }
      }),
      { csrf: { origin: APP }, provideEvent }
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(corsHeaders(response)).toEqual({});
  });
});

describe("the preflight (#3538)", () => {
  it("answers a listed origin's preflight for the transport's methods and headers", async () => {
    const fn = vi.fn(async () => "ok");
    registerServerFunction("cors-preflight", fn);

    const response = await handleServerFunctionRequest(preflight("cors-preflight"), {
      csrf: { origin: APP },
      provideEvent
    });

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, GET, HEAD");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "content-type,x-server-function-format"
    );
    expect(Number(response.headers.get("Access-Control-Max-Age"))).toBeGreaterThan(0);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    // the answer depends on what was asked
    const vary = varyNames(response);
    expect(vary).toContain("origin");
    expect(vary).toContain("access-control-request-method");
    expect(vary).toContain("access-control-request-headers");
    // a preflight is not a cacheable resource
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("lets the transport's own headers through when the preflight names none", async () => {
    registerServerFunction("cors-preflight-bare", async () => "ok");
    const request = new Request(`${API}/_server/data/cors-preflight-bare`, {
      method: "OPTIONS",
      headers: {
        Origin: APP,
        "Sec-Fetch-Site": "cross-site",
        "Access-Control-Request-Method": "POST"
      }
    });

    const response = await handleServerFunctionRequest(request, {
      csrf: { origin: APP },
      provideEvent
    });
    expect(response.status).toBe(204);
    const allowed = (response.headers.get("Access-Control-Allow-Headers") || "")
      .split(",")
      .map(name => name.trim().toLowerCase());
    expect(allowed).toContain("content-type");
    expect(allowed).toContain("x-server-function-format");
    expect(allowed).toContain("x-single-flight");
  });

  it("answers the preflight ahead of the id lookup — the actual request carries the verdict", async () => {
    // A preflight asks whether the ORIGIN may send this method here; the
    // answer does not depend on the id, and refusing it would hide the
    // labelled unknown-id 404 (and every other status) from the client.
    const response = await handleServerFunctionRequest(preflight("cors-preflight-unknown"), {
      csrf: { origin: APP },
      provideEvent
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APP);
  });

  it("fails an unlisted origin's preflight closed, exactly as before", async () => {
    registerServerFunction("cors-preflight-unlisted", async () => "ok");
    declareGET("cors-preflight-unlisted-read", async () => "read");

    for (const id of ["cors-preflight-unlisted", "cors-preflight-unlisted-read"]) {
      const listed = await handleServerFunctionRequest(preflight(id, OTHER), {
        csrf: { origin: APP },
        provideEvent
      });
      expect([id, listed.status]).toEqual([id, 403]);
      expect(corsHeaders(listed)).toEqual({});

      const unconfigured = await handleServerFunctionRequest(preflight(id), { provideEvent });
      expect([id, unconfigured.status]).toEqual([id, 403]);
      expect(corsHeaders(unconfigured)).toEqual({});
    }
  });
});

describe("credentials are a separate decision (#3538)", () => {
  it("sends Allow-Credentials only when the deployment configured it", async () => {
    registerServerFunction("cors-credentials", async () => "ok");

    const bare = await handleServerFunctionRequest(crossSite("cors-credentials"), {
      csrf: { origin: APP },
      provideEvent
    });
    expect(bare.status).toBe(200);
    expect(bare.headers.get("Access-Control-Allow-Credentials")).toBeNull();

    const off = await handleServerFunctionRequest(crossSite("cors-credentials"), {
      csrf: { origin: APP, allowCredentials: false },
      provideEvent
    });
    expect(off.headers.get("Access-Control-Allow-Credentials")).toBeNull();

    const on = await handleServerFunctionRequest(crossSite("cors-credentials"), {
      csrf: { origin: APP, allowCredentials: true },
      provideEvent
    });
    expect(on.status).toBe(200);
    expect(on.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(on.headers.get("Access-Control-Allow-Credentials")).toBe("true");

    const preflighted = await handleServerFunctionRequest(preflight("cors-credentials"), {
      csrf: { origin: APP, allowCredentials: true },
      provideEvent
    });
    expect(preflighted.status).toBe(204);
    expect(preflighted.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("never sends Allow-Credentials to an origin it refused", async () => {
    registerServerFunction("cors-credentials-refused", async () => "ok");

    const response = await handleServerFunctionRequest(
      crossSite("cors-credentials-refused", OTHER),
      { csrf: { origin: APP, allowCredentials: true }, provideEvent }
    );
    expect(response.status).toBe(403);
    expect(corsHeaders(response)).toEqual({});
  });
});

describe("declared reads from a listed origin (#3538)", () => {
  function declareRead(id: string) {
    const fn = vi.fn(async () => "read");
    declareGET(id, fn);
    const read = (headers: Record<string, string>) =>
      new Request(`${API}/_server/data/${id}`, { headers });
    return { fn, read };
  }

  it("carries Allow-Origin on an ungated read for a listed origin only", async () => {
    // The gate is skipped for declared reads (#3114); that never decided
    // whether the BROWSER lets the page read the answer. A listed origin's
    // read gets `Allow-Origin`; an unlisted or same-origin read gets no
    // CORS header, and is still answered — a read is never refused here.
    const { fn, read } = declareRead("cors-declared-read");

    const listed = await handleServerFunctionRequest(
      read({ Origin: APP, "Sec-Fetch-Site": "cross-site" }),
      { csrf: { origin: APP }, provideEvent }
    );
    expect(listed.status).toBe(200);
    expect(listed.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(varyNames(listed)).toEqual(["origin"]);

    const unlisted = await handleServerFunctionRequest(
      read({ Origin: OTHER, "Sec-Fetch-Site": "cross-site" }),
      { csrf: { origin: APP }, provideEvent }
    );
    expect(unlisted.status).toBe(200);
    expect(corsHeaders(unlisted)).toEqual({});

    const unconfigured = await handleServerFunctionRequest(
      read({ Origin: APP, "Sec-Fetch-Site": "cross-site" }),
      { provideEvent }
    );
    expect(unconfigured.status).toBe(200);
    expect(corsHeaders(unconfigured)).toEqual({});
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("varies every declared read by Origin once a matcher is configured — cache hygiene", async () => {
    // A declared read is cacheable, and a stored answer is served to
    // whoever asks next. Once an allowlist exists the answer DEPENDS on the
    // Origin (Allow-Origin for a listed one, nothing for anyone else), so
    // every read names that dependency — the same-origin read that carries
    // no Origin included. Varying only the admitted answer would let a
    // same-origin page warm a shared cache with the header-less variant
    // and have it served to the listed origin next: CORS failures that
    // depend on who asked first. `Allow-Origin` itself still appears for
    // an admitted cross-origin Origin only.
    const { read } = declareRead("cors-declared-read-vary");
    const csrf: ServerFunctionCSRFOptions = { origin: APP };

    const sameOrigin = await handleServerFunctionRequest(
      read({ "Sec-Fetch-Site": "same-origin" }),
      { csrf, provideEvent }
    );
    expect(sameOrigin.status).toBe(200);
    expect(varyNames(sameOrigin)).toEqual(["origin"]);
    expect(corsHeaders(sameOrigin)).toEqual({});

    // a bare read (a CDN revalidating, a curl) is a cache participant too
    const bare = await handleServerFunctionRequest(read({}), { csrf, provideEvent });
    expect(bare.status).toBe(200);
    expect(varyNames(bare)).toEqual(["origin"]);
    expect(corsHeaders(bare)).toEqual({});

    const unlisted = await handleServerFunctionRequest(
      read({ Origin: OTHER, "Sec-Fetch-Site": "cross-site" }),
      { csrf, provideEvent }
    );
    expect(varyNames(unlisted)).toEqual(["origin"]);
    expect(corsHeaders(unlisted)).toEqual({});

    // the read keeps its own Vary alongside
    const listed = await handleServerFunctionRequest(
      read({ Origin: APP, "Sec-Fetch-Site": "cross-site" }),
      { csrf, provideEvent }
    );
    expect(varyNames(listed)).toEqual(["origin"]);
    expect(listed.headers.get("Access-Control-Allow-Origin")).toBe(APP);
  });

  it("leaves declared reads byte-identical when no matcher is configured", async () => {
    // Without an allowlist no cross-origin caller can be admitted, so the
    // answer does not depend on Origin and there is nothing to vary on —
    // the shared-cache entries the GET helper exists for (#3071) stay
    // whole. `csrf: true` and `csrf: {}` are "no matcher" too.
    const { read } = declareRead("cors-declared-read-plain");

    for (const csrf of [undefined, true, {}, { allowCredentials: true }] as const) {
      for (const headers of [
        { "Sec-Fetch-Site": "same-origin" },
        {},
        { Origin: APP, "Sec-Fetch-Site": "cross-site" }
      ]) {
        const response = await handleServerFunctionRequest(read(headers), {
          csrf: csrf as any,
          provideEvent
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("Vary")).toBeNull();
        expect(corsHeaders(response)).toEqual({});
      }
    }
  });

  it("keeps a gated declared read on the gate's own Vary, allowlist or not", async () => {
    // `protectDeclaredReads` puts the read behind the gate, whose refusal
    // already varies on all three proofs — `Origin` among them — so the
    // read rule adds nothing new and the same-origin answer is unchanged.
    const { read } = declareRead("cors-declared-read-gated");

    const response = await handleServerFunctionRequest(read({ "Sec-Fetch-Site": "same-origin" }), {
      csrf: { origin: APP, protectDeclaredReads: true },
      provideEvent
    });
    expect(response.status).toBe(200);
    expect(varyNames(response)).toEqual(["sec-fetch-site", "origin", "referer"]);
    expect(corsHeaders(response)).toEqual({});
  });
});
