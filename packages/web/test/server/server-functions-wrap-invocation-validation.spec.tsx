/**
 * An invalid `wrapInvocation` value is a configuration error, not an
 * absence (#3238).
 *
 * `wrapInvocation` is the per-invocation seam an app hangs policy on —
 * auth, logging, error mapping (see
 * `server-functions-invocation-wrap.spec.tsx`). The read sites used to
 * test it for truthiness, so every non-function spelling failed in the
 * quietest available direction: `null` and `false` silently took the
 * policy off the call (dispatch ran the body unguarded, with a 200), and a
 * truthy non-function (an options bag in the wrong slot) threw a bare
 * "not a function" out of the middle of dispatch, attributed to nothing.
 *
 * The ruled behavior: a value other than a function or `undefined` throws
 * a clear configuration error — naming `wrapInvocation` and the received
 * type — at the point the hook is resolved for an invocation, on BOTH
 * roads (HTTP dispatch and direct SSR calls). `undefined` stays the one
 * spelling of "no override": a per-request `undefined` falls back to the
 * configured hook, and an all-`undefined` resolution runs the bare
 * function, exactly as before.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestEvent } from "@solidjs/web";
import {
  configureServerFunctionsServer,
  createServerReference as createServerSideReference,
  handleServerFunctionRequest,
  registerServerFunction,
  registerServerReference
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterEach(() => {
  // restore a valid resolution for the next test: `undefined` is skipped
  // by configure (its spelling of "not overriding"), so clearing takes a
  // value, and the transparent hook is the sanctioned one
  configureServerFunctionsServer({ wrapInvocation: run => run() });
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const createEvent = (request: Request) => createRequestEvent(request);

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

/** Runs `fn` under an established request scope, as a render would. */
function underRender<T>(fn: () => T): T {
  const storage = (globalThis as any)[RequestContext] as AsyncLocalStorage<unknown>;
  return storage.run({ request: new Request("https://app.example/page"), locals: {} }, fn);
}

describe("invalid wrapInvocation values throw on the HTTP road", () => {
  it("refuses a null per-request option instead of bypassing the configured hook", async () => {
    let gateRan = 0;
    let bodyRan = 0;
    configureServerFunctionsServer({
      wrapInvocation: run => {
        gateRan++;
        return run();
      }
    });
    registerServerFunction("wrap-invalid-null", () => {
      bodyRan++;
      return "the secret";
    });

    await expect(
      handleServerFunctionRequest(post("wrap-invalid-null"), {
        createEvent,
        wrapInvocation: null as any
      })
    ).rejects.toThrow(/wrapInvocation.*null/s);

    // neither silently unhooked nor silently dispatched: nothing ran
    expect({ gateRan, bodyRan }).toStrictEqual({ gateRan: 0, bodyRan: 0 });
  });

  it("refuses false, naming the received type", async () => {
    let bodyRan = 0;
    registerServerFunction("wrap-invalid-false", () => {
      bodyRan++;
      return "ok";
    });

    await expect(
      handleServerFunctionRequest(post("wrap-invalid-false"), {
        createEvent,
        wrapInvocation: false as any
      })
    ).rejects.toThrow(/wrapInvocation.*boolean/s);
    expect(bodyRan).toBe(0);
  });

  it("refuses a configured non-function object instead of throwing mid-dispatch", async () => {
    let bodyRan = 0;
    configureServerFunctionsServer({ wrapInvocation: { wrap: true } as any });
    registerServerFunction("wrap-invalid-object", () => {
      bodyRan++;
      return "ok";
    });

    await expect(
      handleServerFunctionRequest(post("wrap-invalid-object"), { createEvent })
    ).rejects.toThrow(/wrapInvocation.*object/s);
    expect(bodyRan).toBe(0);
  });

  it("still lets a valid per-request hook override an invalid configured one", async () => {
    const seen: string[] = [];
    configureServerFunctionsServer({ wrapInvocation: null as any });
    registerServerFunction("wrap-invalid-overridden", () => "ok");

    // resolution picks the option; the configured value is never resolved
    // for this invocation
    const response = await handleServerFunctionRequest(post("wrap-invalid-overridden"), {
      createEvent,
      wrapInvocation: (run, context) => {
        seen.push(context.id);
        return run();
      }
    });

    expect(response.status).toBe(200);
    expect(seen).toEqual(["wrap-invalid-overridden"]);
  });

  it("keeps undefined as the one spelling of absence", async () => {
    let gateRan = 0;
    configureServerFunctionsServer({
      wrapInvocation: run => {
        gateRan++;
        return run();
      }
    });
    registerServerFunction("wrap-undefined-absent", () => "ok");

    const response = await handleServerFunctionRequest(post("wrap-undefined-absent"), {
      createEvent,
      wrapInvocation: undefined
    });

    expect(response.status).toBe(200);
    expect(gateRan).toBe(1);
  });
});

describe("invalid wrapInvocation values throw on the direct road", () => {
  it("refuses a configured null at the direct call, before the body runs", () => {
    let bodyRan = 0;
    const reference = createServerSideReference(
      registerServerReference("wrap-invalid-direct", () => {
        bodyRan++;
        return "ok";
      })
    );
    configureServerFunctionsServer({ wrapInvocation: null as any });

    expect(() => underRender(() => (reference as any)())).toThrow(/wrapInvocation.*null/s);
    expect(bodyRan).toBe(0);
  });

  it("refuses a configured non-function object at the direct call", () => {
    let bodyRan = 0;
    const reference = createServerSideReference(
      registerServerReference("wrap-invalid-direct-object", () => {
        bodyRan++;
        return "ok";
      })
    );
    configureServerFunctionsServer({ wrapInvocation: {} as any });

    expect(() => underRender(() => (reference as any)())).toThrow(/wrapInvocation.*object/s);
    expect(bodyRan).toBe(0);
  });
});
