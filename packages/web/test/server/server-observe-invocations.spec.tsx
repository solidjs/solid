/**
 * `OBSERVE.server.invocations` — the server runtime's observe surface and
 * its first channel: every server-function execution, on both dispatch
 * legs, delivered to any number of listeners once it settles.
 *
 * This is an OBSERVER's seam, next to `wrapInvocation` (the app's single
 * policy hook). The properties that make it one, each pinned here:
 *
 *  - it sees the execution as a whole — the wrapped run, so a policy's time
 *    and a policy's substituted result are what the record describes;
 *  - it sees the error AS THROWN, before the HTTP handler sanitizes it for
 *    the wire — the wire stays sanitized;
 *  - it cannot alter the call: a throwing listener is reported, the result
 *    and every other listener are unaffected;
 *  - it costs nothing with no listener and folds out of the prod artifacts
 *    entirely — the channel is an observe/dev-tier feature.
 *
 * Like the other server-function specs these run against the built bundles.
 * The `@solidjs/web/server-functions/server` alias is the PROD artifact, so
 * the observing runtime is loaded from server-functions/dist/server.observe.js
 * directly (its `solid-js` import resolves to the same `OBSERVE` this file
 * imports — one object, which is the point of the design). Requires a
 * prior `pnpm build`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OBSERVE } from "solid-js";
import { createRequestEvent, type InvocationEvent, type InvocationLive } from "@solidjs/web";
import * as prodRuntime from "@solidjs/web/server-functions/server";

type Runtime = typeof prodRuntime;

const RequestContext = Symbol.for("solid.RequestContext");

let observed: Runtime;
const unsubscribes: Array<() => void> = [];

beforeAll(async () => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
  const entry = new URL("./server-functions/dist/server.observe.js", `file://${process.cwd()}/`)
    .href;
  observed = await import(/* @vite-ignore */ entry);
});

afterEach(() => {
  for (const off of unsubscribes.splice(0)) off();
  // `configure` ignores `undefined` (its spelling of "not overriding") and
  // refuses a non-function (#3238), so undoing the substituting policy
  // between tests means installing a pass-through.
  observed.configureServerFunctionsServer({ wrapInvocation: run => run() });
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const channel = () => OBSERVE!.server.invocations;

function record() {
  const records: Array<{ event: InvocationEvent; live: InvocationLive }> = [];
  unsubscribes.push(
    channel().subscribe("invocation", (event, live) => {
      records.push({ event, live });
    })
  );
  return records;
}

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

/** Runs `fn` under an established request scope, as a render would. */
function underRender<T>(fn: () => T): T {
  const storage = (globalThis as any)[RequestContext] as AsyncLocalStorage<unknown>;
  return storage.run({ request: new Request("https://app.example/page"), locals: {} }, fn);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("the install point", () => {
  it("is populated on OBSERVE.server by the server runtime, once, and shared across bundles", () => {
    expect(OBSERVE).toBeDefined();
    // Source (`@solidjs/web` alias), the prod artifact and the observe
    // artifact have all loaded by now; the channel is one object.
    expect(typeof channel().subscribe).toBe("function");
    // The surface as shipped: the invocation channel and the trace-provider
    // slot (see trace.ts / server-trace.spec.tsx). A new member joins here.
    expect(Object.keys(OBSERVE!.server).sort()).toEqual(["invocations", "trace"]);
  });
});

describe("HTTP dispatch", () => {
  it("delivers one settled record with the live handles beside it", async () => {
    const records = record();
    observed.registerServerFunction("observe-http", async (a: number, b: number) => {
      await sleep(15);
      return a + b;
    });
    const request = post("observe-http", [20, 22]);
    let created!: ReturnType<typeof createRequestEvent>;
    const createEvent = (req: Request) => (created = createRequestEvent(req));

    const response = await observed.handleServerFunctionRequest(request, { createEvent });
    expect(response.status).toBe(200);

    expect(records).toHaveLength(1);
    const { event, live } = records[0];
    expect(event).toMatchObject({ id: "observe-http", direct: false, outcome: "ok" });
    expect(event.deferred).toBeUndefined();
    expect(typeof event.at).toBe("number");
    expect(event.durationMs).toBeGreaterThanOrEqual(14);
    // The record is serializable — no handles on it.
    expect(Object.keys(event).sort()).toEqual(["at", "direct", "durationMs", "id", "outcome"]);
    // The handles ride beside it.
    expect(live.event).toBe(created);
    // the request the handler dispatched (its own derived copy — the same
    // one `wrapInvocation` sees), not necessarily the caller's object
    expect(live.request).toBeInstanceOf(Request);
    expect(live.request!.url).toBe(request.url);
    expect(live.args).toEqual([20, 22]);
    expect(live.result).toBe(42);
    expect(live.error).toBeUndefined();
  });

  it("describes the WRAPPED execution: policy time and a policy's substituted result", async () => {
    const records = record();
    let bodyRan = 0;
    observed.configureServerFunctionsServer({
      wrapInvocation: async run => {
        await sleep(20); // an auth check the request actually waited on
        void run;
        return "substituted";
      }
    });
    observed.registerServerFunction("observe-wrapped", async () => {
      bodyRan++;
      return "from the function";
    });

    await observed.handleServerFunctionRequest(post("observe-wrapped", []), {
      createEvent: createRequestEvent
    });

    expect(bodyRan).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0].event.outcome).toBe("ok");
    expect(records[0].event.durationMs).toBeGreaterThanOrEqual(19);
    expect(records[0].live.result).toBe("substituted");
  });

  it("hands the listener the error as thrown while the wire stays sanitized", async () => {
    const records = record();
    // A driver error as one arrives: the detail must reach the observer and
    // must not reach the wire.
    const detail = "internal-host-detail-" + Math.random().toString(36).slice(2);
    const thrown = Object.assign(new Error(`connect refused at ${detail}`), { detail });
    observed.registerServerFunction("observe-throws", async () => {
      throw thrown;
    });

    const response = await observed.handleServerFunctionRequest(post("observe-throws", []), {
      createEvent: createRequestEvent
    });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(detail);

    expect(records).toHaveLength(1);
    const { event, live } = records[0];
    expect(event).toMatchObject({ id: "observe-throws", direct: false, outcome: "error" });
    expect(live.error).toBe(thrown);
    expect(live.result).toBeUndefined();
  });

  it("flags a body the caller drives as deferred, timed to handoff", async () => {
    const records = record();
    observed.registerServerFunction("observe-stream", async function* () {
      yield 1;
      await sleep(30);
      yield 2;
    });

    const response = await observed.handleServerFunctionRequest(post("observe-stream", []), {
      createEvent: createRequestEvent
    });
    // Drain the body so consumption is fully behind us before asserting the
    // record was timed to the handoff, not to this.
    await response.text();

    expect(records).toHaveLength(1);
    expect(records[0].event.deferred).toBe(true);
    expect(records[0].event.outcome).toBe("ok");
    expect(records[0].event.durationMs).toBeLessThan(30);
  });
});

describe("direct SSR calls", () => {
  it("delivers one record for an in-process call, synchronously, without turning it async", () => {
    const records = record();
    let bodyRan = 0;
    const call = observed.createServerReference(
      observed.registerServerReference("observe-direct", (n: number) => {
        bodyRan++;
        return n * 2;
      })
    );

    const result = underRender(() => (call as any)(21));

    // transparency: a sync function keeps its value
    expect(result).toBe(42);
    expect(bodyRan).toBe(1);
    // and the record was already delivered when the call returned
    expect(records).toHaveLength(1);
    const { event, live } = records[0];
    expect(event).toMatchObject({ id: "observe-direct", direct: true, outcome: "ok" });
    expect(live.request).toBeUndefined();
    expect(live.args).toEqual([21]);
    expect(live.result).toBe(42);
    // the per-call derived event, not the render's
    expect((live.event as any).serverOnly).toBe(true);
  });

  it("settles an async direct call at resolution, and reports a rejection as thrown", async () => {
    const records = record();
    const boom = new Error("direct failure");
    const ok = observed.createServerReference(
      observed.registerServerReference("observe-direct-async", async () => {
        await sleep(10);
        return "later";
      })
    );
    const bad = observed.createServerReference(
      observed.registerServerReference("observe-direct-throws", async () => {
        throw boom;
      })
    );

    await expect(underRender(() => (ok as any)())).resolves.toBe("later");
    await expect(underRender(() => (bad as any)())).rejects.toBe(boom);

    expect(records.map(r => [r.event.id, r.event.outcome])).toEqual([
      ["observe-direct-async", "ok"],
      ["observe-direct-throws", "error"]
    ]);
    expect(records[0].event.durationMs).toBeGreaterThanOrEqual(9);
    expect(records[1].live.error).toBe(boom);
  });
});

describe("an observer, not a policy", () => {
  it("unsubscribing stops delivery", async () => {
    const seen: string[] = [];
    const off = channel().subscribe("invocation", event => {
      seen.push(event.id);
    });
    observed.registerServerFunction("observe-off", async () => "ok");

    await observed.handleServerFunctionRequest(post("observe-off", []), {
      createEvent: createRequestEvent
    });
    off();
    await observed.handleServerFunctionRequest(post("observe-off", []), {
      createEvent: createRequestEvent
    });

    expect(seen).toEqual(["observe-off"]);
  });

  it("a throwing listener is reported; the call and the other listeners are unaffected", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const seen: string[] = [];
      unsubscribes.push(
        channel().subscribe("invocation", () => {
          throw new Error("listener bug");
        })
      );
      unsubscribes.push(
        channel().subscribe("invocation", event => {
          seen.push(event.id);
        })
      );
      observed.registerServerFunction("observe-resilient", async () => "still ok");

      const response = await observed.handleServerFunctionRequest(post("observe-resilient", []), {
        createEvent: createRequestEvent
      });

      expect(response.status).toBe(200);
      expect(seen).toEqual(["observe-resilient"]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect((errorSpy.mock.calls[0][0] as Error).message).toBe("listener bug");
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("tiers", () => {
  it("the production runtime never reports, even with a listener installed", async () => {
    const records = record();
    prodRuntime.registerServerFunction("observe-prod", async () => "ok");

    const response = await prodRuntime.handleServerFunctionRequest(post("observe-prod", []), {
      createEvent: createRequestEvent
    });

    expect(response.status).toBe(200);
    expect(records).toHaveLength(0);
  });

  it("the channel folds out of every prod server artifact and rides every observe/dev one", () => {
    // The listener set hangs off a registered symbol; its name is the one
    // string that survives minification and marks the module's presence.
    const marker = "@solidjs/web/observe/invocations";
    const has = (file: string) => readFileSync(file, "utf8").includes(marker);
    for (const entry of ["dist", "server-functions/dist", "frames/dist"]) {
      expect(has(`${entry}/server.js`), `${entry}/server.js`).toBe(false);
      expect(has(`${entry}/server.observe.js`), `${entry}/server.observe.js`).toBe(true);
      expect(has(`${entry}/server.dev.js`), `${entry}/server.dev.js`).toBe(true);
    }
  });
});
