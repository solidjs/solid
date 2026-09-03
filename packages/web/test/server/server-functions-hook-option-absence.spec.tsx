/**
 * How a handler option spells "I am not overriding this" — and why the
 * answer has to be the same for every hook.
 *
 * `handleServerFunctionRequest` resolves its hooks against the server-wide
 * configuration two different ways:
 *
 *   const provide = options.provideEvent || provideEvent;                  // null falls back
 *   const wrapInvocation = options.wrapInvocation !== undefined            // null DISABLES
 *     ? options.wrapInvocation : config.wrapInvocation;
 *
 * The same absent-looking value therefore lands on opposite sides of the
 * safety line, and the unsafe side is the security hook: `wrapInvocation`
 * is the per-invocation seam an app hangs authorization on (see
 * `server-functions-invocation-wrap.spec.tsx`), so a `null` here silently
 * takes the app's gate off exactly one request and dispatch runs the body
 * unguarded, with a 200.
 *
 * TypeScript callers are protected — `null` is not assignable to
 * `WrapInvocationHook` — which is precisely why this is worth pinning: the
 * callers that CAN produce it are the ones with no compiler watching. An
 * options object assembled in a JS adapter, or computed as
 * `{ wrapInvocation: perRoute.wrap ?? null }`, reads as "nothing to
 * override" everywhere else in this file and disables the gate here.
 *
 * The invariant: an option value that is not a hook cannot REMOVE policy.
 * Overriding the configured wrap requires supplying a wrap; absence — in
 * whatever spelling — means the configured one still owns the call.
 * (`transformResult` and the flight hooks resolve the same way, but they
 * are result policy, not the gate; only the security hook is pinned here.)
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createRequestEvent } from "@solidjs/web";
import {
  configureServerFunctionsServer,
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");

/**
 * `configure` ignores `undefined` — that is its spelling of "not
 * overriding" — so undoing a hook between tests takes a value. `null` is
 * the falsy "nothing configured" every read site tests for; the cast is
 * only because the option type describes hooks, not their absence.
 */
const NO_HOOK = null as any;

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterEach(() => {
  configureServerFunctionsServer({ wrapInvocation: NO_HOOK });
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const createEvent = (request: Request) => createRequestEvent(request);

/** A scripted POST call, the shape the client transport produces. */
function post(id: string) {
  return new Request(`https://app.example/_server/data/${id}`, {
    method: "POST",
    body: "[]",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "content-type": "application/json",
      "X-Server-Function-Format": "8",
      "X-Server-Function-Instance": "server-function:test"
    }
  });
}

/**
 * The app's configured gate: it refuses every call with a 403 and never
 * lets the body run. Each call reports what actually happened, so a
 * failure names the leak instead of an opaque status.
 */
function withConfiguredGate(id: string) {
  let gateRan = 0;
  let bodyRan = 0;
  configureServerFunctionsServer({
    wrapInvocation: () => {
      gateRan++;
      throw new Response(null, { status: 403 });
    }
  });
  registerServerFunction(id, async () => {
    bodyRan++;
    return "the secret";
  });
  return async (options: Record<string, unknown>) => {
    gateRan = 0;
    bodyRan = 0;
    const response = await handleServerFunctionRequest(post(id), { createEvent, ...options });
    return {
      status: response.status,
      gateRan,
      bodyRan,
      leaked: (await response.text()).includes("the secret")
    };
  };
}

describe("a handler option cannot take the configured authorization gate off", () => {
  it("runs the configured wrap when no option is supplied at all", async () => {
    const call = await withConfiguredGate("absence-baseline");
    expect(await call({})).toStrictEqual({ status: 403, gateRan: 1, bodyRan: 0, leaked: false });
  });

  it("runs the configured wrap when the option is explicitly undefined", async () => {
    const call = await withConfiguredGate("absence-undefined");
    expect(await call({ wrapInvocation: undefined })).toStrictEqual({
      status: 403,
      gateRan: 1,
      bodyRan: 0,
      leaked: false
    });
  });

  it("runs the configured wrap when the option is null, the other spelling of absent", async () => {
    const call = await withConfiguredGate("absence-null");
    // today: { status: 200, gateRan: 0, bodyRan: 1, leaked: true } — the
    // gate is skipped for this one request and the body answers the caller
    expect(await call({ wrapInvocation: null })).toStrictEqual({
      status: 403,
      gateRan: 1,
      bodyRan: 0,
      leaked: false
    });
  });

  it("already treats a null provideEvent as absent, which is the direction to match", async () => {
    const call = await withConfiguredGate("absence-provide-event");
    expect(await call({ provideEvent: null })).toStrictEqual({
      status: 403,
      gateRan: 1,
      bodyRan: 0,
      leaked: false
    });
  });
});
