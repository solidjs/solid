import { describe, expect, it, vi } from "vitest";
import {
  createServerReference,
  GET,
  handleServerFunctionRequest,
  registerServerFunction,
  registerServerReference
} from "@solidjs/web/server-functions/server";
import type { ServerFunctionCSRFOptions } from "@solidjs/web/server-functions/server";

const provideEvent = <T,>(_event: unknown, run: () => T): T => run();

function request(id: string, headers: Record<string, string> = {}) {
  return new Request(`https://app.example/_server/${id}`, {
    method: "POST",
    headers: {
      ...headers,
      "X-Server-Function-Instance": "server-function:test"
    }
  });
}

describe("server-function CSRF bridge", () => {
  it("rejects cross-site calls before dispatch", async () => {
    const fn = vi.fn(async () => "ok");
    registerServerFunction("csrf-bridge-cross-site", fn);

    const rejected = await handleServerFunctionRequest(
      request("csrf-bridge-cross-site", { "Sec-Fetch-Site": "cross-site" }),
      { provideEvent }
    );
    expect(rejected.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();

    const accepted = await handleServerFunctionRequest(
      request("csrf-bridge-cross-site", { "Sec-Fetch-Site": "same-origin" }),
      { provideEvent }
    );
    expect(accepted.status).toBe(200);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("exposes trusted-origin configuration", async () => {
    registerServerFunction("csrf-bridge-origin", async () => "ok");
    const csrf: ServerFunctionCSRFOptions = { origin: "https://trusted.example" };

    const response = await handleServerFunctionRequest(
      request("csrf-bridge-origin", { Origin: "https://trusted.example" }),
      { csrf, provideEvent }
    );
    expect(response.status).toBe(200);
  });
});

/**
 * The gate's branches, pinned. Each one is a decision someone could
 * plausibly "fix" in the wrong direction, and today only two of them fail
 * a test if reversed:
 *
 * - `Sec-Fetch-Site` is authoritative WHEN PRESENT. A `same-site` call
 *   (a sibling subdomain) and a `none` call (address bar, bookmark) are
 *   refused outright — they never fall through to the trusted-origin
 *   matcher, so widening `origin` cannot re-admit them. Loosening
 *   `same-site` is the natural-looking repair for a broken subdomain
 *   deployment, and it would hand every subdomain a CSRF surface.
 * - Without `Sec-Fetch-Site`, `Origin` decides, then `Referer`; a matcher
 *   that answered `true` for a non-matching origin would fail open, and
 *   nothing currently notices.
 * - With no proof of origin at all, the request is refused unless the
 *   deployment has explicitly opted out.
 */
describe("the origin gate's decision matrix", () => {
  for (const site of ["same-site", "none"]) {
    it(`refuses a ${site} call even when the Origin is trusted`, async () => {
      const fn = vi.fn(async () => "ok");
      registerServerFunction(`csrf-site-${site}`, fn);

      const response = await handleServerFunctionRequest(
        request(`csrf-site-${site}`, {
          "Sec-Fetch-Site": site,
          Origin: "https://app.example"
        }),
        { csrf: { origin: "https://app.example" }, provideEvent }
      );

      expect(response.status).toBe(403);
      expect(fn).not.toHaveBeenCalled();
    });
  }

  it("refuses an Origin the deployment does not trust", async () => {
    const fn = vi.fn(async () => "ok");
    registerServerFunction("csrf-origin-mismatch", fn);

    const response = await handleServerFunctionRequest(
      request("csrf-origin-mismatch", { Origin: "https://evil.example" }),
      { csrf: { origin: "https://trusted.example" }, provideEvent }
    );

    expect(response.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
  });

  it("defaults to the request's own origin when none is configured", async () => {
    registerServerFunction("csrf-origin-default", async () => "ok");

    const same = await handleServerFunctionRequest(
      request("csrf-origin-default", { Origin: "https://app.example" }),
      { provideEvent }
    );
    expect(same.status).toBe(200);

    const other = await handleServerFunctionRequest(
      request("csrf-origin-default", { Origin: "https://evil.example" }),
      { provideEvent }
    );
    expect(other.status).toBe(403);
  });

  it("falls back to Referer when Origin is absent", async () => {
    registerServerFunction("csrf-referer", async () => "ok");

    const allowed = await handleServerFunctionRequest(
      request("csrf-referer", { Referer: "https://app.example/some/page" }),
      { provideEvent }
    );
    expect(allowed.status).toBe(200);

    const refused = await handleServerFunctionRequest(
      request("csrf-referer", { Referer: "https://evil.example/some/page" }),
      { provideEvent }
    );
    expect(refused.status).toBe(403);
  });

  it("refuses a Referer it cannot parse rather than ignoring it", async () => {
    const fn = vi.fn(async () => "ok");
    registerServerFunction("csrf-referer-garbage", fn);

    const response = await handleServerFunctionRequest(
      request("csrf-referer-garbage", { Referer: "not a url" }),
      { provideEvent }
    );

    expect(response.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
  });

  it("refuses a request carrying no proof of origin, unless opted out", async () => {
    registerServerFunction("csrf-no-proof", async () => "ok");

    const refused = await handleServerFunctionRequest(request("csrf-no-proof"), { provideEvent });
    expect(refused.status).toBe(403);

    const allowed = await handleServerFunctionRequest(request("csrf-no-proof"), {
      csrf: { allowRequestsWithoutOriginCheck: true },
      provideEvent
    });
    expect(allowed.status).toBe(200);
  });

  it("asks a function matcher, and honours its refusal", async () => {
    registerServerFunction("csrf-origin-fn", async () => "ok");
    const seen: string[] = [];
    const csrf: ServerFunctionCSRFOptions = {
      origin: async origin => {
        seen.push(origin);
        return origin === "https://trusted.example";
      }
    };

    const allowed = await handleServerFunctionRequest(
      request("csrf-origin-fn", { Origin: "https://trusted.example" }),
      { csrf, provideEvent }
    );
    expect(allowed.status).toBe(200);

    const refused = await handleServerFunctionRequest(
      request("csrf-origin-fn", { Origin: "https://evil.example" }),
      { csrf, provideEvent }
    );
    expect(refused.status).toBe(403);
    expect(seen).toEqual(["https://trusted.example", "https://evil.example"]);
  });

  it("treats a list as the whole allowlist", async () => {
    registerServerFunction("csrf-origin-list", async () => "ok");
    const csrf: ServerFunctionCSRFOptions = {
      origin: ["https://one.example", "https://two.example"]
    };

    for (const origin of ["https://one.example", "https://two.example"]) {
      const allowed = await handleServerFunctionRequest(
        request("csrf-origin-list", { Origin: origin }),
        { csrf, provideEvent }
      );
      expect(allowed.status).toBe(200);
    }

    const refused = await handleServerFunctionRequest(
      request("csrf-origin-list", { Origin: "https://three.example" }),
      { csrf, provideEvent }
    );
    expect(refused.status).toBe(403);
  });
});

/**
 * GET-declared reads and the gate (#3114). The default skip is deliberate —
 * same-origin policy already keeps a cross-site caller from READING the
 * response, and the gate's `Vary` fragments the shared-cache entries the
 * GET helper exists to enable (#3071) — resting on `GET()`'s documented
 * safety contract: a declared read is safe to EXECUTE from any origin.
 * Both halves are pinned here: the skip (so nobody "fixes" it into cache
 * poisoning) and the `protectDeclaredReads` opt-in for deployments that
 * would rather gate reads than share cache entries.
 */
describe("GET-declared reads and the origin gate", () => {
  function declareRead(id: string, fn: (...args: any[]) => any) {
    GET(createServerReference(registerServerReference(id, fn)));
  }

  function read(id: string, headers: Record<string, string> = {}) {
    return new Request(`https://app.example/_server/${id}`, { headers });
  }

  it("executes a declared read cross-site by default — the documented contract", async () => {
    const fn = vi.fn(async () => "read");
    declareRead("csrf-declared-read", fn);

    const response = await handleServerFunctionRequest(
      read("csrf-declared-read", { "Sec-Fetch-Site": "cross-site" }),
      { provideEvent }
    );
    expect(response.status).toBe(200);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("gates a declared read when protectDeclaredReads is set", async () => {
    const fn = vi.fn(async () => "read");
    declareRead("csrf-protected-read", fn);
    const csrf: ServerFunctionCSRFOptions = { protectDeclaredReads: true };

    const refused = await handleServerFunctionRequest(
      read("csrf-protected-read", { "Sec-Fetch-Site": "cross-site" }),
      { csrf, provideEvent }
    );
    expect(refused.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();

    const allowed = await handleServerFunctionRequest(
      read("csrf-protected-read", { "Sec-Fetch-Site": "same-origin" }),
      { csrf, provideEvent }
    );
    expect(allowed.status).toBe(200);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("keeps POST dispatch to the same function gated either way", async () => {
    const fn = vi.fn(async () => "read");
    declareRead("csrf-read-post", fn);

    const refused = await handleServerFunctionRequest(
      request("csrf-read-post", { "Sec-Fetch-Site": "cross-site" }),
      { provideEvent }
    );
    expect(refused.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
  });
});
