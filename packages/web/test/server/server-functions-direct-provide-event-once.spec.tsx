/**
 * `provideEvent` must call the function exactly once — on BOTH dispatch
 * legs, not only over HTTP (#3246, completing #3172).
 *
 * The HTTP tail counts invocations at the seam and refuses a second one
 * before the body re-enters, "a second invocation would commit the call's
 * side effects twice", and refuses zero, because a hook that never invoked
 * the callback would answer as a void success indistinguishable from a
 * function that returned nothing. Both land on dispatch's catch as a
 * sanitized 500.
 *
 * `createServerReference`'s apply trap — the direct SSR leg — calls the
 * same host-supplied hook with no such count. The hook is one object
 * installed once by the adapter, so a hook broken in either direction is
 * broken for every call the process makes; the leg that catches it is the
 * only difference. Today that means the same defective adapter is a clean
 * 500 on the wire and a silent double-commit during a render — the leg
 * with no client, no status line and no log to notice it by — and a hook
 * that skips the callback hands the render `undefined` as a successful
 * value, which then flows into the page as if the function had returned
 * nothing.
 *
 * The invariant: the exactly-once guard belongs to the hook contract, so it
 * has to hold wherever the hook is honored. Also pinned: the guard must not
 * cost the direct leg its transparency — a synchronous function called
 * during a render still returns its value, not a promise (see
 * `server-functions-invocation-wrap.spec.tsx`).
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
  configureServerFunctionsServer({ provideEvent: NO_HOOK });
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

/** Runs `fn` under an established request scope, as a render would. */
function underRender<T>(fn: () => T): T {
  const storage = (globalThis as any)[RequestContext] as AsyncLocalStorage<unknown>;
  return storage.run({ request: new Request("https://app.example/page"), locals: {} }, fn);
}

describe("the exactly-once contract on the direct SSR leg", () => {
  it("refuses a hook that invokes the function twice, before the body runs again", () => {
    let bodyRan = 0;
    configureServerFunctionsServer({
      // the shape a retry wrapper or a misplaced await produces
      provideEvent: (event, fn) => {
        fn();
        return fn();
      }
    });
    const call = createServerSideReference(
      registerServerReference("provide-twice-direct", () => {
        bodyRan++;
        return bodyRan;
      })
    );

    // today: no throw at all — the body commits twice and the render is
    // handed the second run's value as an ordinary success. The message is
    // the HTTP tail's, which already names the hook and says why the second
    // invocation is refused; a render has even less context than a request
    // log, so it needs it more.
    expect(() => underRender(() => (call as any)())).toThrow(/more than once/);
    expect(bodyRan).toBe(1);
  });

  it("refuses a hook that never invokes the function, instead of answering undefined", () => {
    let bodyRan = 0;
    configureServerFunctionsServer({
      // off-contract on purpose, so the cast is the test's subject
      provideEvent: (() => undefined) as any
    });
    const call = createServerSideReference(
      registerServerReference("provide-never-direct", () => {
        bodyRan++;
        return "the value";
      })
    );

    // today: returns undefined, which a render cannot tell from a function
    // that returned nothing
    expect(() => underRender(() => (call as any)())).toThrow(/without invoking/);
    expect(bodyRan).toBe(0);
  });

  it("still returns a synchronous function's value synchronously under a correct hook", () => {
    let bodyRan = 0;
    configureServerFunctionsServer({
      provideEvent: (event, fn) => fn()
    });
    const call = createServerSideReference(
      registerServerReference("provide-once-direct", (n: number) => {
        bodyRan++;
        return n * 2;
      })
    );

    // the guard must not turn the direct leg async or wrap its result:
    // paired with the negatives above so a guard that refuses everything
    // cannot go green
    expect(underRender(() => (call as any)(21))).toBe(42);
    expect(bodyRan).toBe(1);
  });
});
