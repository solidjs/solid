/**
 * `new fn()` is a call, and every road into a server function body has to
 * be one road.
 *
 * `createServerReference` returns a Proxy over the user's function with a
 * `get` trap (identity, metadata, the invoke channel) and an `apply` trap.
 * The apply trap is where the whole server-side contract lives: the "cannot
 * call a server function outside of a request" guard, the derived event
 * with its copied locals, the invocation identity, `wrapInvocation`, and
 * `transformDirectResult`.
 *
 * A Proxy with no `construct` trap forwards construction straight to the
 * target. So `new fn()` — or `Reflect.construct(fn, args)`, which is what a
 * generic dispatcher, a DI container, or a serializer reviving a value
 * reaches for — runs the body having consulted none of it: no request
 * scope, no event, and no authorization hook. It is the one entry that
 * skips even the outside-a-request guard, so it does not merely bypass
 * policy, it runs the body somewhere policy could not have been evaluated
 * in the first place.
 *
 * The invariant: the body is reachable through the apply trap or not at
 * all. Whether construction is routed through it or refused outright, it
 * cannot be a second, unguarded entrance.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  configureServerFunctionsServer,
  createServerReference as createServerSideReference,
  registerServerReference
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

/** Runs `fn` under an established request scope, as a render would. */
function underRender<T>(fn: () => T): T {
  const storage = (globalThis as any)[RequestContext] as AsyncLocalStorage<unknown>;
  return storage.run({ request: new Request("https://app.example/page"), locals: {} }, fn);
}

describe("construction is not a second entrance to the body", () => {
  it("refuses `new fn()` outside a request, as calling it does", () => {
    let bodyRan = 0;
    const call = createServerSideReference(
      registerServerReference("construct-outside", function () {
        bodyRan++;
      })
    );

    // the road next to it is guarded; this one is not. The message is left
    // to the fix — routing construction through the apply trap raises the
    // existing "outside of a request" guard, refusing it outright says so
    // in its own words — what is pinned is that the body is not reached.
    let threw = false;
    try {
      new (call as any)();
    } catch {
      threw = true;
    }
    // today: { threw: false, bodyRan: 1 } — the body ran with no request
    // event in scope
    expect({ threw, bodyRan }).toStrictEqual({ threw: true, bodyRan: 0 });
  });

  it("does not let `new fn()` walk around the authorization gate inside a request", () => {
    let bodyRan = 0;
    let gateRan = 0;
    configureServerFunctionsServer({
      wrapInvocation: () => {
        gateRan++;
        throw new Error("policy denied");
      }
    });
    const call = createServerSideReference(
      registerServerReference("construct-gated", function (this: any) {
        bodyRan++;
        this.secret = "the secret";
      })
    );

    // whichever way construction is answered — routed through the apply
    // trap, or refused as not-a-call — it must not reach the body
    let threw = false;
    try {
      underRender(() => new (call as any)());
    } catch {
      threw = true;
    }
    // today: { threw: false, bodyRan: 1 }, and the gate never saw the call.
    // `gateRan` is deliberately not asserted: 1 if construction routes
    // through the apply trap, 0 if it is refused before one exists.
    expect({ threw, bodyRan, gateRan }).toStrictEqual({ threw: true, bodyRan: 0, gateRan });
  });

  it("refuses Reflect.construct too — the spelling a generic caller uses", () => {
    let bodyRan = 0;
    const call = createServerSideReference(
      registerServerReference("construct-reflect", function () {
        bodyRan++;
      })
    );

    let threw = false;
    try {
      Reflect.construct(call as any, []);
    } catch {
      threw = true;
    }
    expect({ threw, bodyRan }).toStrictEqual({ threw: true, bodyRan: 0 });
  });
});
