/**
 * #3222'S GUARANTEE ONE CONTAINER DOWN (#3241).
 *
 * Calling a generator only allocates it; calling a stream's reader is what
 * runs its pull. So the request scope around the CALL does not own either
 * body — the consumer drives it later, from whatever async context it
 * happens to be in, which during SSR is the render's ambient event.
 * `scopeDeferredResult` binds those deferred operations to the per-call
 * event, and `server-functions-request-event-scope.spec.tsx` pins it for a
 * body the function RETURNS DIRECTLY.
 *
 * The ruled carrier set for the descent is PLAIN OBJECTS and ARRAYS only —
 * `return { rows: cursor() }` and `return [cursor()]` are supported shapes
 * on both roads; Set/Map members and frozen/non-writable slots are NOT
 * (their identities and shapes are not the runtime's to rebuild — pinned
 * below, deliberately, at their current unscoped behavior). And the
 * wrapping must never write into the user's returned object: on the HTTP
 * road it lands in the encoded representation (the guard walk's rebuilt
 * shells), on the direct road in a shallow-rebuilt carrier handed to the
 * caller — the container the function returned stays untouched.
 *
 * The direct-road tests interleave two concurrent calls with explicit
 * promise barriers (no sleeps): B's write lands while A is parked, so a
 * body sharing the ambient event reads back B's write where a correctly
 * scoped one reads its own.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestEvent, getRequestEvent } from "@solidjs/web";
import {
  createServerReference,
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");
const requestContext = new AsyncLocalStorage<any>();

beforeAll(() => {
  (globalThis as any)[RequestContext] = requestContext;
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

function eventFor(tenant: string) {
  return createRequestEvent(
    new Request("https://app.example/page", { headers: { "X-Tenant": tenant } })
  );
}

function post(id: string) {
  return new Request(`https://app.example/_server/data/${id}`, {
    method: "POST",
    body: "[]",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "X-Server-Function-Format": "8",
      "X-Server-Function-Instance": "server-function:test"
    }
  });
}

async function drain<T>(source: AsyncIterable<T>) {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

const tenant = () => getRequestEvent()?.request.headers.get("X-Tenant") || "NO-EVENT";

describe("nested deferred work on the HTTP road (#3241)", () => {
  it("scopes a generator nested in an object property across a deferred pull", async () => {
    const seen: string[] = [];
    let returned: { rows: AsyncIterable<string> } | undefined;
    let source: AsyncIterable<string> | undefined;
    registerServerFunction("nested-http-object", () => {
      async function* rows() {
        seen.push(`start:${tenant()}`);
        yield "one";
        // this resumption is the deferred pull: it runs when the codec
        // drains the body, after the dispatch call itself has returned
        seen.push(`resume:${tenant()}`);
        yield "two";
      }
      source = rows();
      returned = { rows: source };
      return returned;
    });

    await requestContext.run(eventFor("AMBIENT"), async () => {
      const response = await handleServerFunctionRequest(post("nested-http-object"), {
        createEvent: () => eventFor("REQUEST")
      });
      await response.text();
    });

    expect(seen).toEqual(["start:REQUEST", "resume:REQUEST"]);
    // the wrapping landed in the encoded representation, never in the
    // user's returned container
    expect(returned!.rows).toBe(source);
  });

  it("scopes a generator nested in an array element across a deferred pull", async () => {
    const seen: string[] = [];
    registerServerFunction("nested-http-array", () => {
      async function* rows() {
        seen.push(`start:${tenant()}`);
        yield "one";
        seen.push(`resume:${tenant()}`);
      }
      return [rows()];
    });

    await requestContext.run(eventFor("AMBIENT"), async () => {
      const response = await handleServerFunctionRequest(post("nested-http-array"), {
        createEvent: () => eventFor("REQUEST")
      });
      await response.text();
    });

    expect(seen).toEqual(["start:REQUEST", "resume:REQUEST"]);
  });
});

describe("nested deferred work on the direct SSR road (#3241)", () => {
  /**
   * Two concurrent calls whose bodies interleave DETERMINISTICALLY: A
   * writes and parks on a barrier that only B's body releases, so B's
   * write is committed while A is parked. Scoped correctly, each body
   * reads back its own write.
   */
  function witnessPair() {
    let releaseA!: () => void;
    const parkedA = new Promise<void>(resolve => (releaseA = resolve));
    return async function* witness(who: string) {
      getRequestEvent()!.locals.writer = who;
      if (who === "A") await parkedA;
      else releaseA();
      yield `${who}:${getRequestEvent()!.locals.writer}`;
    };
  }

  it("isolates concurrent calls whose generator is nested in an object", async () => {
    const witness = witnessPair();
    const returned: Record<string, { rows: AsyncIterable<string> }> = {};
    const sources: Record<string, AsyncIterable<string>> = {};
    const reference = createServerReference({
      id: "nested-direct-object",
      name: "nestedDirectObject",
      fn: (who: string) => {
        sources[who] = witness(who);
        return (returned[who] = { rows: sources[who] });
      }
    } as any) as (who: string) => { rows: AsyncIterable<string> };
    const render = eventFor("RENDER");
    render.locals.writer = "none";

    const values = await requestContext.run(render, () => {
      const a = reference("A");
      const b = reference("B");
      return Promise.all([drain(a.rows), drain(b.rows)]);
    });

    expect({ values, renderWriter: render.locals.writer }).toEqual({
      values: [["A:A"], ["B:B"]],
      // unscoped, the nested generator writes through to the render itself
      renderWriter: "none"
    });
    // the user's returned container was never written into: the slot still
    // holds the very generator the function put there
    expect(returned.A.rows).toBe(sources.A);
    expect(returned.B.rows).toBe(sources.B);
  });

  it("isolates concurrent calls whose generator is nested in an array", async () => {
    const witness = witnessPair();
    const returned: Record<string, AsyncIterable<string>[]> = {};
    const sources: Record<string, AsyncIterable<string>> = {};
    const reference = createServerReference({
      id: "nested-direct-array",
      name: "nestedDirectArray",
      fn: (who: string) => {
        sources[who] = witness(who);
        return (returned[who] = [sources[who]]);
      }
    } as any) as (who: string) => AsyncIterable<string>[];
    const render = eventFor("RENDER");
    render.locals.writer = "none";

    const values = await requestContext.run(render, () => {
      const a = reference("A");
      const b = reference("B");
      return Promise.all([drain(a[0]), drain(b[0])]);
    });

    expect({ values, renderWriter: render.locals.writer }).toEqual({
      values: [["A:A"], ["B:B"]],
      renderWriter: "none"
    });
    expect(returned.A[0]).toBe(sources.A);
    expect(returned.B[0]).toBe(sources.B);
  });

  it("keeps identity for results with nothing deferred inside", async () => {
    const marker = { rows: [1, 2, 3], meta: { total: 3 } };
    const reference = createServerReference({
      id: "nested-direct-identity",
      fn: () => marker
    } as any) as () => typeof marker;

    const result = await requestContext.run(eventFor("RENDER"), async () => reference());

    // no deferred work anywhere in the graph: the caller receives the very
    // object the function returned
    expect(result).toBe(marker);
  });

  it("pins Set members and frozen slots as out of the carrier set", async () => {
    // RULED OUT OF SCOPE (#3241): the supported carriers are plain objects
    // and arrays only. A generator reached through a Set member or a
    // frozen/non-writable slot stays bound to nothing — it runs under the
    // ambient (render) event, exactly as before. This test PINS that
    // behavior; it is not a promise to scope these shapes later.
    const seen: string[] = [];
    async function* witness(label: string) {
      seen.push(`${label}:${(getRequestEvent() as any)?.derived === true ? "call" : "ambient"}`);
      yield label;
    }
    const reference = createServerReference({
      id: "nested-direct-out-of-scope",
      fn: () => {
        const event = getRequestEvent() as any;
        event.derived = true;
        return {
          inSet: new Set([witness("set")]),
          frozen: Object.freeze({ rows: witness("frozen") })
        };
      }
    } as any) as () => {
      inSet: Set<AsyncIterable<string>>;
      frozen: { rows: AsyncIterable<string> };
    };

    await requestContext.run(eventFor("RENDER"), async () => {
      const result = reference();
      await drain([...result.inSet][0]);
      await drain(result.frozen.rows);
    });

    expect(seen).toEqual(["set:ambient", "frozen:ambient"]);
  });
});
