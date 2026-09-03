import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestEvent, getRequestEvent } from "@solidjs/web";
import {
  configureServerFunctionsServer,
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
  configureServerFunctionsServer({ wrapInvocation: run => run() });
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

describe("server-function request-event scope (#3222)", () => {
  it("runs an HTTP-dispatched generator under the dispatch event", async () => {
    const seen: string[] = [];
    registerServerFunction("event-scope-http-generator", async function* () {
      seen.push(getRequestEvent()?.request.headers.get("X-Tenant") || "NO-EVENT");
      yield "ok";
      seen.push(getRequestEvent()?.request.headers.get("X-Tenant") || "NO-EVENT");
    });
    registerServerFunction("event-scope-http-sync-generator", function* () {
      seen.push(getRequestEvent()?.request.headers.get("X-Tenant") || "NO-EVENT");
      yield "ok";
    });

    await requestContext.run(eventFor("AMBIENT"), async () => {
      const response = await handleServerFunctionRequest(post("event-scope-http-generator"), {
        createEvent: () => eventFor("REQUEST")
      });
      await response.text();
      const syncResponse = await handleServerFunctionRequest(
        post("event-scope-http-sync-generator"),
        { createEvent: () => eventFor("REQUEST") }
      );
      await syncResponse.text();
    });

    expect(seen).toEqual(["REQUEST", "REQUEST", "REQUEST"]);
  });

  it("isolates concurrent direct generator calls from the render event", async () => {
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    const reference = createServerReference({
      id: "event-scope-direct-generator",
      name: "eventScopeDirectGenerator",
      fn: async function* (who: string) {
        getRequestEvent()!.locals.writer = who;
        await delay(who === "A" ? 30 : 5);
        yield `${who}:${getRequestEvent()!.locals.writer}`;
      }
    } as any) as (who: string) => AsyncIterable<string>;
    const render = eventFor("RENDER");
    render.locals.writer = "none";

    const values = await requestContext.run(render, () =>
      Promise.all([drain(reference("A")), drain(reference("B"))])
    );

    expect(values).toEqual([["A:A"], ["B:B"]]);
    expect(render.locals.writer).toBe("none");
  });

  it("scopes deferred stream pulls and result getters during HTTP encoding", async () => {
    const seen: string[] = [];
    registerServerFunction("event-scope-stream", () => ({
      get tenant() {
        seen.push(`getter:${getRequestEvent()?.request.headers.get("X-Tenant") || "NO-EVENT"}`);
        return "ok";
      },
      stream: new ReadableStream(
        {
          pull(controller) {
            seen.push(`pull:${getRequestEvent()?.request.headers.get("X-Tenant") || "NO-EVENT"}`);
            controller.enqueue("chunk");
            controller.close();
          }
        },
        { highWaterMark: 0 }
      )
    }));

    await requestContext.run(eventFor("AMBIENT"), async () => {
      const response = await handleServerFunctionRequest(post("event-scope-stream"), {
        createEvent: () => eventFor("REQUEST")
      });
      await response.text();
    });

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.every(entry => entry.endsWith(":REQUEST"))).toBe(true);
  });

  it("keeps direct sync generators synchronous and scopes direct stream pulls", async () => {
    const generator = createServerReference({
      id: "event-scope-sync-generator",
      fn: function* () {
        yield (getRequestEvent() as any)?.serverOnly;
      }
    } as any) as () => Iterable<boolean>;
    const stream = createServerReference({
      id: "event-scope-direct-stream",
      fn: () => {
        const event = getRequestEvent();
        return new ReadableStream(
          {
            pull(controller) {
              controller.enqueue(getRequestEvent() === event);
              controller.close();
            }
          },
          { highWaterMark: 0 }
        );
      }
    } as any) as () => ReadableStream<boolean>;

    await requestContext.run(eventFor("RENDER"), async () => {
      expect([...generator()]).toEqual([true]);
      const reader = stream().getReader();
      expect(await reader.read()).toEqual({ done: false, value: true });
    });
  });

  it("keeps deferred wrapInvocation and synchronous direct results intact", async () => {
    const scoped: boolean[] = [];
    configureServerFunctionsServer({
      wrapInvocation(run, context) {
        if (context.id === "event-scope-wrapped-generator") {
          return (async function* () {
            scoped.push(getRequestEvent() === context.event);
            for await (const value of run() as AsyncIterable<string>) yield value;
          })();
        }
        return run();
      }
    });
    try {
      const wrapped = createServerReference({
        id: "event-scope-wrapped-generator",
        fn: async function* () {
          scoped.push((getRequestEvent() as any)?.serverOnly === true);
          yield "wrapped";
        }
      } as any) as () => AsyncIterable<string>;
      const marker: unknown[] = [];
      const synchronous = createServerReference({
        id: "event-scope-synchronous",
        fn: () => marker
      } as any) as () => object;

      await requestContext.run(eventFor("RENDER"), async () => {
        expect(synchronous()).toBe(marker);
        expect(await drain(wrapped())).toEqual(["wrapped"]);
      });
      expect(scoped).toEqual([true, true]);
    } finally {
      configureServerFunctionsServer({ wrapInvocation: run => run() });
    }
  });
});
