/**
 * What the transport does with a response the runtime did not write (#3087,
 * revisited by #3173).
 *
 * Its own responses are recognisable: they carry the error header, or the
 * body format every encoding path stamps — a void result included — or the
 * verbatim-passthrough marker. Anything else at 400 and up is the peer
 * refusing, and decoding one yields nothing, which used to resolve the call
 * to `undefined`. #3173 extended the same discrimination to success
 * statuses: a 2xx without the tag (a captive portal, a WAF interstitial, a
 * misrouted SPA index — all 200 text/html) fails the call instead of
 * resolving as a phantom void result. These pin the refusals that fail, the
 * value-shaped statuses that must not, and how the two meanings of
 * `undefined` are told apart.
 *
 * Like the extension specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { redirect, respond } from "@solidjs/web";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
import {
  configureServerFunctionsClient,
  createServerReference
} from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

/**
 * The transport's fetch. `answer` replaces the handler with a response from
 * somewhere else; `rewrite` sends the call to a different address.
 */
function connectTransport({
  answer,
  rewrite,
  method,
  site = "same-origin"
}: {
  answer?: () => Response;
  rewrite?: (address: string) => string;
  method?: string;
  site?: string;
} = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (answer) return Promise.resolve(answer());
    const address = input instanceof Request ? input.url : input.toString();
    const request = new Request(new URL(rewrite ? rewrite(address) : address, "http://localhost"), {
      ...(input instanceof Request ? input : init),
      ...(method ? { method, body: undefined } : {})
    });
    request.headers.set("Sec-Fetch-Site", site);
    return handleServerFunctionRequest(request);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const foreign = (status: number, body: BodyInit | null, type?: string) => () =>
  new Response(body, { status, headers: type ? { "content-type": type } : undefined });

describe("server-function transport failures (#3087)", () => {
  it("fails the call when the handler refuses it", async () => {
    const restore = connectTransport();
    try {
      // a client that outlived the build registering its function
      await expect(createServerReference("fail-never-registered")()).rejects.toMatchObject({
        status: 404
      });
    } finally {
      restore();
    }
  });

  it("fails the call when the handler rejects the request itself", async () => {
    registerServerFunction("fail-args", async () => "ok");
    // something under `args` that is not an argument array: a 400 for every
    // caller of that url
    const restore = connectTransport({ rewrite: address => `${address}?args=nope` });
    try {
      await expect(createServerReference("fail-args")()).rejects.toMatchObject({ status: 400 });
    } finally {
      restore();
    }
  });

  it("fails the call on a response nothing in the runtime wrote", async () => {
    registerServerFunction("fail-foreign", async () => "ok");
    for (const answer of [
      foreign(404, "<h1>Not found</h1>", "text/html"),
      foreign(401, "<html>login</html>", "text/html"),
      foreign(403, null)
    ]) {
      const restore = connectTransport({ answer });
      try {
        await expect(createServerReference("fail-foreign")()).rejects.toMatchObject({
          status: answer().status
        });
      } finally {
        restore();
      }
    }
  });

  it("fails one carrying integration metadata of its own", async () => {
    registerServerFunction("fail-interstitial", async () => "ok");
    // an SSO interstitial answers 403 with a Location, and a gateway can
    // answer 404 with anything — neither is the runtime's control flow, so
    // neither may take the passthrough that control flow uses
    for (const [status, headers] of [
      [403, { "content-type": "text/html", Location: "https://sso.example/login" }],
      [404, { "X-Revalidate": "stories" }]
    ] as const) {
      const restore = connectTransport({ answer: () => new Response(null, { status, headers }) });
      try {
        await expect(createServerReference("fail-interstitial")()).rejects.toMatchObject({
          status
        });
      } finally {
        restore();
      }
    }
  });

  it("fails with an Error even when the foreign body sniffs as a known encoding", async () => {
    registerServerFunction("fail-sniffed", async () => "ok");
    // content-type sniffing would decode this as URLSearchParams; a refusal's
    // body is not a payload, and a caller reads `.status`, not a form
    const restore = connectTransport({
      answer: foreign(403, "reason=blocked", "application/x-www-form-urlencoded")
    });
    try {
      await expect(createServerReference("fail-sniffed")()).rejects.toMatchObject({ status: 403 });
      await expect(createServerReference("fail-sniffed")()).rejects.toBeInstanceOf(Error);
    } finally {
      restore();
    }
  });

  it("resolves a value-shaped status the function itself produced", async () => {
    registerServerFunction("fail-validated", async () =>
      respond({ field: "required" }, { status: 400 })
    );
    registerServerFunction("fail-void", async () => respond(undefined, { status: 400 }));
    registerServerFunction("fail-empty", async () => new Response(null, { status: 404 }));
    const restore = connectTransport();
    try {
      expect(await createServerReference("fail-validated")()).toEqual({ field: "required" });
      // nothing, with a status on it — both spellings answer the same way
      expect(await createServerReference("fail-void")()).toBeUndefined();
      expect(await createServerReference("fail-empty")()).toBeNull();
    } finally {
      restore();
    }
  });

  it("leaves the runtime's own control flow on its passthrough", async () => {
    registerServerFunction("fail-redirect", async () => {
      throw redirect("/login");
    });
    const restore = connectTransport();
    try {
      const response = await createServerReference("fail-redirect")();
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).headers.get("X-Server-Function-Redirect")).toBe(
        "302 http://localhost/login"
      );
    } finally {
      restore();
    }
  });

  it("leaves a redirect the peer answered with to the passthrough", async () => {
    registerServerFunction("fail-3xx", async () => "ok");
    // `fetch` follows redirects, so an interstitial arrives as its page at
    // 200 and a 3xx only reaches the transport where something opted out of
    // following one — control flow the runtime does not produce and the
    // caller may still want to read
    const restore = connectTransport({
      answer: () => new Response(null, { status: 302, headers: { Location: "/login" } })
    });
    try {
      const response = await createServerReference("fail-3xx")();
      expect((response as Response).status).toBe(302);
    } finally {
      restore();
    }
  });

  it("fails a 2xx the runtime did not write (#3173)", async () => {
    registerServerFunction("fail-spa", async () => "ok");
    // This reverses #3087's original ruling, which resolved these as
    // `undefined` ("cannot judge a 2xx, and does not try"). The reachable
    // cases are not hostile servers but ordinary infrastructure answering
    // in the origin's place — a captive portal, a WAF interstitial, a CDN
    // error page, a misrouted SPA index, all 200 with HTML — and resolving
    // them as a void result meant error boundaries never fired and a
    // mutation looked committed. The header alone is judge (#3087's rule
    // against content-type heuristics stands): every response the runtime
    // writes carries the body-format tag, void results included, and a
    // verbatim passthrough carries X-Content-Raw. Anything else at a
    // success status is not ours, whatever its body says.
    for (const answer of [
      foreign(200, "<html>Sign in to the WiFi</html>", "text/html"),
      foreign(200, null),
      foreign(204, null)
    ]) {
      const restore = connectTransport({ answer });
      try {
        await expect(createServerReference("fail-spa")()).rejects.toMatchObject({
          status: answer().status
        });
        await expect(createServerReference("fail-spa")()).rejects.toBeInstanceOf(Error);
      } finally {
        restore();
      }
    }
  });

  it("still resolves a genuine void result — the tag is what tells them apart (#3173)", async () => {
    // the control that separates the two meanings of `undefined`: a
    // function that returns nothing answers with the Void body-format tag,
    // so the guard above never fires for it
    registerServerFunction("fail-void-genuine", async () => {});
    const restore = connectTransport();
    try {
      expect(await createServerReference("fail-void-genuine")()).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("fails on the gates that answer without a body", async () => {
    registerServerFunction("fail-gated", async () => "ok");
    // the method allowlist and the origin gate answer 405 and 403 with
    // nothing in the body, which is the shape that used to decode to
    // `undefined`
    const method = connectTransport({ method: "GET" });
    try {
      await expect(createServerReference("fail-gated")()).rejects.toMatchObject({ status: 405 });
    } finally {
      method();
    }
    const origin = connectTransport({ site: "cross-site" });
    try {
      await expect(createServerReference("fail-gated")()).rejects.toMatchObject({ status: 403 });
    } finally {
      origin();
    }
  });

  it("reads a void result the way a peer without the tag wrote it", async () => {
    registerServerFunction("fail-untagged", async () => "ok");
    // a server built before `BodyFormat.Void`: a void result with a status
    // and no format header is indistinguishable from a refusal, and fails
    const restore = connectTransport({ answer: () => new Response(null, { status: 400 }) });
    try {
      await expect(createServerReference("fail-untagged")()).rejects.toMatchObject({ status: 400 });
    } finally {
      restore();
    }
  });

  it("fails a verbatim passthrough that carries a refusal's status", async () => {
    registerServerFunction(
      "fail-raw",
      async () => new Response("nope", { status: 404, headers: { "X-Content-Raw": "1" } })
    );
    registerServerFunction(
      "fail-raw-ok",
      async () => new Response("here", { status: 200, headers: { "X-Content-Raw": "1" } })
    );
    const restore = connectTransport();
    try {
      // a raw body is for whoever claims the response; a call site with no
      // integration could not read it at either status, and a status beats
      // minting `undefined`
      await expect(createServerReference("fail-raw")()).rejects.toMatchObject({ status: 404 });
      expect(await createServerReference("fail-raw-ok")()).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("leaves the response to an integration that claims it", async () => {
    registerServerFunction(
      "fail-claimed",
      async () => new Response("frame", { status: 404, headers: { "X-Content-Raw": "1" } })
    );
    const restore = connectTransport();
    configureServerFunctionsClient({
      responseHandler: { handle: (response: Response) => response.status }
    });
    try {
      // the seam runs before the check, which is what keeps server
      // components free to answer with a status of their own
      expect(await createServerReference("fail-claimed")()).toBe(404);
    } finally {
      configureServerFunctionsClient({ responseHandler: null as any });
      restore();
    }
  });

  it("leaves an ordinary call alone", async () => {
    registerServerFunction("fail-plain", async (word: string) => word.toUpperCase());
    const restore = connectTransport();
    try {
      expect(await createServerReference("fail-plain")("solid")).toBe("SOLID");
    } finally {
      restore();
    }
  });
});
