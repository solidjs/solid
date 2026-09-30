/**
 * @jsxImportSource @solidjs/web
 *
 * The keyed server-to-client channel (`getHydrationWriter` /
 * `takeHydrationValue`) and the positional `isHydratable()` — what data
 * libraries (Solid Router's `query()`, TanStack Solid Query / Router) use
 * instead of `sharedConfig`.
 */
import vm from "node:vm";
import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, describe, expect, test } from "vitest";
import { renderToStream, renderToString, getHydrationWriter, Loading } from "@solidjs/web";
import {
  createMemo,
  getOwner,
  isHydratable,
  isHydrating,
  Hydration,
  NoHydration,
  runWithOwner
} from "solid-js";
import { takeHydrationValue as clientTake } from "../../src/client.js";

const RequestContext = Symbol.for("solid.RequestContext");
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const stream = (code: () => any, options?: any) =>
  new Promise<string>(resolve => renderToStream(code, options).then(resolve));
// The response as the client receives it, chunk by chunk.
const chunks = (code: () => any) =>
  new Promise<string[]>(resolve => {
    const out: string[] = [];
    renderToStream(code).pipe({
      write: (c: string) => out.push(c),
      end: () => resolve(out)
    } as any);
  });
const eventFor = (name: string) =>
  ({ request: new Request(`https://app.example/${name}`), locals: { name } }) as any;

// Runs a payload's scripts the way a browser would; `upTo` runs only the
// first N script blocks (a stream the client has only partly received).
function registry(html: string, upTo = Infinity) {
  const sandbox: any = { document: { getElementById: () => null }, _$HY: { r: {}, fe() {} } };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  for (const src of scripts.slice(0, upTo)) vm.runInContext(src, sandbox);
  return { r: sandbox._$HY.r as Record<string, any>, hy: sandbox._$HY, context: sandbox };
}
const keysOf = (html: string) => Object.keys(registry(html).r).filter(k => k.startsWith("lib:"));
// The client read, against a page's registry.
function take(hy: any, key: string) {
  const prev = (globalThis as any)._$HY;
  (globalThis as any)._$HY = hy;
  try {
    return clientTake(key);
  } finally {
    (globalThis as any)._$HY = prev;
  }
}

afterEach(() => {
  delete (globalThis as any)[RequestContext];
});

describe("isHydratable() (server)", () => {
  test("positional: render root, <NoHydration>, <Hydration> island, outside a render, continuations", async () => {
    const seen: Record<string, boolean> = {};
    let owner: any;
    let continuation!: Promise<void>;
    seen.outsideRender = isHydratable();
    function Probe(props: { name: string }) {
      seen[props.name] = isHydratable();
      return null;
    }
    renderToString(() => {
      owner = getOwner();
      continuation = Promise.resolve().then(() => {
        seen.continuation = isHydratable();
      });
      return (
        <div>
          <Probe name="root" />
          <NoHydration>
            <Probe name="noHydration" />
            <Hydration id="island">
              <Probe name="island" />
            </Hydration>
          </NoHydration>
        </div>
      );
    });
    await continuation;
    // The render's root is released with its dispose: a captured owner no
    // longer belongs to a render.
    seen.afterRender = runWithOwner(owner, isHydratable)!;
    expect(seen).toEqual({
      outsideRender: false,
      root: true,
      noHydration: false,
      island: true,
      continuation: false,
      afterRender: false
    });
  });

  test("isHydrating() is false on the server", () => {
    let seen: boolean | undefined;
    renderToString(() => ((seen = isHydrating()), null));
    expect(seen).toBe(false);
  });
});

describe("getHydrationWriter() — renderToString", () => {
  test("writes sync values, first write wins, async values throw, closed after the render", () => {
    let writer: any;
    const results: unknown[] = [];
    const html = renderToString(() => {
      writer = getHydrationWriter();
      results.push(writer.async);
      results.push(writer.write("lib:a", { n: 1 }));
      results.push(writer.write("lib:a", { n: 2 }));
      try {
        writer.write("lib:p", Promise.resolve(1));
      } catch (e) {
        results.push((e as Error).message.includes("renderToString"));
      }
      results.push(writer.write("lib:p", 3)); // the throw did not mark the key
      return <p>x</p>;
    });
    expect(results).toEqual([false, true, false, true, true]);
    const { r, hy } = registry(html);
    expect(r["lib:a"]).toEqual({ n: 1 });
    expect(take(hy, "lib:a")).toEqual({ status: "resolved", value: { n: 1 } });
    // Take-and-delete.
    expect(take(hy, "lib:a")).toBeUndefined();
    expect("lib:a" in hy.r).toBe(false);
    // The render is over: a late write (IO after the response) is dropped.
    expect(writer.write("lib:late", 1)).toBe(false);
  });

  test("undefined outside any render", () => {
    expect(getHydrationWriter()).toBeUndefined();
  });

  test("an explicit write under <NoHydration> writes (the library decides)", () => {
    const html = renderToString(() => (
      <NoHydration>
        {(() => {
          getHydrationWriter()!.write("lib:explicit", 1);
          return <p />;
        })()}
      </NoHydration>
    ));
    expect(keysOf(html)).toEqual(["lib:explicit"]);
  });
});

describe("getHydrationWriter() — renderToStream", () => {
  test("promise values stream; pending, then resolved; rejected values arrive rejected", async () => {
    let async: boolean | undefined;
    function Writer() {
      const w = getHydrationWriter()!;
      async = w.async;
      w.write(
        "lib:late",
        delay(10).then(() => ({ v: "late" }))
      );
      w.write(
        "lib:fails",
        delay(10).then(() => {
          throw new Error("nope");
        })
      );
      const hold = createMemo(async () => (await delay(20), "done"));
      return (
        <Loading fallback="...">
          <b>{hold()}</b>
        </Loading>
      );
    }
    const received = await chunks(() => <Writer />);
    const html = received.join("");
    expect(async).toBe(true);

    // The shell only: the promise is registered, not yet settled.
    const partial = registry(received[0]);
    const pending = take(partial.hy, "lib:late");
    expect(pending?.status).toBe("pending");
    const pendingFailure = take(partial.hy, "lib:fails") as any;
    expect(pendingFailure.status).toBe("pending");
    pendingFailure.promise.catch(() => {});
    for (const chunk of received.slice(1))
      for (const [, src] of chunk.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))
        vm.runInContext(src, partial.context);
    await expect((pending as any).promise).resolves.toEqual({ v: "late" });

    // The whole page: settled stamps are unwrapped.
    const whole = registry(html);
    expect(take(whole.hy, "lib:late")).toEqual({ status: "resolved", value: { v: "late" } });
    const failed = take(whole.hy, "lib:fails") as any;
    expect(failed.status).toBe("rejected");
    expect(failed.error.message).toBe("nope");
  });
});

// A router-`query()`-shaped library: one per-request cache, keyed reads.
function createLibrary() {
  const cache = new Map<string, unknown>();
  return {
    // The proposed shape: write on every hydratable read; the writer dedupes.
    read(key: string, fetch: () => unknown) {
      if (!cache.has(key)) cache.set(key, fetch());
      const value = cache.get(key);
      if (isHydratable()) getHydrationWriter()?.write(key, value);
      return value;
    },
    // Today's shape (serialize on cache miss only) with the positional guard.
    readOnMiss(key: string, fetch: () => unknown) {
      if (cache.has(key)) return cache.get(key);
      const value = fetch();
      cache.set(key, value);
      if (isHydratable()) getHydrationWriter()?.write(key, value);
      return value;
    }
  };
}

describe("<NoHydration> zone and a nested island reading the same key", () => {
  function Page(props: { read: (key: string) => unknown; islandFirst?: boolean }) {
    const Read = (p: { where: string }) => (
      <i data-where={p.where}>{String(props.read("lib:user"))}</i>
    );
    const Island = () => (
      <Hydration id="isl">
        <Read where="island" />
      </Hydration>
    );
    return (
      <NoHydration>
        {props.islandFirst && <Island />}
        <Read where="static" />
        {!props.islandFirst && <Island />}
      </NoHydration>
    );
  }

  test("static read first: the island's read still ships the key, once", () => {
    const lib = createLibrary();
    let fetches = 0;
    const html = renderToString(() => <Page read={k => lib.read(k, () => `u${++fetches}`)} />);
    expect(fetches).toBe(1);
    expect(keysOf(html)).toEqual(["lib:user"]);
    expect(registry(html).r["lib:user"]).toBe("u1");
  });

  test("island read first: shipped once, the static read adds nothing", () => {
    const lib = createLibrary();
    const html = renderToString(() => <Page islandFirst read={k => lib.read(k, () => "u")} />);
    expect(keysOf(html)).toEqual(["lib:user"]);
  });

  test("why: serializing on cache miss only lets the skipped static read mark the key handled", () => {
    const lib = createLibrary();
    const html = renderToString(() => <Page read={k => lib.readOnMiss(k, () => "u")} />);
    expect(keysOf(html)).toEqual([]);
  });

  test("streaming, promise value: one record, streamed to the island", async () => {
    const lib = createLibrary();
    const html = await stream(() => (
      <Page read={k => lib.read(k, () => delay(5).then(() => "late-user"))} />
    ));
    expect(keysOf(html)).toEqual(["lib:user"]);
    expect(take(registry(html).hy, "lib:user")).toEqual({ status: "resolved", value: "late-user" });
  });
});

describe("concurrent requests", () => {
  // Each request: a provider that captures the writer at setup and writes
  // from IO later, an owner-less write after an `await` (resolved through
  // the request store), and a slow boundary holding its stream open.
  function request(als: { run: (e: any, fn: () => any) => any }, name: string, holdMs: number) {
    const event = eventFor(name);
    const late: Record<string, unknown> = {};
    const done = als.run(event, () =>
      stream(() => {
        function Provider() {
          const captured = getHydrationWriter()!;
          delay(holdMs).then(() => (late.captured = captured.write(`lib:${name}:captured`, name)));
          (async () => {
            await delay(holdMs);
            const ambient = getHydrationWriter();
            late.ambient = ambient ? ambient.write(`lib:${name}:ambient`, name) : "no-render";
          })();
          const slow = createMemo(async () => (await delay(holdMs * 3), name));
          return (
            <Loading fallback="...">
              <b>{slow()}</b>
            </Loading>
          );
        }
        return <Provider />;
      })
    );
    return { done, late };
  }

  test("interleaved streams + a finished renderToString: every write lands in its own render", async () => {
    const als = new AsyncLocalStorage();
    (globalThis as any)[RequestContext] = als;
    const a = request(als, "A", 10);
    const b = request(als, "B", 15);
    // A sync render that starts and finishes while both streams are in flight
    // (it is the module-global context from here on).
    let stringWriter: any;
    const c = als.run(eventFor("C"), () =>
      renderToString(() => {
        stringWriter = getHydrationWriter();
        stringWriter.write("lib:C:sync", "C");
        return <p />;
      })
    );
    const [htmlA, htmlB] = await Promise.all([a.done, b.done]);
    expect(keysOf(htmlA).sort()).toEqual(["lib:A:ambient", "lib:A:captured"]);
    expect(keysOf(htmlB).sort()).toEqual(["lib:B:ambient", "lib:B:captured"]);
    expect(keysOf(c)).toEqual(["lib:C:sync"]);
    expect(a.late).toEqual({ captured: true, ambient: true });
    expect(b.late).toEqual({ captured: true, ambient: true });
    expect(stringWriter.write("lib:C:late", 1)).toBe(false);
  });

  test("a sync-only store after `await`: the owner-less write finds no render, never another's", async () => {
    let current: unknown;
    const syncOnly = {
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
    (globalThis as any)[RequestContext] = syncOnly;
    const a = request(syncOnly, "A", 10);
    const b = request(syncOnly, "B", 12);
    const [htmlA, htmlB] = await Promise.all([a.done, b.done]);
    expect(keysOf(htmlA)).toEqual(["lib:A:captured"]);
    expect(keysOf(htmlB)).toEqual(["lib:B:captured"]);
    expect(a.late.ambient).toBe("no-render");
    expect(b.late.ambient).toBe("no-render");
  });
});
