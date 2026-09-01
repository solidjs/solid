/**
 * `wrapInvocation` — the per-invocation seam frameworks hang policy on
 * (per-function middleware, auth, logging, error mapping). Two properties
 * make it usable as a GATE rather than as a logger, and both are load-bearing:
 *
 *  - it wraps DIRECT SSR calls too, not only HTTP dispatch, so a policy
 *    cannot be walked around by calling the function during a render; and
 *  - a wrapper that declines never lets the function body run, and what it
 *    threw does not reach the caller unless it chose an HTTP shape.
 *
 * The direct leg also has to stay transparent: a synchronous function called
 * during a render must still return its value, not a promise, or wrapping
 * the whole app in a policy would make every server call async.
 *
 * `wrapInvocation` had no coverage on either dispatch leg.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createRequestEvent } from "@solidjs/web";
import {
  ERROR_HEADER,
  GENERIC_SERVER_ERROR_MESSAGE,
  configureServerFunctionsServer,
  createServerReference as createServerSideReference,
  decodeResponse,
  getEventServerFunctionInvocation,
  getServerFunctionInvocation,
  handleServerFunctionRequest,
  registerServerFunction,
  registerServerReference
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterEach(() => {
  configureServerFunctionsServer({ wrapInvocation: undefined });
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

/** A scripted POST call, the shape the client transport produces. */
function post(id: string, args: unknown[]) {
  return new Request(`https://app.example/_server/data/${id}`, {
    method: "POST",
    body: JSON.stringify(args),
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "content-type": "application/json",
      "X-Server-Function-Format": "8",
      "X-Server-Function-Instance": "server-function:test"
    }
  });
}

/** The per-call event an integration supplies; not a configure() key. */
const createEvent = (request: Request) => createRequestEvent(request);

/** Runs `fn` under an established request scope, as a render would. */
function underRender<T>(fn: () => T): T {
  const storage = (globalThis as any)[RequestContext] as AsyncLocalStorage<unknown>;
  return storage.run({ request: new Request("https://app.example/page"), locals: {} }, fn);
}

describe("the wrap reaches both dispatch paths", () => {
  it("wraps a direct SSR call — a render cannot walk around the policy", () => {
    const seen: any[] = [];
    configureServerFunctionsServer({
      wrapInvocation: (run, context) => {
        seen.push({
          id: context.id,
          args: context.args,
          direct: context.direct,
          hasRequest: context.request !== undefined,
          serverOnly: context.event.serverOnly
        });
        return run();
      }
    });
    const call = createServerSideReference(
      registerServerReference("wrap-direct", (n: number) => n * 2)
    );

    const result = underRender(() => (call as any)(21));

    // the policy ran, and it can tell an in-process call from a wire one
    expect(seen).toStrictEqual([
      { id: "wrap-direct", args: [21], direct: true, hasRequest: false, serverOnly: true }
    ]);
    // and the direct leg stayed synchronous: a sync function keeps its value
    expect(result).toBe(42);
  });

  it("wraps HTTP dispatch, naming the request and the decoded arguments", async () => {
    const seen: any[] = [];
    registerServerFunction("wrap-http", async (a: number, b: number) => a + b);

    const response = await handleServerFunctionRequest(post("wrap-http", [20, 22]), {
      createEvent,
      wrapInvocation: (run, context) => {
        seen.push({
          id: context.id,
          args: context.args,
          direct: context.direct,
          hasRequest: context.request !== undefined,
          serverOnly: context.event.serverOnly
        });
        return run();
      }
    });

    expect(response.status).toBe(200);
    expect(seen).toStrictEqual([
      { id: "wrap-http", args: [20, 22], direct: false, hasRequest: true, serverOnly: undefined }
    ]);
  });

  it("lets a per-handler wrap replace the configured one instead of stacking", async () => {
    const configured: string[] = [];
    const perHandler: string[] = [];
    configureServerFunctionsServer({
      wrapInvocation: (run, context) => {
        configured.push(context.id);
        return run();
      }
    });
    registerServerFunction("wrap-override", async () => "ok");

    // no per-handler option: the configured wrap owns the call
    await handleServerFunctionRequest(post("wrap-override", []), { createEvent });
    expect(configured).toStrictEqual(["wrap-override"]);

    // with one: it replaces the configured wrap rather than running inside it
    await handleServerFunctionRequest(post("wrap-override", []), {
      createEvent,
      wrapInvocation: (run, context) => {
        perHandler.push(context.id);
        return run();
      }
    });
    expect(perHandler).toStrictEqual(["wrap-override"]);
    expect(configured).toStrictEqual(["wrap-override"]);
  });
});

describe("a wrap that answers instead of the function", () => {
  it("never runs the function, and does not leak what it threw", async () => {
    let ran = 0;
    registerServerFunction("wrap-deny", async () => {
      ran++;
      return "the secret";
    });

    const response = await handleServerFunctionRequest(post("wrap-deny", []), {
      createEvent,
      wrapInvocation: () => {
        throw new Error("policy denied for tenant acme-42");
      }
    });

    expect(ran).toBe(0);
    expect(response.status).toBe(500);
    // the policy's own message is server-side detail, not the caller's
    const body = await response.text();
    expect(body).not.toContain("acme-42");
    // paired with the positive: the negative alone passes on an empty or
    // undecodable body, which is how a broken sanitizer goes green
    expect(body).toContain(GENERIC_SERVER_ERROR_MESSAGE);
    expect(response.headers.get(ERROR_HEADER)).toBe(GENERIC_SERVER_ERROR_MESSAGE);
  });

  it("stops a direct SSR call too — the walk-around the gate exists to close", () => {
    let ran = 0;
    configureServerFunctionsServer({
      wrapInvocation: () => {
        throw new Error("policy denied");
      }
    });
    const call = createServerSideReference(
      registerServerReference("wrap-direct-deny", () => {
        ran++;
        return "the secret";
      })
    );

    // a render reaches the function in-process, so the gate has to hold on a
    // leg that never touches the transport
    expect(() => underRender(() => (call as any)())).toThrow("policy denied");
    expect(ran).toBe(0);
  });

  it("keeps the HTTP shape when it declines with a Response", async () => {
    let ran = 0;
    registerServerFunction("wrap-gate", async () => {
      ran++;
      return "the secret";
    });

    const response = await handleServerFunctionRequest(post("wrap-gate", []), {
      createEvent,
      wrapInvocation: () => {
        throw new Response(null, {
          status: 401,
          headers: { "WWW-Authenticate": 'Bearer realm="app"' }
        });
      }
    });

    expect(ran).toBe(0);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="app"');
  });

  it("substitutes the result when it answers in the function's place", async () => {
    let ran = 0;
    registerServerFunction("wrap-substitute", async () => {
      ran++;
      return "from the function";
    });

    const response = await handleServerFunctionRequest(post("wrap-substitute", []), {
      createEvent,
      wrapInvocation: () => "from the policy"
    });

    expect(ran).toBe(0);
    expect(response.status).toBe(200);
    expect(await decodeResponse(response)).toBe("from the policy");
  });
});

describe("the invocation identity a policy keys on", () => {
  it("answers inside the wrap, before and after the function runs", async () => {
    let insideWrap: unknown;
    let insideFunction: unknown;
    let afterRun: unknown;
    let event!: ReturnType<typeof createEvent>;
    registerServerFunction("wrap-identity", async () => {
      insideFunction = getServerFunctionInvocation();
      return "ok";
    });

    await handleServerFunctionRequest(post("wrap-identity", []), {
      createEvent: request => (event = createEvent(request)),
      wrapInvocation: run => {
        insideWrap = getServerFunctionInvocation();
        return Promise.resolve(run()).then(value => {
          afterRun = getServerFunctionInvocation();
          return value;
        });
      }
    });

    expect(insideWrap).toEqual({ id: "wrap-identity" });
    expect(insideFunction).toEqual({ id: "wrap-identity" });
    expect(afterRun).toEqual({ id: "wrap-identity" });
    // and off the event, for a policy holding the event rather than the scope
    expect(getEventServerFunctionInvocation(event)).toEqual({ id: "wrap-identity" });
    // outside any call there is nothing to read
    expect(getServerFunctionInvocation()).toBeUndefined();
  });
});
