/**
 * Whether an author's 3xx survives must not depend on return vs throw, on
 * the caller being scripted, or on the value happening to be empty (#3096).
 *
 * The scripted mask exists because fetch FOLLOWS redirect statuses —
 * 301/302/303/307/308, Fetch §2.2.3 — before the transport can read them
 * (`redirect: "manual"` yields an opaque response with the Location
 * unreadable), so redirect intent travels as 200 + X-Server-Function-
 * Redirect, carrying the author's status and the target resolved against
 * the request url (#3102) — never as a Location on a 200, which has no
 * HTTP meaning and collided with authored Locations on statuses that
 * forward. Resolving server-side means relative and absolute spellings
 * arrive identical, so the reader never guesses navigation strategy from
 * string shape (#3107). The mask covers exactly the followable set and
 * exactly scripted callers: a 304 is never followed and forwards untouched
 * (the natural answer for a conditional read), and unscripted callers
 * always get real HTTP.
 *
 * Like the other server-function specs, these run against the built
 * bundles (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { redirect, respond } from "@solidjs/web";
import {
  ERROR_HEADER,
  REDIRECT_HEADER,
  handleServerFunctionRequest,
  registerServerFunction,
  setServerFunctionsDev
} from "@solidjs/web/server-functions/server";
import { createServerReference } from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
  // the flash codec is encrypted (#3239); the no-JS assertions need a key
  (globalThis as any).__SOLID_SECRET__ = "redirect-status-spec-key";
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
  delete (globalThis as any).__SOLID_SECRET__;
});

function scripted(id: string) {
  return new Request(`https://app.example/_server/data/${id}`, {
    method: "POST",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "X-Server-Function-Instance": "server-function:test"
    }
  });
}

// no instance header, not a form post: a direct HTTP caller (curl, a script)
function unscripted(id: string) {
  return new Request(`https://app.example/_server/${id}`, {
    method: "POST",
    headers: { "Sec-Fetch-Site": "same-origin" }
  });
}

// a browser form post without the client runtime: the no-JS convention
function formPost(id: string) {
  return new Request(`https://app.example/_server/${id}`, {
    method: "POST",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://app.example/current-page"
    },
    body: "a=1"
  });
}

/** Routes the client stub's fetch straight into the handler. */
function connectTransport() {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const address = input instanceof Request ? input.url : input.toString();
    const request = new Request(
      new URL(address, "http://localhost"),
      input instanceof Request ? input : init
    );
    request.headers.set("Sec-Fetch-Site", "same-origin");
    return handleServerFunctionRequest(request);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const location = { Location: "/elsewhere" };

describe("redirect statuses mask for scripted callers only (#3096)", () => {
  it("a returned redirect envelope: masked for scripted, real for unscripted", async () => {
    registerServerFunction("redirect-return-302", async () =>
      respond(undefined, { status: 302, headers: location })
    );

    const masked = await handleServerFunctionRequest(scripted("redirect-return-302"));
    expect(masked.status).toBe(200);
    expect(masked.headers.get(REDIRECT_HEADER)).toBe("302 https://app.example/elsewhere");
    expect(masked.headers.get("Location")).toBeNull();

    const real = await handleServerFunctionRequest(unscripted("redirect-return-302"));
    expect(real.status).toBe(302);
    expect(real.headers.get("Location")).toBe("/elsewhere");
  });

  it("return and throw agree", async () => {
    registerServerFunction("redirect-throw-302", async () => {
      throw respond(undefined, { status: 302, headers: location });
    });

    const masked = await handleServerFunctionRequest(scripted("redirect-throw-302"));
    expect(masked.status).toBe(200);
    expect(masked.headers.get(REDIRECT_HEADER)).toBe("302 https://app.example/elsewhere");
    expect(masked.headers.get("Location")).toBeNull();
    expect(masked.headers.has(ERROR_HEADER)).toBe(true);

    const real = await handleServerFunctionRequest(unscripted("redirect-throw-302"));
    expect(real.status).toBe(302);
  });

  it("the value's emptiness does not decide the outcome", async () => {
    registerServerFunction("redirect-return-loaded", async () =>
      respond({ a: 1 }, { status: 302, headers: location })
    );

    // unscripted: the real redirect, value riding as the JSON body
    const real = await handleServerFunctionRequest(unscripted("redirect-return-loaded"));
    expect(real.status).toBe(302);

    // scripted: masked, value still delivered
    const masked = await handleServerFunctionRequest(scripted("redirect-return-loaded"));
    expect(masked.status).toBe(200);
    expect(masked.headers.get(REDIRECT_HEADER)).toBe("302 https://app.example/elsewhere");
    expect(await masked.json()).toEqual({ a: 1 });
  });

  it("thrown redirect() still masks for scripted callers", async () => {
    registerServerFunction("redirect-throw-helper", async () => {
      throw redirect("/elsewhere");
    });

    const masked = await handleServerFunctionRequest(scripted("redirect-throw-helper"));
    expect(masked.status).toBe(200);
    expect(masked.headers.get(REDIRECT_HEADER)).toBe("302 https://app.example/elsewhere");

    const real = await handleServerFunctionRequest(unscripted("redirect-throw-helper"));
    expect(real.status).toBe(302);
  });

  it("relative and absolute spellings arrive identical (#3107)", async () => {
    registerServerFunction("redirect-spelled-relative", async () => {
      throw redirect("/elsewhere");
    });
    registerServerFunction("redirect-spelled-absolute", async () => {
      throw redirect("https://app.example/elsewhere");
    });

    const relative = await handleServerFunctionRequest(scripted("redirect-spelled-relative"));
    const absolute = await handleServerFunctionRequest(scripted("redirect-spelled-absolute"));
    expect(relative.headers.get(REDIRECT_HEADER)).toBe("302 https://app.example/elsewhere");
    expect(absolute.headers.get(REDIRECT_HEADER)).toBe(relative.headers.get(REDIRECT_HEADER));

    // a cross-origin target survives as itself — the reader compares
    // origins on a real url instead of sniffing the author's spelling
    registerServerFunction("redirect-cross-origin", async () => {
      throw redirect("https://other.example/next");
    });
    const cross = await handleServerFunctionRequest(scripted("redirect-cross-origin"));
    expect(cross.headers.get(REDIRECT_HEADER)).toBe("302 https://other.example/next");
  });

  it("an authored Location on a forwarding status stays data (#3102)", async () => {
    registerServerFunction("redirect-created-at", async () =>
      respond({ id: 7 }, { status: 201, headers: { Location: "/items/7" } })
    );

    // 201 is not in the followable set: the status forwards, the Location
    // is the author's created-at metadata, and no redirect carrier appears
    const created = await handleServerFunctionRequest(scripted("redirect-created-at"));
    expect(created.status).toBe(201);
    expect(created.headers.get("Location")).toBe("/items/7");
    expect(created.headers.get(REDIRECT_HEADER)).toBeNull();
  });
});

describe("non-redirect statuses forward for every caller and shape (#3096)", () => {
  it("304 is not a redirect: it forwards, returned or thrown", async () => {
    registerServerFunction("redirect-return-304", async () => respond(undefined, { status: 304 }));
    registerServerFunction("redirect-throw-304", async () => {
      throw respond(undefined, { status: 304 });
    });

    for (const [id, request] of [
      ["redirect-return-304", scripted],
      ["redirect-return-304", unscripted],
      ["redirect-throw-304", scripted],
      ["redirect-throw-304", unscripted]
    ] as const) {
      const response = await handleServerFunctionRequest(request(id));
      expect(response.status).toBe(304);
      expect(response.body).toBeNull();
    }
  });

  it("a scripted client resolves a returned 304 without failing the call", async () => {
    registerServerFunction("redirect-304-roundtrip", async () =>
      respond(undefined, { status: 304 })
    );

    const restore = connectTransport();
    try {
      await expect(createServerReference("redirect-304-roundtrip")()).resolves.toBeUndefined();
    } finally {
      restore();
    }
  });

  it("warns in dev when a scripted call answers 304 (#3101)", async () => {
    registerServerFunction("redirect-304-dev-warn", async () =>
      respond(undefined, { status: 304 })
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // the production bundle stays silent
      await handleServerFunctionRequest(scripted("redirect-304-dev-warn"));
      expect(warn).not.toHaveBeenCalled();

      // dev: the scripted transport sent no conditional headers, so a 304
      // resolves the call to undefined — worth telling the author about
      setServerFunctionsDev(true);
      await handleServerFunctionRequest(scripted("redirect-304-dev-warn"));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("304");
      expect(warn.mock.calls[0][0]).toContain("redirect-304-dev-warn");

      // unscripted callers get real HTTP — a 304 is meaningful there
      await handleServerFunctionRequest(unscripted("redirect-304-dev-warn"));
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      setServerFunctionsDev(false);
      warn.mockRestore();
    }
  });

  it("other statuses stay untouched", async () => {
    registerServerFunction("redirect-return-201", async () => respond({ a: 1 }, { status: 201 }));

    const masked = await handleServerFunctionRequest(scripted("redirect-return-201"));
    expect(masked.status).toBe(201);

    const real = await handleServerFunctionRequest(unscripted("redirect-return-201"));
    expect(real.status).toBe(201);
  });
});

describe("the no-JS form convention honors returned redirects (#3096)", () => {
  it("a returned redirect envelope navigates to its Location", async () => {
    registerServerFunction("redirect-nojs-return", async () =>
      respond(undefined, { status: 302, headers: location })
    );

    const response = await handleServerFunctionRequest(formPost("redirect-nojs-return"));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://app.example/elsewhere");
  });

  it("matching what a thrown redirect already did", async () => {
    registerServerFunction("redirect-nojs-throw", async () => {
      throw redirect("/elsewhere");
    });

    const response = await handleServerFunctionRequest(formPost("redirect-nojs-throw"));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://app.example/elsewhere");
  });
});

describe("oversized composed headers die at the helper, not at the socket (#3131)", () => {
  // Before the bound, a 20K-char redirect target or a 2000-key revalidate
  // list produced a response that undici and any proxied receiver refused
  // to PARSE (HPE_HEADER_OVERFLOW) — a network error pointing at nothing,
  // on a mutation that committed. The helpers now refuse while the
  // function body is still running, so what leaves dispatch is the
  // ordinary error shape: legible, attributable, and parseable.
  it("a thrown oversized redirect answers the error shape with bounded headers", async () => {
    registerServerFunction("bounds-redirect-big", async () => {
      throw redirect("/search?q=" + "x".repeat(20_000));
    });

    const response = await handleServerFunctionRequest(scripted("bounds-redirect-big"));
    expect(response.status).toBe(500);
    expect(response.headers.get("X-Server-Function-Redirect")).toBeNull();
    // the whole point: every header the response carries fits a receiver
    for (const [, value] of response.headers) {
      expect(value.length).toBeLessThanOrEqual(4096);
    }
  });

  it("an oversized revalidate list answers the error shape too", async () => {
    registerServerFunction("bounds-revalidate-big", async () =>
      respond(
        { ok: true },
        { revalidate: Array.from({ length: 2000 }, (_, i) => `orders:tenant-42:list:page-${i}`) }
      )
    );

    const response = await handleServerFunctionRequest(scripted("bounds-revalidate-big"));
    expect(response.status).toBe(500);
    expect(response.headers.get("X-Revalidate")).toBeNull();
    for (const [, value] of response.headers) {
      expect(value.length).toBeLessThanOrEqual(4096);
    }
  });

  it("ordinary redirects and revalidations are untouched", async () => {
    registerServerFunction("bounds-ordinary", async () =>
      respond(undefined, {
        status: 302,
        headers: location,
        revalidate: ["orders", "orders:list"]
      })
    );

    const response = await handleServerFunctionRequest(scripted("bounds-ordinary"));
    expect(response.status).toBe(200); // masked for the scripted caller
    expect(response.headers.get("X-Server-Function-Redirect")).toBe(
      "302 https://app.example/elsewhere"
    );
    expect(response.headers.get("X-Revalidate")).toBe("orders,orders:list");
  });
});

describe("the bare address reads the caller kind off Sec-Fetch-Mode (#3139)", () => {
  // The no-JS convention — 303, outcome in a flash cookie — exists for
  // form NAVIGATIONS. It used to engage on shape alone (form content type,
  // no format tag), which a page script's fetch(url, { body: new
  // URLSearchParams(...) }) also matches: the script got the 303, followed
  // it to the referrer's HTML, read `response.ok === true`, and its answer
  // sat in a cookie it would never look at. The browser's own word tells
  // the callers apart: navigations send `Sec-Fetch-Mode: navigate` (or
  // nothing, on older browsers), a script's fetch never does.
  function formShaped(id: string, mode?: string) {
    return new Request(`https://app.example/_server/${id}`, {
      method: "POST",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://app.example/current-page",
        ...(mode ? { "Sec-Fetch-Mode": mode } : {})
      },
      body: "a=1"
    });
  }

  it("keeps the convention for navigations, with or without fetch metadata", async () => {
    registerServerFunction("nojs-mode-nav", async () => ({ saved: true }));

    // a modern browser's form navigation declares itself
    const declared = await handleServerFunctionRequest(formShaped("nojs-mode-nav", "navigate"));
    expect(declared.status).toBe(303);
    expect(declared.headers.get("Set-Cookie")).toContain("flash=");

    // an older browser sends no fetch metadata at all: same convention
    const bare = await handleServerFunctionRequest(formShaped("nojs-mode-nav"));
    expect(bare.status).toBe(303);
  });

  it("refuses a page script's form-shaped post before the function runs", async () => {
    const fn = vi.fn(async () => ({ receipt: "SECRET" }));
    registerServerFunction("nojs-mode-script", fn);

    for (const mode of ["cors", "same-origin", "no-cors"]) {
      const response = await handleServerFunctionRequest(formShaped("nojs-mode-script", mode));
      // refused as malformed — not a 303 whose answer vanishes into the
      // caller's cookie jar, and not a 200 wearing the referrer's HTML
      expect([mode, response.status]).toEqual([mode, 400]);
      expect(response.headers.get("Set-Cookie")).toBeNull();
    }
    // before dispatch: the old shape's real harm was running the mutation
    // and then hiding the outcome
    expect(fn).not.toHaveBeenCalled();
  });

  it("a tagged script call at the bare address keeps the plain response", async () => {
    // the documented direct-HTTP spelling: the format tag takes the call
    // out of the form shape entirely, whatever its fetch mode says
    registerServerFunction("nojs-mode-tagged", async (params: URLSearchParams) => ({
      got: params.get("a")
    }));
    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/nojs-mode-tagged", {
        method: "POST",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Server-Function-Format": "3" // URLSearchParams
        },
        body: "a=1"
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ got: "1" });
  });
});

/**
 * The mask is justified by ONE fact — that fetch follows these statuses —
 * so it has to cover exactly the set fetch follows. Exercising 302 alone
 * cannot show that: narrowing the set to {302, 303}, or dropping 307/308,
 * leaves a scripted caller a real redirect that fetch chases before the
 * transport can read it, and the redirect is silently lost.
 */
describe("every status in the Fetch redirect set masks, and only for scripted callers (#3096)", () => {
  // 302 is covered above; these are the four the file never exercised.
  it.each([301, 303, 307, 308])(
    "%i travels as the redirect carrier for scripted callers, real for the rest",
    async status => {
      const id = `redirect-set-${status}`;
      registerServerFunction(id, async () => respond(undefined, { status, headers: location }));

      const masked = await handleServerFunctionRequest(scripted(id));
      expect(masked.status).toBe(200);
      expect(masked.headers.get(REDIRECT_HEADER)).toBe(`${status} https://app.example/elsewhere`);
      expect(masked.headers.get("Location")).toBeNull();

      const real = await handleServerFunctionRequest(unscripted(id));
      expect(real.status).toBe(status);
      expect(real.headers.get("Location")).toBe("/elsewhere");
    }
  );
});
