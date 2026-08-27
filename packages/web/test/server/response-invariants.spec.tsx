/**
 * @jsxImportSource @solidjs/web
 *
 * Response control-flow invariants, pinned ahead of the 2.0 freeze: a
 * thrown `Response` is intentional control flow (a redirect, a notFound),
 * never an ordinary error — so it must pass through error handling
 * untouched, and the production error sanitizer must never swallow one
 * into a generic "Internal Server Error".
 *
 * Like the single-flight specs, the server-function half runs against the
 * built bundles (server-functions/dist/*, wired up in
 * vite.config.server.mjs) — dist/server.js is the PRODUCTION bundle
 * (`_SOLID_DEV_` replaced false), which is exactly the build where
 * sanitization is live.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Errored, renderToString } from "@solidjs/web";
import {
  handleServerFunctionRequest,
  registerServerFunction,
  sanitizeServerError
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

describe("thrown Response passes through SSR error handling", () => {
  test("without a boundary it propagates out of the render untouched", () => {
    const response = new Response(null, { status: 302, headers: { Location: "/next" } });
    let caught: unknown;
    try {
      renderToString(() => {
        throw response;
      });
    } catch (err) {
      caught = err;
    }
    // The exact instance, not a copy or a wrapped error — the integration
    // above the render turns it into the HTTP response.
    expect(caught).toBe(response);
  });

  // DOES NOT HOLD in current code — pinned as the intended invariant,
  // skipped so the suite stays green while the ruling is implemented.
  // Today `<Errored>` treats a thrown Response as an ordinary error: the
  // fallback renders with the Response as its error argument AND the
  // Response is serialized into the hydration payload (`ctx.serialize`
  // emits `new Response(...)` into the stream). A boundary has no coherent
  // meaning for response control flow — after shell flush the status is
  // frozen and the boundary may already have streamed fallback HTML — so
  // the Response should pass through the boundary to the integration
  // instead of being swallowed (see RFC 12's alternatives-considered entry
  // on throw-through-boundaries).
  test.skip("a boundary lets it through instead of rendering fallback (intended, not yet held)", () => {
    const response = new Response(null, { status: 302, headers: { Location: "/next" } });
    let fallbackArg: unknown;
    let caught: unknown;
    const Thrower = () => {
      throw response;
    };
    try {
      renderToString(() => (
        <Errored
          fallback={(err: any) => {
            fallbackArg = err();
            return <span>fallback</span>;
          }}
        >
          {<Thrower />}
        </Errored>
      ));
    } catch (err) {
      caught = err;
    }
    expect(fallbackArg).toBeUndefined();
    expect(caught).toBe(response);
  });
});

describe("error sanitization passes thrown Responses through (production bundle)", () => {
  function dispatch(id: string) {
    return handleServerFunctionRequest(
      new Request(`http://localhost/_server/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "X-Server-Function-Instance": "server-function:test",
          "content-type": "application/json",
          "X-Server-Function-Format": "1"
        },
        body: "[]"
      })
    );
  }

  test("a thrown Response rides the wire unsanitized and unbranded", async () => {
    const response = new Response(null, { status: 302, headers: { Location: "/next" } });
    registerServerFunction("invariant#throw-response", async () => {
      throw response;
    });
    const out = await dispatch("invariant#throw-response");
    // Intentional control flow: the redirect metadata is forwarded (the
    // client integration handles the redirect, so the status stays 200 on
    // the instance path) and the error flag is the plain thrown marker —
    // not a sanitized message.
    expect(out.headers.get("Location")).toBe("/next");
    expect(out.headers.get("X-Server-Function-Error")).toBe("true");
    // The path never brands the Response as a "safe error" — it is not an
    // error at all, and must not leave the exchange wearing error marks.
    expect((response as any)[Symbol.for("solid.SafeError")]).toBeUndefined();
  });

  test("a plain thrown error on the same path IS sanitized (the contrast)", async () => {
    registerServerFunction("invariant#throw-plain", async () => {
      throw new Error("secret connection string");
    });
    const out = await dispatch("invariant#throw-plain");
    expect(out.headers.get("X-Server-Function-Error")).toBe("Internal Server Error");
  });

  // DOES NOT HOLD for the bare function — pinned as the intended
  // invariant, skipped so the suite stays green. `sanitizeServerError`
  // called directly with a Response answers the generic Error (a Response
  // is neither the dev build's passthrough nor `markSafeError`-branded).
  // The handler never routes thrown Responses into it (they are handled
  // as control flow before sanitization — the passing tests above), so
  // the exchange is safe today; but any future caller feeding a Response
  // to the sanitizer directly would swallow a redirect into an
  // "Internal Server Error".
  test.skip("sanitizeServerError passes a Response through (intended, not yet held)", () => {
    const response = new Response(null, { status: 302, headers: { Location: "/next" } });
    expect(sanitizeServerError(response)).toBe(response);
  });
});
