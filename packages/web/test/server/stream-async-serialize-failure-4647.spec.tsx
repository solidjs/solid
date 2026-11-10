/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#4647: a serialized async value whose answer the serializer
 * cannot handle. The key already went into the payload as a pending promise
 * and nothing settled it; the hook heard `render/serialize`, yet the render
 * completed and `onCompleteAll` reported the document whole while the
 * client's read stayed pending forever.
 *
 * Ryan's ruling (2026-11-03): "failing ssr on failed serialization feels
 * reasonable otherwise we could be midstream." So:
 * - before the first flush (an awaited render, or a stream whose shell has
 *   not gone out) the render fails like a rejection there: no HTML, no
 *   `onCompleteAll` (approach from everton-dgn's #4650);
 * - after the first flush (midstream) the key rejects on the client with an
 *   error that says it is a serialization failure and names the key, so the
 *   reading computation throws into the nearest `<Errored>`, and the render
 *   completes (the hydration side is errored-unserializable-hydration-4647).
 * Synchronous serialization failures also fail before the first flush (#4709).
 * A custom serializer's late failure is its own to settle.
 */
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getHydrationWriter, renderToStream, type ServerErrorContext } from "@solidjs/web";
import { createMemo, Loading, onCleanup } from "solid-js";
import { settle, watchEscapes } from "./stream-settle-harness.js";

class Unserializable {}

let heard: string[];
let ran: string[];
const onError = (_: unknown, context: ServerErrorContext) =>
  void heard.push(`${context.kind}/${context.handling}`);

beforeEach(() => {
  heard = [];
  ran = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** The hydration registry the page's scripts build, run as a browser would. */
function registry(html: string) {
  const sandbox: any = {
    document: { getElementById: () => null, addEventListener() {} },
    _$HY: { r: {}, fe() {} }
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const [, src] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    vm.runInContext(src, sandbox);
  }
  const r = sandbox._$HY.r as Record<string, any>;
  for (const k in r) if (r[k] && typeof r[k].then === "function") r[k].then(undefined, () => {});
  // A promise nested in a value: consumed too, the test reads it later.
  for (const k in r) {
    const p = r[k] && (r[k] as any).p;
    if (p && typeof p.then === "function") p.then(undefined, () => {});
  }
  return r;
}

/** What a registry value settles to on the client, or "pending". */
function outcome(value: unknown) {
  return Promise.race([
    Promise.resolve(value).then(
      v => ({ fulfilled: v }),
      e => ({ rejected: e })
    ),
    new Promise(r => setTimeout(() => r("pending"), 50))
  ]);
}

const serializeFailure = (key: string) => ({
  rejected: expect.objectContaining({
    message:
      `Serialization failed: the hydration value for key "${key}" ` +
      "could not be serialized on the server"
  })
});

function App() {
  onCleanup(() => ran.push("cleanup"));
  const value = createMemo(() => Promise.resolve(new Unserializable()));
  return <main>{String(value() instanceof Unserializable)}</main>;
}

/** A page whose boundary value settles once `gate` opens. */
function late(gate: Promise<unknown>, make: () => unknown = () => new Unserializable()) {
  return () => {
    onCleanup(() => ran.push("cleanup"));
    const value = createMemo(() => gate.then(make));
    return (
      <main>
        <Loading fallback="pending">
          <p>{String(value() instanceof Unserializable || value())}</p>
        </Loading>
      </main>
    );
  };
}

/** Pipes `app`; `onFirstChunk` runs once the shell has gone out. */
function pipe(
  app: () => any,
  options: { renderId?: string; onFirstChunk?: () => void } = {}
): Promise<{ state: string; html: string; completed: boolean }> {
  let completed = false;
  const { onFirstChunk, ...rest } = options;
  return settle(
    new Promise<string>(resolve => {
      const chunks: string[] = [];
      renderToStream(app, {
        ...rest,
        onError,
        onCompleteAll() {
          completed = true;
        }
      }).pipe({
        write(chunk: string) {
          chunks.push(String(chunk));
          onFirstChunk && onFirstChunk();
        },
        end() {
          resolve(chunks.join(""));
        }
      });
    })
  ).then(r => ({ ...r, completed }));
}

const dataKeys = (r: Record<string, unknown>) =>
  Object.keys(r).filter(k => !k.endsWith("_fr") && !k.endsWith("_assets"));

describe("renderToStream: an async value that fails to serialize (#4647)", () => {
  test("control: a serializable value fulfils the key and the render completes", async () => {
    let completed = false;
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await settle(
        renderToStream(
          () => {
            const value = createMemo(() => Promise.resolve("loaded"));
            return <main>{value()}</main>;
          },
          {
            onError,
            onCompleteAll() {
              completed = true;
            }
          }
        )
      );
    });
    expect(escaped).toEqual([]);
    expect(result!.state).toBe("settled");
    expect(completed).toBe(true);
    expect(heard).toEqual([]);
    expect(await outcome(registry(result!.html)["0"])).toEqual({ fulfilled: "loaded" });
  });

  describe("before the first flush: the render fails", () => {
    test("the awaited render fails like a rejection: no HTML, no onCompleteAll", async () => {
      let completed = false;
      let result: { state: string; html: string } | undefined;
      const escaped = await watchEscapes(async () => {
        result = await settle(
          renderToStream(App, {
            onError,
            onCompleteAll() {
              completed = true;
            }
          })
        );
      });
      expect(escaped).toEqual([]);
      expect(result!.state).toBe("settled");
      expect(result!.html).toBe("");
      expect(completed).toBe(false);
      expect(heard).toEqual(["render/serialize"]);
      expect(ran).toEqual(["cleanup"]);
    });

    test("a piped render whose shell had not gone out sends nothing", async () => {
      let result: { state: string; html: string; completed: boolean } | undefined;
      const escaped = await watchEscapes(async () => {
        result = await pipe(App);
      });
      expect(escaped).toEqual([]);
      expect(result!.state).toBe("settled");
      expect(result!.html).toBe("");
      expect(result!.completed).toBe(false);
      expect(heard).toEqual(["render/serialize"]);
      expect(ran).toEqual(["cleanup"]);
    });

    test("a boundary value that fails while the shell still waits on a blocker", async () => {
      // The Loading's value fails at once; the shell is held by a root-level
      // async value for a while longer. The failure came first: no shell.
      let result: { state: string; html: string; completed: boolean } | undefined;
      const escaped = await watchEscapes(async () => {
        result = await pipe(() => {
          onCleanup(() => ran.push("cleanup"));
          const slow = createMemo(() => new Promise(r => setTimeout(() => r("slow"), 30)));
          const bad = createMemo(() => Promise.resolve(new Unserializable()));
          return (
            <main>
              <h1>{String(slow())}</h1>
              <Loading fallback="pending">
                <p>{String(bad() instanceof Unserializable)}</p>
              </Loading>
            </main>
          );
        });
      });
      expect(escaped).toEqual([]);
      expect(result!.state).toBe("settled");
      expect(result!.html).toBe("");
      expect(result!.completed).toBe(false);
      expect(heard).toEqual(["render/serialize"]);
      expect(ran).toEqual(["cleanup"]);
    });

    test("without a hook anywhere the failure reaches console.error once", async () => {
      const logged: unknown[][] = [];
      vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
      let result: { state: string; html: string } | undefined;
      const escaped = await watchEscapes(async () => {
        result = await settle(renderToStream(App));
      });
      expect(escaped).toEqual([]);
      expect(result!.state).toBe("settled");
      expect(result!.html).toBe("");
      expect(logged.length).toBe(1);
    });
  });

  describe("after the first flush (midstream): the key rejects on the client", () => {
    async function midstream(options: { renderId?: string } = {}) {
      let release!: () => void;
      const gate = new Promise<void>(r => (release = r));
      let result: { state: string; html: string; completed: boolean } | undefined;
      const escaped = await watchEscapes(async () => {
        result = await pipe(late(gate), { ...options, onFirstChunk: () => release() });
      });
      expect(escaped).toEqual([]);
      expect(result!.state).toBe("settled");
      return result!;
    }

    test("the render completes and the key rejects with a serialization error naming it", async () => {
      const { html, completed } = await midstream();
      expect(html).toContain("pending");
      expect(html).toContain(">true</p>");
      expect(completed).toBe(true);
      expect(heard).toEqual(["render/serialize"]);
      expect(ran).toEqual(["cleanup"]);
      const r = registry(html);
      const keys = dataKeys(r);
      expect(keys.length).toBe(1);
      const settled = await outcome(r[keys[0]]);
      expect(settled).toEqual(serializeFailure(keys[0]));
      // The failure's own text stays on the server (it went to the hook).
      expect(String((settled as any).rejected.message)).not.toContain("Unsupported");
      // Unmarked (no `s`), so the hydrating read takes the rejection after the
      // claim pass and the Errored's fallback replaces the server's content.
      expect((r[keys[0]] as any).s).toBeUndefined();
    });

    test("under a renderId scope", async () => {
      const { html, completed } = await midstream({ renderId: "app-" });
      expect(completed).toBe(true);
      const r = registry(html);
      const keys = dataKeys(r);
      expect(keys.length).toBe(1);
      expect(await outcome(r[keys[0]])).toEqual(serializeFailure(keys[0]));
    });
  });

  describe("after the first flush: what the failed write already sent rejects too", () => {
    // seroval ends a write at its first failure, so whatever the write had
    // already declared on the client stays pending unless the rejection
    // reaches it: a nested promise, a later item of an async iterable, and a
    // second key on the same promise (which read the failed value's unfilled
    // slot and resolved `undefined`). Each settles with the key's error.
    async function writes(make: (opened: Promise<void>) => Record<string, unknown>) {
      let release!: () => void;
      const opened = new Promise<void>(r => (release = r));
      const values = make(opened);
      let result: { state: string; html: string; completed: boolean } | undefined;
      const escaped = await watchEscapes(async () => {
        result = await pipe(
          () => {
            onCleanup(() => ran.push("cleanup"));
            const w = getHydrationWriter()!;
            for (const key in values) w.write(key, values[key]);
            return <main>page</main>;
          },
          { onFirstChunk: () => release() }
        );
      });
      expect(escaped).toEqual([]);
      expect(result!.state).toBe("settled");
      expect(result!.completed).toBe(true);
      return registry(result!.html);
    }
    const after = <T,>(opened: Promise<void>, value: () => T) => opened.then(value);

    test("an async iterable whose later item fails: the items before it arrive, then it throws", async () => {
      const r = await writes(opened => ({
        items: (async function* () {
          yield 1;
          await opened;
          yield new Unserializable();
        })()
      }));
      const it = (r.items as AsyncIterable<unknown>)[Symbol.asyncIterator]();
      // seroval's client iterator answers a buffered item synchronously,
      // and throws a buffered failure synchronously too.
      const next = () => new Promise(resolve => resolve(it.next()));
      expect(await outcome(next())).toEqual({ fulfilled: { done: false, value: 1 } });
      expect(await outcome(next())).toEqual(serializeFailure("items"));
      expect(heard).toEqual(["render/serialize"]);
    });

    test("an object holding a promise: the held promise rejects", async () => {
      const r = await writes(opened => ({
        holder: { p: after(opened, () => new Unserializable()) }
      }));
      expect(await outcome((r.holder as { p: unknown }).p)).toEqual(serializeFailure("holder"));
    });

    test("a promise resolving to an object whose promise fails: the outer fulfils, the inner rejects", async () => {
      const r = await writes(opened => ({
        outer: after(opened, () => ({ inner: after(opened, () => new Unserializable()) }))
      }));
      const outer = (await outcome(r.outer)) as { fulfilled: { inner: unknown } };
      expect(outer.fulfilled).toBeDefined();
      expect(await outcome(outer.fulfilled.inner)).toEqual(serializeFailure("outer"));
    });

    test("two keys on the same failed promise both reject; a sibling key still fulfils", async () => {
      const r = await writes(opened => {
        const shared = after(opened, () => new Unserializable());
        return { first: shared, second: shared, fine: after(opened, () => "ok") };
      });
      expect(await outcome(r.first)).toEqual(serializeFailure("first"));
      expect(await outcome(r.second)).toEqual(serializeFailure("second"));
      expect(await outcome(r.fine)).toEqual({ fulfilled: "ok" });
      // Each key's write fails on its own.
      expect(heard).toEqual(["render/serialize", "render/serialize"]);
    });
  });

  test("a custom serializer's late failure is its own to settle: the render completes", async () => {
    // Reports every promise's answer as a failure, then settles the write.
    const serializer = ({ onError, onDone }: { onError(e: unknown): void; onDone(): void }) => {
      let pending = 0;
      let flushed = false;
      let finished = false;
      const settleWrite = () => {
        if (!flushed || pending || finished) return;
        finished = true;
        onDone();
      };
      return {
        write(_: string, value: any) {
          if (!value || typeof value.then !== "function") return;
          pending++;
          value.then(
            () => {
              onError(new Error("late"));
              pending--;
              settleWrite();
            },
            () => {
              pending--;
              settleWrite();
            }
          );
        },
        flush() {
          flushed = true;
          settleWrite();
        }
      };
    };
    let completed = false;
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await settle(
        renderToStream(App, {
          onError,
          serializer,
          onCompleteAll() {
            completed = true;
          }
        } as any)
      );
    });
    expect(escaped).toEqual([]);
    expect(result!.state).toBe("settled");
    expect(result!.html).toContain("<main");
    expect(completed).toBe(true);
    expect(heard).toEqual(["render/serialize"]);
    expect(ran).toEqual(["cleanup"]);
  });
});
