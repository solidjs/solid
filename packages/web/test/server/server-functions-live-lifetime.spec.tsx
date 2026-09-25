/**
 * `live` = response lifetime (Stage 8, slice A2; RFC 10 `live(fn)` → The
 * extension: Lifetime). A live connection is alive while its RESPONSE is:
 * an answer that is an object holding promises or async iterables keeps
 * the connection open until every one of them has settled. The body ending
 * with deferreds still open is a death (reconnect, re-yield the whole
 * answer, fresh); ending with none open is a completion (the iteration
 * completes). Nothing is added to the wire: the decoder counts what the
 * codec's own close records leave open. Undeclared answers keep today's
 * behavior — a death fails what it left open.
 *
 * Like the other server-function specs, these run against the built
 * bundles (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createServerReference as createServerSideReference,
  handleServerFunctionRequest,
  live as liveServer,
  configureServerFunctionsServer,
  setServerFunctionsDev,
  registerServerFunction,
  registerServerReference
} from "@solidjs/web/server-functions/server";
import {
  createServerReference,
  invoke,
  live,
  positionDigest
} from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");
const LIVE_SOURCE = Symbol.for("solid.LiveSource");
const LIVE_RESUME_FROM = Symbol.for("solid.LiveResumeFrom");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const restores: (() => void)[] = [];
afterEach(() => {
  while (restores.length) restores.pop()!();
});

/**
 * Every request the client transport sends, dispatched into the handler.
 * `cut(request, connection)` names a marker for that connection's body: the
 * body is severed right after the first chunk carrying it — the network
 * dropping mid-response, as opposed to the source throwing (which the codec
 * encodes as a record).
 */
function connectTransport(cut?: (request: Request, connection: number) => string | undefined) {
  const original = globalThis.fetch;
  const requests: Request[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request =
      input instanceof Request
        ? input
        : new Request(new URL(input.toString(), "http://localhost"), init);
    request.headers.set("Sec-Fetch-Site", "same-origin");
    requests.push(request);
    const marker = cut && cut(request, requests.length);
    const signal = init?.signal;
    return new Promise<Response>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      handleServerFunctionRequest(request).then(response => {
        if (marker === undefined || !response.body) return resolve(response);
        const decoder = new TextDecoder();
        let severed = false;
        const body = response.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              if (severed) return;
              controller.enqueue(chunk);
              if (decoder.decode(chunk, { stream: true }).includes(marker)) {
                severed = true;
                controller.terminate();
              }
            }
          })
        );
        resolve(new Response(body, { status: response.status, headers: response.headers }));
      }, reject);
    });
  }) as typeof fetch;
  restores.push(() => {
    globalThis.fetch = original;
  });
  return requests;
}

async function take<T>(iterable: AsyncIterable<T>, count: number) {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
    if (values.length === count) break;
  }
  return values;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

/** Whether a promise has settled by the time the microtasks drain. */
async function settled(promise: Promise<unknown>) {
  const pending = Symbol();
  const outcome = await Promise.race([
    promise.then(
      () => "resolved",
      () => "rejected"
    ),
    new Promise(r => setTimeout(() => r(pending), 20))
  ]);
  return outcome === pending ? "pending" : outcome;
}

describe("a nested-async answer lives as long as its response", () => {
  it("yields the answer once and completes when every nested source has", async () => {
    let releaseProgress!: () => void;
    registerServerFunction("ll-complete-0", async () => ({
      meta: "job",
      progress: (async function* () {
        yield 1;
        yield 2;
        await new Promise<void>(r => (releaseProgress = r));
        yield 3;
      })()
    }));
    connectTransport();
    const source = live(createServerReference("ll-complete-0"));
    const iterable = (source as any)();
    const states: string[] = [];
    iterable.onstatus = (state: string) => states.push(state);
    const it = iterable[Symbol.asyncIterator]();
    const first = await it.next();
    expect(first.done).toBe(false);
    expect(first.value.meta).toBe("job");
    // the top-level iterable is done — the answer was one object — but the
    // response is not: the second pull waits on the nested stream
    const second = it.next();
    const progress = first.value.progress[Symbol.asyncIterator]();
    expect((await progress.next()).value).toBe(1);
    expect((await progress.next()).value).toBe(2);
    expect(await settled(second)).toBe("pending");
    expect(states).toEqual(["connected"]);
    releaseProgress();
    expect((await progress.next()).value).toBe(3);
    expect((await progress.next()).done).toBe(true);
    // every deferred settled: completion, not death — no reconnect
    expect(await second).toEqual({ done: true, value: undefined });
    expect(states).toEqual(["connected", "closed"]);
  });

  it("a nested promise holds the response open too", async () => {
    let releaseTotal!: (n: number) => void;
    registerServerFunction("ll-promise-0", async () => ({
      total: new Promise<number>(r => (releaseTotal = r))
    }));
    connectTransport();
    const source = live(createServerReference("ll-promise-0"));
    const it = (source as any)()[Symbol.asyncIterator]();
    const first = await it.next();
    const second = it.next();
    expect(await settled(second)).toBe("pending");
    releaseTotal(42);
    expect(await first.value.total).toBe(42);
    expect((await second).done).toBe(true);
  });

  it("the consumer ending the iteration completes what is nested — no error reaches a nested reader", async () => {
    // A memo re-invoking with new arguments calls return() on the old
    // iterable while a child memo is still reading a nested stream out of
    // its answer. The body is severed on purpose: the child must see its
    // stream FINISH, not fail with our own controller's AbortError (which
    // reaches it as an uncaught error and halts the page). A nested promise
    // still owed stays pending — nothing honest to settle it with; its
    // reader is superseded by the next answer.
    registerServerFunction("ll-return-0", async () => ({
      total: new Promise<number>(() => {}),
      progress: (async function* () {
        yield 1;
        await new Promise(() => {}); // still streaming when the consumer leaves
      })()
    }));
    connectTransport();
    const source = live(createServerReference("ll-return-0"));
    const iterable = (source as any)();
    const states: string[] = [];
    iterable.onstatus = (state: string) => states.push(state);
    const it = iterable[Symbol.asyncIterator]();
    const first = await it.next();
    const progress = first.value.progress[Symbol.asyncIterator]();
    expect((await progress.next()).value).toBe(1);
    const nextTick = progress.next(); // outstanding read on the nested stream
    const total = first.value.total.then(
      () => "resolved",
      () => "rejected"
    );
    expect(await it.return()).toEqual({ done: true, value: undefined });
    await new Promise(r => setTimeout(r, 20));
    // nested stream: complete, not rejected
    await expect(nextTick).resolves.toEqual({ done: true, value: undefined });
    expect((await progress.next()).done).toBe(true);
    // nested promise: left pending
    expect(await settled(total)).toBe("pending");
    expect(states).toEqual(["connected", "closed"]);
  });

  it("ending BY error still fails what is nested", async () => {
    // The caller's signal aborting is an error end (the call itself rejects
    // with it): a nested reader hears about it rather than hanging.
    registerServerFunction("ll-return-1", async () => ({
      progress: (async function* () {
        yield 1;
        await new Promise(() => {});
      })()
    }));
    connectTransport();
    const controller = new AbortController();
    const source = live(createServerReference("ll-return-1"));
    const it = (invoke(source as any, { signal: controller.signal }) as any)[
      Symbol.asyncIterator
    ]();
    const first = await it.next();
    const progress = first.value.progress[Symbol.asyncIterator]();
    expect((await progress.next()).value).toBe(1);
    const nextTick = progress.next();
    const pull = it.next();
    controller.abort(new Error("caller left"));
    await expect(pull).rejects.toThrow("caller left");
    await expect(nextTick).rejects.toThrow("caller left");
  });

  it("a body that ends on open nested sources is a death: reconnect re-yields the whole answer, fresh", async () => {
    let connections = 0;
    registerServerFunction("ll-death-0", async () => {
      const connection = ++connections;
      return {
        connection,
        progress: (async function* () {
          yield `${connection}:a`;
          if (connection === 1) await new Promise(() => {}); // the wire goes first
          yield `${connection}:b`;
        })()
      };
    });
    // sever connection 1 right after its first progress value is on the wire
    const requests = connectTransport((_, connection) => (connection === 1 ? "1:a" : undefined));
    const source = live(createServerReference("ll-death-0"));
    const iterable = (source as any)();
    const states: string[] = [];
    const errors: unknown[] = [];
    iterable.onstatus = (state: string, error: unknown) => {
      states.push(state);
      if (error) errors.push(error);
    };
    const it = iterable[Symbol.asyncIterator]();
    const first = (await it.next()).value;
    const progress1 = first.progress[Symbol.asyncIterator]();
    expect((await progress1.next()).value).toBe("1:a");
    const stranded = progress1.next(); // the value the dead connection owed
    // the death is erased from the value stream: the next pull is the
    // answer again, a new object with a new nested stream
    const second = (await it.next()).value;
    expect(second).not.toBe(first);
    expect(second.connection).toBe(2);
    const progress2 = second.progress[Symbol.asyncIterator]();
    expect((await progress2.next()).value).toBe("2:a");
    expect((await progress2.next()).value).toBe("2:b");
    expect(requests).toHaveLength(2);
    expect(states).toEqual(["connected", "reconnecting", "connected"]);
    expect(errors).toHaveLength(1);
    expect(String((errors[0] as Error).message)).toMatch(/ended unexpectedly/);
    // nothing the dead connection owed was thrown into: the re-yield
    // superseded it, so it stays pending while the iteration goes on...
    expect(await settled(stranded)).toBe("pending");
    // ...and when the CONSUMER ends the iteration it completes — nothing
    // hangs, and no error reaches a reader for an end it did not cause
    await it.return();
    await expect(stranded).resolves.toEqual({ done: true, value: undefined });
    expect(states).toEqual(["connected", "reconnecting", "connected", "closed"]);
  });

  it("a top-level stream cut mid-body is a death the loop reconnects from", async () => {
    let connections = 0;
    registerServerFunction("ll-cut-0", async function* () {
      const connection = ++connections;
      yield { connection, tag: "first" };
      if (connection === 1) await new Promise(() => {});
      yield { connection, tag: "second" };
    });
    connectTransport((_, connection) => (connection === 1 ? "first" : undefined));
    const source = live(createServerReference("ll-cut-0"));
    const iterable = (source as any)();
    const states: string[] = [];
    iterable.onstatus = (state: string) => states.push(state);
    const values = await take(iterable, 3);
    expect(values).toEqual([
      { connection: 1, tag: "first" },
      { connection: 2, tag: "first" },
      { connection: 2, tag: "second" }
    ]);
    expect(states).toEqual(["connected", "reconnecting", "connected", "closed"]);
  });

  it("a plain value answer is still a one-value stream that completes", async () => {
    registerServerFunction("ll-plain-0", async () => ({ once: true }));
    connectTransport();
    const source = live(createServerReference("ll-plain-0"));
    const values: unknown[] = [];
    for await (const value of (source as any)()) values.push(value);
    expect(values).toEqual([{ once: true }]);
  });

  it("a caller-supplied signal ends the iteration for good, across reconnects", async () => {
    let connections = 0;
    registerServerFunction("ll-signal-0", async () => {
      const connection = ++connections;
      return {
        connection,
        progress: (async function* () {
          yield `${connection}:a`;
          await new Promise(() => {});
        })()
      };
    });
    const requests = connectTransport((_, connection) => (connection === 1 ? "1:a" : undefined));
    const controller = new AbortController();
    const source = live(createServerReference("ll-signal-0"));
    const iterable: any = invoke(source as any, { signal: controller.signal });
    const states: string[] = [];
    iterable.onstatus = (state: string) => states.push(state);
    const it = iterable[Symbol.asyncIterator]();
    const first = (await it.next()).value;
    const progress1 = first.progress[Symbol.asyncIterator]();
    expect((await progress1.next()).value).toBe("1:a");
    // reconnect happens (connection 1 was cut) — then the caller aborts
    const second = (await it.next()).value;
    expect(second.connection).toBe(2);
    const progress2 = second.progress[Symbol.asyncIterator]();
    expect((await progress2.next()).value).toBe("2:a");
    const stranded = progress2.next();
    const third = it.next();
    controller.abort();
    await expect(third).rejects.toBeDefined();
    // the abort ends everything: the live connection's open deferreds fail
    // rather than hang, and no further connection is attempted
    expect(await settled(stranded)).toBe("rejected");
    await new Promise(r => setTimeout(r, 700));
    expect(requests).toHaveLength(2);
    expect(states.filter(s => s === "connected")).toHaveLength(2);
    expect(states[states.length - 1]).toBe("closed");
  });

  it("live calls never request single-flight", async () => {
    registerServerFunction("ll-flight-0", async () => ({ once: true }));
    const requests = connectTransport();
    const source = live(createServerReference("ll-flight-0"));
    await take((source as any)(), 1);
    expect(requests[0].headers.get("X-Single-Flight")).toBeNull();
    expect(new URL(requests[0].url).pathname).toBe("/_server/live/ll-flight-0");
  });
});

describe("undeclared answers keep today's behavior", () => {
  it("a death fails what it left open — nested and top-level alike", async () => {
    registerServerFunction("ll-undeclared-0", async () => ({
      progress: (async function* () {
        yield "step-a";
        await new Promise(() => {});
      })()
    }));
    connectTransport(() => "step-a");
    const answer = await (createServerReference("ll-undeclared-0") as any)();
    const progress = answer.progress[Symbol.asyncIterator]();
    expect((await progress.next()).value).toBe("step-a");
    // (the decoder's iterator throws a buffered failure synchronously)
    await expect(Promise.resolve().then(() => progress.next())).rejects.toThrow(
      /ended unexpectedly/
    );
  });
});

describe("resuming from an adopted value", () => {
  it("an iterable stamped with where to resume from yields that value first, then names the position on its first connection", async () => {
    let connections = 0;
    registerServerFunction("ll-resume-0", async function* () {
      connections++;
      yield { v: 1 };
      yield { v: 2 };
    });
    const requests = connectTransport();
    const source = live(createServerReference("ll-resume-0"));
    const iterable = (source as any)();
    // what hydration's takeover run stamps: the value the page was served with
    const adopted = { v: 1 };
    iterable[LIVE_RESUME_FROM] = adopted;
    const values = await take(iterable, 2);
    // The value the page already holds lands first — the same identity, so
    // the consumer's node settles without a change — and the wire carries
    // only what differs: the digest-equal first emission is skipped, the
    // next value the loop sees is the change.
    expect(values[0]).toBe(adopted);
    expect(values[1]).toEqual({ v: 2 });
    expect(requests[0].headers.get("Last-Event-ID")).toBe(positionDigest({ v: 1 }));
    expect(connections).toBe(1);
  });

  it("the resumed value lands before any connection is made", async () => {
    let connections = 0;
    registerServerFunction("ll-resume-1", async function* () {
      connections++;
      yield { v: 1 };
    });
    connectTransport();
    const source = live(createServerReference("ll-resume-1"));
    const iterable = (source as any)();
    iterable[LIVE_RESUME_FROM] = { v: 1 };
    const it = iterable[Symbol.asyncIterator]();
    expect(await it.next()).toEqual({ done: false, value: { v: 1 } });
    expect(connections).toBe(0);
    await it.return();
    expect(connections).toBe(0);
  });

  it("an iterable with nothing to resume from connects on its first pull", async () => {
    let connections = 0;
    registerServerFunction("ll-resume-2", async function* () {
      connections++;
      yield { v: 1 };
    });
    connectTransport();
    const source = live(createServerReference("ll-resume-2"));
    const values = await take((source as any)(), 1);
    expect(values).toEqual([{ v: 1 }]);
    expect(connections).toBe(1);
  });
});

describe("the server half brands the answer, in process", () => {
  /** The declaration, called in process under a request scope, as a render would. */
  function declare(id: string, fn: (...args: any[]) => any) {
    const source = liveServer(createServerSideReference(registerServerReference(id, fn)) as any);
    const storage = (globalThis as any)[RequestContext] as AsyncLocalStorage<unknown>;
    return (...args: any[]) =>
      storage.run({ request: new Request("https://app.example/page"), locals: {} }, () =>
        (source as any)(...args)
      );
  }

  it("brands a top-level iterable and a function-valued answer", async () => {
    const gen = declare("ll-brand-1", async function* () {});
    expect((await gen())[LIVE_SOURCE]).toBe(true);
    const component = () => null;
    const fn = declare("ll-brand-2", async () => component);
    expect((await fn())[LIVE_SOURCE]).toBe(true);
  });

  it("leaves sources nested in a value answer unbranded: bounded, they end on their own", async () => {
    const source = declare("ll-brand-0", async () => ({
      meta: "m",
      progress: (async function* () {})(),
      parts: [(async function* () {})()]
    }));
    const answer = await source();
    expect(answer[LIVE_SOURCE]).toBeUndefined();
    expect(answer.progress[LIVE_SOURCE]).toBeUndefined();
    expect(answer.parts[0][LIVE_SOURCE]).toBeUndefined();
  });
});

describe("the dev chaos knob", () => {
  it("ends every live response after the configured interval as a death; the loop reconnects", async () => {
    setServerFunctionsDev(true);
    configureServerFunctionsServer({ chaosReconnectEvery: 30 });
    restores.push(() => {
      configureServerFunctionsServer({ chaosReconnectEvery: 0 });
      setServerFunctionsDev(false);
    });
    let connections = 0;
    registerServerFunction("ll-chaos-0", async function* () {
      const connection = ++connections;
      yield { connection };
      await new Promise(() => {}); // a standing answer: only the wire ends it
    });
    connectTransport();
    const source = live(createServerReference("ll-chaos-0"));
    const iterable = (source as any)();
    const states: string[] = [];
    iterable.onstatus = (state: string) => states.push(state);
    // two connections' worth of values: the first died under the knob and
    // the loop reconnected on its own
    const values = await take(iterable as AsyncIterable<any>, 2);
    expect(values).toEqual([{ connection: 1 }, { connection: 2 }]);
    expect(connections).toBe(2);
    expect(states.slice(0, 3)).toEqual(["connected", "reconnecting", "connected"]);
  });

  it("is inert outside the dev build", async () => {
    configureServerFunctionsServer({ chaosReconnectEvery: 10 });
    restores.push(() => configureServerFunctionsServer({ chaosReconnectEvery: 0 }));
    let connections = 0;
    registerServerFunction("ll-chaos-1", async function* () {
      connections++;
      yield "a";
      await new Promise(r => setTimeout(r, 60));
      yield "b";
    });
    connectTransport();
    const source = live(createServerReference("ll-chaos-1"));
    expect(await take((source as any)() as AsyncIterable<any>, 2)).toEqual(["a", "b"]);
    expect(connections).toBe(1);
  });
});
