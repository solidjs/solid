/**
 * @jsxImportSource @solidjs/web
 */
// solidjs/solid#3768 — `createSSRResponse` over a stream result tears the
// render down when nobody will read it: the resolved body is cancelled (the
// client left, a HEAD request), or a pre-flush `Location` short-circuits the
// page to a bodyless redirect. Before, both only stopped enqueueing — the
// render kept resolving fragments and pulling serialized async iterators into
// a sink that dropped every chunk.
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  Loading,
  createRequestEvent,
  createSSRResponse,
  httpHeader,
  renderToStream,
  type RequestEvent
} from "@solidjs/web";
import { OBSERVE, createMemo, onCleanup, type DiagnosticEvent } from "solid-js";

const TICK = 10;
const LATE = TICK * 15;

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function until(cond: () => boolean, limit = 2000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > limit) throw new Error("timed out waiting for condition");
    await delay(TICK / 2);
  }
}

const RequestContext = Symbol.for("solid.RequestContext");
let storage: AsyncLocalStorage<RequestEvent>;
beforeAll(() => {
  storage = new AsyncLocalStorage();
  (globalThis as any)[RequestContext] = storage;
});
afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

let capture: ReturnType<NonNullable<typeof OBSERVE>["diagnostics"]["capture"]>;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  capture = OBSERVE!.diagnostics.capture();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  capture.stop();
  warn.mockRestore();
});
const abandoned = () =>
  capture.events.filter((e: DiagnosticEvent) => e.code === "SSR_STREAM_ABANDONED");

/**
 * `<main>` with two boundaries: one reading a serialized async iterator
 * (one pull per tick, endless unless `limit`), one whose value settles at
 * `LATE`. Every chunk the render hands the response's sink passes through
 * `transformChunk`, which records it before the sink can drop it.
 */
function makePage(options: { limit?: number; location?: string } = {}) {
  const { limit = Infinity, location } = options;
  const stats = { pulls: 0, finallies: 0, cleanups: 0, writes: [] as string[] };
  async function* ticks() {
    try {
      for (let n = 0; n < limit; n++) {
        await delay(TICK);
        stats.pulls++;
        yield "tick" + n;
      }
    } finally {
      stats.finallies++;
    }
  }
  const Ticker = () => {
    onCleanup(() => stats.cleanups++);
    const tick = createMemo(() => ticks());
    return <p>{tick()}</p>;
  };
  const Late = () => {
    onCleanup(() => stats.cleanups++);
    if (location) httpHeader("Location", location);
    const text = createMemo(async () => {
      await delay(LATE);
      return "late-done";
    });
    return <p>{text()}</p>;
  };
  const App = () => (
    <main>
      <Loading fallback="loading">
        <Ticker />
      </Loading>
      <Loading fallback="loading">
        <Late />
      </Loading>
    </main>
  );
  const transformChunk = (chunk: string) => {
    stats.writes.push(chunk);
    return chunk;
  };
  return { stats, App, transformChunk };
}

/** What the render did once nobody could read it: nothing more reached the sink, nothing more was pulled. */
async function expectTornDown(
  stats: ReturnType<typeof makePage>["stats"],
  at: { pulls: number; writes: number }
) {
  await until(() => stats.cleanups === 2);
  // Past the late boundary's settle, with the ticker's pulls stopped.
  await delay(LATE + TICK * 5);
  // The pull in flight at teardown may still settle (a generator queues
  // `return()` behind it); nothing starts another.
  expect(stats.pulls).toBeLessThanOrEqual(at.pulls + 1);
  expect(stats.cleanups).toBe(2);
  expect(stats.writes.length).toBe(at.writes);
  expect(stats.writes.join("")).not.toContain("late-done");
}

describe("createSSRResponse tears the render down when its body is cancelled (#3768)", () => {
  test("after the shell was read — the client left", async () => {
    const { stats, App, transformChunk } = makePage();
    const response = await createSSRResponse(
      renderToStream(() => <App />),
      createRequestEvent(new Request("http://localhost/")),
      { transformChunk }
    );
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    await reader.read();
    await until(() => stats.pulls >= 2);
    const at = { pulls: stats.pulls, writes: stats.writes.length };
    await reader.cancel();
    await expectTornDown(stats, at);
    expect(stats.finallies).toBe(1);
    const [event, ...rest] = abandoned();
    expect(rest).toHaveLength(0);
    expect(event.data!.reason).toBe("consumer");
    expect(event.data!.shellFlushed).toBe(true);
  });

  test("before anything was read — a HEAD request", async () => {
    const { stats, App, transformChunk } = makePage();
    const response = await createSSRResponse(
      renderToStream(() => <App />),
      createRequestEvent(new Request("http://localhost/", { method: "HEAD" })),
      { transformChunk }
    );
    await until(() => stats.pulls >= 2);
    const at = { pulls: stats.pulls, writes: stats.writes.length };
    await response.body!.cancel();
    await expectTornDown(stats, at);
    expect(stats.finallies).toBe(1);
    expect(abandoned().map(e => e.data!.reason)).toEqual(["consumer"]);
  });

  test("a source whose pending next() never settles is returned at the cancel, not at a next write", async () => {
    const counts = { pulls: 0, returns: 0 };
    const source: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({
        async next() {
          if (counts.pulls++) return new Promise<IteratorResult<string>>(() => {});
          await delay(TICK);
          return { done: false, value: "tok0" };
        },
        async return() {
          counts.returns++;
          return { done: true, value: undefined };
        }
      })
    };
    const Stream = () => {
      const v = createMemo(() => source);
      return <b>{v()}</b>;
    };
    const response = await createSSRResponse(
      renderToStream(() => (
        <div>
          <Loading fallback="loading">
            <Stream />
          </Loading>
        </div>
      )),
      createRequestEvent(new Request("http://localhost/"))
    );
    const reader = response.body!.getReader();
    await reader.read();
    await until(() => counts.pulls === 2);
    expect(counts.returns).toBe(0);
    await reader.cancel();
    await delay(0);
    expect(counts.returns).toBe(1);
  });

  test("a cancel after the render ended is a no-op", async () => {
    const { stats, App, transformChunk } = makePage({ limit: 3 });
    const response = await createSSRResponse(
      renderToStream(() => <App />),
      createRequestEvent(new Request("http://localhost/")),
      { transformChunk }
    );
    // Nothing read: the whole render sits queued in the body when it ends.
    await until(() => stats.cleanups === 2);
    expect(stats.writes.join("")).toContain("late-done");
    await response.body!.cancel();
    expect(abandoned()).toHaveLength(0);
    expect(stats.finallies).toBe(1);
  });
});

describe("createSSRResponse tears the render down on a pre-flush redirect (#3768)", () => {
  test("a Location on the stub before the render", async () => {
    const { stats, App, transformChunk } = makePage();
    const event = createRequestEvent(new Request("http://localhost/"));
    event.response.headers.set("Location", "/login");
    const response = await createSSRResponse(
      renderToStream(() => <App />),
      event,
      {
        transformChunk
      }
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
    expect(response.body).toBeNull();
    await expectTornDown(stats, { pulls: 0, writes: 0 });
    // A redirect is the request's answer, not a client that left.
    expect(abandoned()).toHaveLength(0);
  });

  test("httpHeader('Location') from a component before the shell flushes", async () => {
    const { stats, App, transformChunk } = makePage({ location: "/login" });
    const event = createRequestEvent(new Request("http://localhost/"));
    const response = await storage.run(event, () =>
      createSSRResponse(
        renderToStream(() => <App />),
        event,
        { transformChunk }
      )
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
    expect(response.body).toBeNull();
    await expectTornDown(stats, { pulls: 0, writes: 0 });
    expect(abandoned()).toHaveLength(0);
  });
});

describe("the render record of a torn-down createSSRResponse (#3768)", () => {
  const outcomes: string[] = [];
  let off: () => void;
  beforeEach(() => {
    off = OBSERVE!.records.subscribe("render", event => void outcomes.push(event.outcome));
  });
  afterEach(() => {
    off();
    outcomes.splice(0);
  });

  test("a cancelled body settles as abandoned", async () => {
    const { stats, App } = makePage();
    const response = await createSSRResponse(
      renderToStream(() => <App />),
      createRequestEvent(new Request("http://localhost/"))
    );
    await until(() => stats.pulls >= 1);
    await response.body!.cancel();
    expect(outcomes).toEqual(["abandoned"]);
  });

  test("a pre-flush redirect settles as abandoned", async () => {
    const { App } = makePage();
    const event = createRequestEvent(new Request("http://localhost/"));
    event.response.headers.set("Location", "/login");
    await createSSRResponse(
      renderToStream(() => <App />),
      event
    );
    expect(outcomes).toEqual(["abandoned"]);
  });
});

describe("createSSRResponse streams a body read to the end unchanged (#3768)", () => {
  test("every chunk arrives, the sources end on their own, nothing is abandoned", async () => {
    const { stats, App, transformChunk } = makePage({ limit: 5 });
    const response = await createSSRResponse(
      renderToStream(() => <App />),
      createRequestEvent(new Request("http://localhost/")),
      { transformChunk }
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    for (let n = 0; n < 5; n++) expect(html).toContain("tick" + n);
    expect(html).toContain("late-done");
    expect(html).toBe(stats.writes.join(""));
    expect(stats).toMatchObject({ pulls: 5, finallies: 1, cleanups: 2 });
    expect(abandoned()).toHaveLength(0);
  });
});
