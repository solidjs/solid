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
 * How the gate READS the headers, as opposed to which one it consults.
 * `Origin` is compared as a string against the request url's origin, and
 * `Referer` contributes only its origin — so every case below is really
 * one question: what does a browser actually put in these headers, and
 * what happens to everything else that can arrive there? Every answer is
 * fail-closed, and each is a single `.toLowerCase()` or `.normalize()`
 * away from being fail-open, which is why they are written down.
 */
describe("the origin gate's reading of the headers", () => {
  function post(headers: Record<string, string>, host = "app.example") {
    return handleServerFunctionRequest(
      new Request(`https://${host}/_server/csrf-reading`, { method: "POST", headers }),
      { provideEvent }
    );
  }

  it("refuses `Origin: null` — an opaque origin proves nothing", async () => {
    // A sandboxed iframe, a `no-referrer` redirect chain and a few
    // privacy extensions all send the literal string `null`. It is not the
    // absence of an Origin (which the deployment may opt into accepting)
    // and it is not an origin that can match one: it is a caller declining
    // to say where it came from, on a request that carries cookies.
    // Run with the no-proof escape hatch OPEN: a request carrying nothing
    // would be accepted here, so the refusal below can only come from the
    // literal `null` itself. Without that, this passes on a gate that has
    // stopped reading Origin at all.
    const fn = vi.fn(async () => "ok");
    registerServerFunction("csrf-reading", fn);
    const lenient = { csrf: { allowRequestsWithoutOriginCheck: true }, provideEvent };

    const noProof = await handleServerFunctionRequest(
      new Request("https://app.example/_server/csrf-reading", { method: "POST" }),
      lenient
    );
    expect(noProof.status).toBe(200);

    const opaque = await handleServerFunctionRequest(
      new Request("https://app.example/_server/csrf-reading", {
        method: "POST",
        headers: { Origin: "null" }
      }),
      lenient
    );
    expect(opaque.status).toBe(403);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("compares the Origin byte for byte: scheme, host case and port all count", async () => {
    // Browsers serialize an origin one way (lowercase scheme and host, the
    // default port omitted), so anything else in this header did not come
    // from a browser's serializer. The tempting repair is to run the header
    // through the URL parser too, which would make every line below match:
    // that is a security gate deciding which spellings of a host are "the
    // same" — case folding, IDNA mapping, default-port equivalence — on
    // behalf of a caller that already had one correct way to say it.
    const fn = vi.fn(async () => "ok");
    registerServerFunction("csrf-reading", fn);

    for (const origin of [
      "http://app.example", // scheme
      "HTTPS://app.example", // scheme case
      "https://APP.example", // host case
      "https://app.example:443", // the default port, spelled out
      "https://app.example:8443" // a different port is a different origin
    ]) {
      const response = await post({ Origin: origin });
      expect([origin, response.status]).toEqual([origin, 403]);
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("matches a punycode Origin against a unicode host, and refuses a lookalike", async () => {
    // A browser sends the ASCII (punycode) form of an internationalized
    // host in `Origin`, while the request url may be written either way —
    // the URL parser applies IDNA to it, so the two meet in punycode. The
    // lookalike is `примep.example`, spelled with a Latin `p`: it renders
    // identically and encodes to a different label, which is exactly the
    // case a homograph attack turns on.
    registerServerFunction("csrf-reading", async () => "ok");

    const matching = await post({ Origin: "https://xn--e1afmkfd.example" }, "пример.example");
    expect(matching.status).toBe(200);

    const lookalike = await post({ Origin: "https://xn--ep-vlcqng.example" }, "пример.example");
    expect(lookalike.status).toBe(403);
  });

  it("refuses a Referer that parses but names no origin", async () => {
    // Distinct from the unparseable Referer above: these are well-formed
    // URLs whose origin serializes to the string `null`. Reading them as
    // "no Referer" would quietly promote them to the no-proof branch,
    // which a deployment may have opted into accepting.
    const fn = vi.fn(async () => "ok");
    registerServerFunction("csrf-reading", fn);

    for (const referer of ["data:text/html,<form>", "about:blank"]) {
      const response = await post({ Referer: referer });
      expect([referer, response.status]).toEqual([referer, 403]);
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("falls through to Origin when Sec-Fetch-Site carries a value it does not know", async () => {
    // The header's values are a closed set, matched case-sensitively as
    // the spec defines them. Anything else — a proxy rewriting the case, a
    // future value, a fabricated one — is not evidence, so the gate
    // carries on to `Origin` rather than treating an unrecognised value as
    // either proof or refusal.
    registerServerFunction("csrf-reading", async () => "ok");

    const trusted = await post({
      "Sec-Fetch-Site": "SAME-ORIGIN",
      Origin: "https://app.example"
    });
    expect(trusted.status).toBe(200);

    const untrusted = await post({
      "Sec-Fetch-Site": "SAME-ORIGIN",
      Origin: "https://evil.example"
    });
    expect(untrusted.status).toBe(403);

    // and on its own it proves nothing, so the no-proof branch decides
    expect((await post({ "Sec-Fetch-Site": "banana" })).status).toBe(403);
  });

  it("refuses a duplicated Sec-Fetch-Site or Origin", async () => {
    // A header sent twice arrives comma-joined (`Headers.get` on the
    // platform's own implementation), which matches neither the closed set
    // of fetch-site values nor any origin. Both fields are single-valued,
    // so a duplicate is a request that passed through something that
    // appends rather than replaces — a header-smuggling shape, and the one
    // place where "be liberal in what you accept" hands an attacker a
    // second bite at the value the gate reads.
    const fn = vi.fn(async () => "ok");
    registerServerFunction("csrf-reading", fn);

    const site = new Headers();
    site.append("Sec-Fetch-Site", "same-origin");
    site.append("Sec-Fetch-Site", "same-origin");
    expect(site.get("Sec-Fetch-Site")).toBe("same-origin, same-origin");

    const origin = new Headers();
    origin.append("Origin", "https://app.example");
    origin.append("Origin", "https://app.example");

    for (const headers of [site, origin]) {
      const response = await handleServerFunctionRequest(
        new Request("https://app.example/_server/csrf-reading", { method: "POST", headers }),
        { provideEvent }
      );
      expect(response.status).toBe(403);
    }
    expect(fn).not.toHaveBeenCalled();
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
