/**
 * `sanitizeServerError` guards the one road a thrown error takes out of
 * dispatch. A failure can also escape through the RESULT GRAPH — a
 * rejected promise, an async iterable that throws, a stream that errors —
 * where it reaches the codec as a value to encode rather than as a throw.
 * Same failure, different road, and the leak is the one the sanitizer
 * exists to stop: a driver error's message and own-properties (failing
 * query, connection string, bound params) riding the wire verbatim, under
 * a 200 carrying no error tag because the head is already committed.
 *
 * Every case here round-trips through the client as well as reading the
 * wire. Asserting only that the body lacks the secret passes just as
 * happily when the body is empty or undecodable, which is how a broken
 * first attempt at this fix went green.
 *
 * Like the other server-function specs, these run against the built
 * bundles (server-functions/dist/*, wired up in vite.config.server.mjs),
 * which are the production variant — `DEV` is false, so the sanitizer is
 * live.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { markSafeError } from "@solidjs/web";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
import { createServerReference } from "@solidjs/web/server-functions/client";
import { frameTransformFlightResult } from "@solidjs/web/frames/server";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

/** A driver error as one actually arrives: secrets in message and own-props. */
function databaseError() {
  return Object.assign(new Error("connect ECONNREFUSED postgres://app:hunter2@10.0.0.5:5432"), {
    connectionString: "postgres://app:hunter2@10.0.0.5:5432",
    query: "SELECT * FROM users WHERE token = 'abc123'"
  });
}

const SECRETS = ["hunter2", "10.0.0.5", "SELECT * FROM users", "abc123"];

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

async function wireBody(id: string) {
  const response = await handleServerFunctionRequest(
    new Request(`https://app.example/_server/data/${id}`, {
      method: "POST",
      body: "[]",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        "X-Server-Function-Format": "8",
        "X-Server-Function-Instance": "server-function:test"
      }
    })
  );
  return response.text();
}

async function callThrough(id: string) {
  const restore = connectTransport();
  try {
    return { resolved: true as const, value: await createServerReference(id)() };
  } catch (error) {
    return { resolved: false as const, error };
  } finally {
    restore();
  }
}

describe("a failure escaping through the result graph", () => {
  it("is sanitized when an async iterable throws", async () => {
    registerServerFunction("graph-failure-iterable", async function* () {
      yield { page: 1 };
      throw databaseError();
    });

    const body = await wireBody("graph-failure-iterable");
    for (const secret of SECRETS) expect(body).not.toContain(secret);
    expect(body).toContain("Internal Server Error");
  });

  it("is sanitized when a promise in the graph rejects", async () => {
    registerServerFunction("graph-failure-promise", async () => ({
      deferred: Promise.reject(databaseError())
    }));

    const body = await wireBody("graph-failure-promise");
    for (const secret of SECRETS) expect(body).not.toContain(secret);
    expect(body).toContain("Internal Server Error");
  });

  it("does not abandon a guarded rejection when a sibling cannot encode (#3216)", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      class UserRow {
        id = 1;
      }
      registerServerFunction("graph-failure-abandoned-promise", () => ({
        rows: [new UserRow()],
        deferred: Promise.reject(databaseError())
      }));

      const body = await wireBody("graph-failure-abandoned-promise");
      expect(body).toContain("Internal Server Error");
      await new Promise(resolve => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("is sanitized when a stream in the graph errors", async () => {
    registerServerFunction("graph-failure-stream", async () => ({
      rows: new ReadableStream({
        start(controller) {
          controller.enqueue("first");
          queueMicrotask(() => controller.error(databaseError()));
        }
      })
    }));

    const body = await wireBody("graph-failure-stream");
    for (const secret of SECRETS) expect(body).not.toContain(secret);
    expect(body).toContain("Internal Server Error");
  });

  it("is sanitized when the rejection sits in a Map", async () => {
    registerServerFunction(
      "graph-failure-map",
      async () => new Map([["pending", Promise.reject(databaseError())]])
    );

    const body = await wireBody("graph-failure-map");
    for (const secret of SECRETS) expect(body).not.toContain(secret);
    expect(body).toContain("Internal Server Error");
  });

  it("keeps an error the author branded as intentional", async () => {
    registerServerFunction("graph-failure-safe", async function* () {
      yield { page: 1 };
      throw markSafeError(new Error("Order 42 not found"));
    });

    expect(await wireBody("graph-failure-safe")).toContain("Order 42 not found");
  });
});

describe("what the guard must not disturb", () => {
  // The road that already worked. A first attempt at this fix replaced the
  // encoded Error with a node the client could not read, breaking every
  // sanitized error rather than only the unsanitized ones — and no test
  // noticed, because nothing decoded a sanitized error through the client.
  it("still delivers an ordinary thrown error as a readable Error", async () => {
    registerServerFunction("graph-failure-thrown", async () => {
      throw databaseError();
    });

    const outcome = await callThrough("graph-failure-thrown");
    expect(outcome.resolved).toBe(false);
    expect((outcome as { error: any }).error).toBeInstanceOf(Error);
    expect((outcome as { error: Error }).error.message).toBe("Internal Server Error");
  });

  // An Error reached as a VALUE was never thrown, so it is data and the
  // author's to ship. The guard wraps failure channels, not errors.
  it("leaves an error that is a value alone", async () => {
    registerServerFunction("graph-value-error", async () => ({
      ok: 1,
      failure: new Error("returned, not thrown")
    }));

    const outcome = await callThrough("graph-value-error");
    expect(outcome.resolved).toBe(true);
    expect((outcome as { value: any }).value.failure.message).toBe("returned, not thrown");
  });

  // RE-PINNED for #3176: the walk now invokes getters — once — and
  // materializes the result, because the codec invoked them anyway and the
  // old "not ours to invoke" policy just meant whatever the getter minted
  // rode the wire unguarded (unsanitized rejections, untorn streams, an
  // unhandled rejection killing the process). A THROWING getter therefore
  // fails the call — but sanitized, and with a real 500: the failure is
  // known before a byte of head exists, so the status line is still free
  // to say so (#3097), where the old shape delivered the same failure as
  // an encode-time in-band trailer on a 200.
  it("invokes an accessor once while walking; a throwing one fails sanitized", async () => {
    registerServerFunction("graph-accessor", async () => ({
      ok: 1,
      get lazy() {
        throw new Error("an accessor whose invocation must not leak");
      }
    }));

    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/data/graph-accessor", {
        method: "POST",
        body: "[]",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "X-Server-Function-Format": "8",
          "X-Server-Function-Instance": "server-function:test"
        }
      })
    );

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain("must not leak");
  });

  // The walk records each container before descending, so a self-reference
  // resolves to the container being built. Getting this wrong recursed
  // until the stack gave out, and the RangeError escaped into dispatch's
  // catch as a 500 — on a shape the codec encodes natively as a back
  // reference.
  it("does not choke on a cycle", async () => {
    registerServerFunction("graph-cycle", async () => {
      const node: any = { name: "n" };
      node.self = node;
      return node;
    });

    const outcome = await callThrough("graph-cycle");
    expect(outcome.resolved).toBe(true);
    const value = (outcome as { value: any }).value;
    expect(value.self).toBe(value);
  });

  it("keeps a null-prototype object null-prototyped", async () => {
    registerServerFunction("graph-null-proto", async () => {
      const bare = Object.create(null);
      bare.deferred = Promise.reject(databaseError());
      return bare;
    });

    const body = await wireBody("graph-null-proto");
    for (const secret of SECRETS) expect(body).not.toContain(secret);
    // NullConstructor rather than a plain Object: rebuilding must not
    // hand the value a prototype it did not have.
    expect(body).toContain('"t":11');
  });

  it("passes a healthy result through untouched, nested promise included", async () => {
    registerServerFunction("graph-healthy", async () => ({
      items: [1, 2],
      nested: { deferred: Promise.resolve("value") }
    }));

    const outcome = await callThrough("graph-healthy");
    expect(outcome.resolved).toBe(true);
    const value = (outcome as { value: any }).value;
    expect(value.items).toEqual([1, 2]);
    await expect(value.nested.deferred).resolves.toBe("value");
  });
});

describe("server-function error-stack defaults (#3221)", () => {
  type Artifact = {
    handle: typeof handleServerFunctionRequest;
    register: typeof registerServerFunction;
  };
  const production: Artifact = {
    handle: handleServerFunctionRequest,
    register: registerServerFunction
  };
  let developmentArtifact: Promise<Artifact> | undefined;
  function loadDevelopmentArtifact() {
    const entry = new URL("./server-functions/dist/server.dev.js", `file://${process.cwd()}/`).href;
    return (developmentArtifact ??= import(/* @vite-ignore */ entry).then(module => ({
      handle: module.handleServerFunctionRequest,
      register: module.registerServerFunction
    })));
  }
  let callId = 0;

  function applicationErrorFrame() {
    return new Error("Card declined");
  }

  async function call(
    artifact: Artifact,
    fn: () => unknown,
    options?: Parameters<typeof handleServerFunctionRequest>[1],
    flight = false
  ) {
    const id = `stack-policy-${++callId}`;
    artifact.register(id, fn);
    const headers: Record<string, string> = {
      "Sec-Fetch-Site": "same-origin",
      "X-Server-Function-Format": "8",
      "X-Server-Function-Instance": "server-function:test"
    };
    if (flight) headers["X-Single-Flight"] = "true";
    return artifact
      .handle(
        new Request(`https://app.example/_server/data/${id}`, {
          method: "POST",
          body: "[]",
          headers
        }),
        options
      )
      .then(response => response.text());
  }

  it("the production artifact omits stacks on every request-codec road under NODE_ENV=development", async () => {
    const codec = Object.freeze({ depthLimit: 64 });
    const options = Object.freeze({ codec });
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const bodies = [
        await call(production, () => applicationErrorFrame(), options),
        await call(
          production,
          () => {
            throw applicationErrorFrame();
          },
          options
        ),
        await call(
          production,
          () => ({ deferred: Promise.reject(applicationErrorFrame()) }),
          options
        ),
        await call(
          production,
          () => () => "ok",
          {
            codec,
            collectFlightData: () => ({ "/notes": { error: applicationErrorFrame() } }),
            transformFlightResult: frameTransformFlightResult
          },
          true
        )
      ];

      for (const body of bodies) {
        expect(body).not.toContain("applicationErrorFrame");
        expect(body).not.toContain("file:///");
        expect(body).not.toContain(process.cwd());
        expect(body).not.toContain('"stack"');
      }
      expect(bodies[1]).toContain("Internal Server Error");
      expect(bodies[2]).toContain("Internal Server Error");
      expect(Object.hasOwn(codec, "serializeErrorStacks")).toBe(false);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("the development artifact retains its stack default under NODE_ENV=production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const body = await call(await loadDevelopmentArtifact(), () => {
        throw applicationErrorFrame();
      });
      expect(body).toContain("applicationErrorFrame");
      expect(body).toContain(process.cwd());
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("explicit stack-policy overrides win in both artifact directions", async () => {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const optedIn = await call(
        production,
        () => {
          throw markSafeError(applicationErrorFrame());
        },
        { codec: { serializeErrorStacks: true } }
      );
      expect(optedIn).toContain("applicationErrorFrame");

      process.env.NODE_ENV = "development";
      const optedOut = await call(
        await loadDevelopmentArtifact(),
        () => {
          throw applicationErrorFrame();
        },
        { codec: { serializeErrorStacks: false } }
      );
      expect(optedOut).toContain("Card declined");
      expect(optedOut).not.toContain("applicationErrorFrame");
      expect(optedOut).not.toContain("file:///");
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe("the frames flight sink", () => {
  // It encodes its outcome with its own serializer, so the guard has to be
  // applied there too — the same rejection that is sanitized on the plain
  // response path reached the wire intact through this one.
  it("sanitizes a failure nested in flight data", async () => {
    // a markup-valued result is what routes the response through frames
    registerServerFunction("flight-markup", async () => () => "ok");

    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/data/flight-markup", {
        method: "POST",
        body: "[]",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "X-Server-Function-Format": "8",
          "X-Server-Function-Instance": "server-function:test",
          "X-Single-Flight": "true"
        }
      }),
      {
        collectFlightData: () => ({ "/notes": { pending: Promise.reject(databaseError()) } }),
        transformFlightResult: frameTransformFlightResult
      }
    );

    const body = await response.text();
    for (const secret of SECRETS) expect(body).not.toContain(secret);
    expect(body).toContain("Internal Server Error");
  });
});
