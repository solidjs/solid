/**
 * @jsxImportSource @solidjs/web
 *
 * `getRequestEvent()` × concurrent requests when the request store comes
 * back empty. The module-global `sharedConfig.context` is whichever render
 * started (or finished) last, so an event read off it can belong to another
 * request. A read the store cannot answer resolves through the calling
 * owner's render, or not at all.
 *
 * The render writes its event onto its own context the way Solid Start's
 * handler does (`sharedConfig.context.event = event` inside the render fn).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderToStream, renderToString, getRequestEvent, Loading } from "@solidjs/web";
import { createMemo, createRoot, getOwner } from "solid-js";
import { sharedConfig } from "solid-js/internal";
import { createServerReference } from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function eventFor(name: string) {
  return { request: new Request(`https://app.example/${name}`), locals: { name } } as any;
}

const nameOf = (event: any) => (event ? event.locals.name : "none");

// A store that only covers the synchronous extent of `run()` — the shape of
// sync-only `async_hooks` polyfills. Every promise continuation reads empty.
function syncOnlyStore() {
  let current: unknown;
  return {
    run<T>(value: unknown, fn: () => T): T {
      const prev = current;
      current = value;
      try {
        return fn();
      } finally {
        current = prev;
      }
    },
    getStore: () => current
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  delete (globalThis as any)[RequestContext];
});

describe("getRequestEvent with a sync-only request store", () => {
  type Reads = Record<string, string[]>;
  const record = (reads: Reads, key: string) => (reads[key] ||= []).push(nameOf(getRequestEvent()));

  function request(store: ReturnType<typeof syncOnlyStore>, name: string, holdMs: number) {
    const event = eventFor(name);
    const reads: Reads = {};
    const html = store.run(
      event,
      () =>
        new Promise<string>(resolve => {
          renderToStream(() => {
            (sharedConfig.context as any).event = event;
            function Late() {
              const data = createMemo(async () => {
                await delay(holdMs);
                record(reads, "after-await");
                return name;
              });
              const value = data();
              record(reads, "component-body");
              return <b>{value}</b>;
            }
            return (
              <Loading fallback={<i>...</i>}>
                <Late />
              </Loading>
            );
          }).then(resolve);
        })
    );
    return { html, reads };
  }

  async function interleaved() {
    const store = syncOnlyStore();
    (globalThis as any)[RequestContext] = store;
    const a = request(store, "A", 15);
    // B starts while A is suspended, and A's retry pass then leaves A's
    // context as the global while B is suspended.
    await delay(5);
    const b = request(store, "B", 30);
    expect(await a.html).toMatch(/<b[^>]*>A<\/b>/);
    expect(await b.html).toMatch(/<b[^>]*>B<\/b>/);
    return { a: a.reads, b: b.reads };
  }

  test("a read in async user code after an await never sees the other request's event", async () => {
    const { a, b } = await interleaved();
    // No owner and no store: nothing attributes the read to a request.
    expect(new Set(a["after-await"])).toEqual(new Set(["none"]));
    expect(new Set(b["after-await"])).toEqual(new Set(["none"]));
  });

  test("a runtime-driven render pass resolves its own render's event", async () => {
    const { a, b } = await interleaved();
    // The first pass throws at `data()`; the recorded read is the retry pass,
    // run from a promise continuation the store does not cover.
    expect(a["component-body"]).toEqual(["A"]);
    expect(b["component-body"]).toEqual(["B"]);
  });
});

describe("direct server-function calls with a sync-only request store", () => {
  // The server-functions entry carries its own copy of `getRequestEvent`:
  // the call reads the render's event there, not in the copy that rendered.
  const whoAmI = createServerReference({
    id: "request-event-concurrent-who",
    fn: () => nameOf(getRequestEvent())
  } as any) as () => string;

  function call() {
    try {
      return whoAmI();
    } catch {
      return "threw";
    }
  }

  function request(store: ReturnType<typeof syncOnlyStore>, name: string, holdMs: number) {
    const event = eventFor(name);
    const calls: Record<string, string[]> = {};
    const html = store.run(
      event,
      () =>
        new Promise<string>(resolve => {
          renderToStream(() => {
            (sharedConfig.context as any).event = event;
            function Late() {
              const data = createMemo(async () => {
                await delay(holdMs);
                (calls["after-await"] ||= []).push(call());
                return name;
              });
              const value = data();
              (calls["component-body"] ||= []).push(call());
              return <b>{value}</b>;
            }
            return (
              <Loading fallback={<i>...</i>}>
                <Late />
              </Loading>
            );
          }).then(resolve);
        })
    );
    return { html, calls };
  }

  test("run under the calling render's event, or refuse — never the other request's", async () => {
    const store = syncOnlyStore();
    (globalThis as any)[RequestContext] = store;
    const a = request(store, "A", 15);
    await delay(5);
    const b = request(store, "B", 30);
    await Promise.all([a.html, b.html]);
    expect(a.calls["component-body"]).toEqual(["A"]);
    expect(b.calls["component-body"]).toEqual(["B"]);
    expect(new Set(a.calls["after-await"])).toEqual(new Set(["threw"]));
    expect(new Set(b.calls["after-await"])).toEqual(new Set(["threw"]));
  });
});

describe("getRequestEvent read outside the request store's scope", () => {
  test("does not answer with the render that last left the global context", async () => {
    const als = new AsyncLocalStorage<any>();
    (globalThis as any)[RequestContext] = als;
    const eventA = eventFor("A");
    const eventB = eventFor("B");
    let outside: string | undefined;
    const streamed = als.run(
      eventA,
      () =>
        new Promise<string>(resolve => {
          renderToStream(() => {
            (sharedConfig.context as any).event = eventA;
            const data = createMemo(async () => {
              await delay(10);
              // A callback the store does not follow (an emitter registered
              // outside the request, a pooled client's queue).
              outside = als.exit(() => nameOf(getRequestEvent()));
              return "A";
            });
            return (
              <Loading fallback={<i>...</i>}>
                <b>{data()}</b>
              </Loading>
            );
          }).then(resolve);
        })
    );
    als.run(eventB, () =>
      renderToString(() => {
        (sharedConfig.context as any).event = eventB;
        return <p>B</p>;
      })
    );
    expect(await streamed).toMatch(/<b[^>]*>A<\/b>/);
    expect(outside).toBe("none");
  });

  test("still resolves a component's own render when the store is exited synchronously", () => {
    const als = new AsyncLocalStorage<any>();
    (globalThis as any)[RequestContext] = als;
    const eventA = eventFor("A");
    let inside: string | undefined;
    als.run(eventA, () =>
      renderToString(() => {
        (sharedConfig.context as any).event = eventA;
        function Reader() {
          inside = als.exit(() => nameOf(getRequestEvent()));
          return <p />;
        }
        return <Reader />;
      })
    );
    expect(inside).toBe("A");
  });

  test("a finished render's pooled root owner does not answer for it when reissued", () => {
    const als = new AsyncLocalStorage<any>();
    (globalThis as any)[RequestContext] = als;
    const eventA = eventFor("A");
    let rootA: unknown;
    als.run(eventA, () =>
      renderToString(() => {
        (sharedConfig.context as any).event = eventA;
        rootA = getOwner();
        return <p />;
      })
    );
    let read: string | undefined;
    createRoot(dispose => {
      expect(getOwner()).toBe(rootA);
      read = als.exit(() => nameOf(getRequestEvent()));
      dispose();
    });
    expect(read).toBe("none");
  });

  test("a finished render's event is not attributed to a later owner-less read", () => {
    const als = new AsyncLocalStorage<any>();
    (globalThis as any)[RequestContext] = als;
    const eventA = eventFor("A");
    als.run(eventA, () =>
      renderToString(() => {
        (sharedConfig.context as any).event = eventA;
        return <p />;
      })
    );
    expect(nameOf(getRequestEvent())).toBe("none");
  });
});
