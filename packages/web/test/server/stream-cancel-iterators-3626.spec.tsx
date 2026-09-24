/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { Loading, renderToStream, type ServerErrorContext } from "@solidjs/web";
import { createHydrationSerializer } from "@solidjs/web/serialization";
import { NotReadyError, createMemo, createProjection } from "solid-js";

const TICK = 10;

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

type Counts = { pulls: number; finallies: number };

function makeSource(limit = Infinity) {
  const counts: Counts = { pulls: 0, finallies: 0 };
  async function* tokens() {
    try {
      for (let n = 0; n < limit; n++) {
        await delay(TICK);
        counts.pulls++;
        yield "tok" + n;
      }
    } finally {
      counts.finallies++;
    }
  }
  return { counts, tokens };
}

function makeProjectionSource(limit = Infinity) {
  const counts: Counts = { pulls: 0, finallies: 0 };
  const derive = async function* (draft: { n: number }) {
    try {
      for (let n = 0; n < limit; n++) {
        await delay(TICK);
        counts.pulls++;
        draft.n = n;
        yield;
      }
    } finally {
      counts.finallies++;
    }
  };
  return { counts, derive };
}

async function cancelAfterShell(code: () => any, counts: Counts) {
  const reader = renderToStream(code).readable.getReader();
  await reader.read();
  await until(() => counts.pulls > 0);
  await reader.cancel();
}

async function expectClosed(counts: Counts) {
  const atCancel = counts.pulls;
  await until(() => counts.finallies === 1);
  // The pull in flight at the cancel may still settle after the source was
  // returned — the wind-down returns it promptly rather than waiting for
  // that pull (a generator queues `return()` behind it; a hand-written
  // iterator need not) — but nothing starts another one.
  await delay(TICK * 10);
  expect(counts.pulls).toBeLessThanOrEqual(atCancel + 1);
  const settled = counts.pulls;
  await delay(TICK * 5);
  expect(counts.pulls).toBe(settled);
  expect(counts.finallies).toBe(1);
}

async function readToEnd(code: () => any) {
  const reader = renderToStream(code).readable.getReader();
  const decoder = new TextDecoder();
  let html = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return html;
    html += decoder.decode(value);
  }
}

describe("renderToStream closes serialized async iterators once the response is abandoned (#3626)", () => {
  test("an iterable memo", async () => {
    const { counts, tokens } = makeSource();
    const Stream = () => {
      const v = createMemo(() => tokens());
      return <b>{v()}</b>;
    };
    await cancelAfterShell(
      () => (
        <div>
          <Loading fallback="loading">
            <Stream />
          </Loading>
        </div>
      ),
      counts
    );
    await expectClosed(counts);
  });

  test("an async memo that resolves to an iterable", async () => {
    const { counts, tokens } = makeSource();
    const Stream = () => {
      const v = createMemo(async () => tokens());
      return <b>{v()}</b>;
    };
    await cancelAfterShell(
      () => (
        <div>
          <Loading fallback="loading">
            <Stream />
          </Loading>
        </div>
      ),
      counts
    );
    await expectClosed(counts);
  });

  test("a generator projection", async () => {
    const { counts, derive } = makeProjectionSource();
    const Stream = () => {
      const p = createProjection(derive, { n: -1 });
      return <b>{p.n}</b>;
    };
    await cancelAfterShell(
      () => (
        <div>
          <Loading fallback="loading">
            <Stream />
          </Loading>
        </div>
      ),
      counts
    );
    await expectClosed(counts);
  });

  test("the source's return() runs once", async () => {
    const counts: Counts = { pulls: 0, finallies: 0 };
    const source: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({
        async next() {
          await delay(TICK);
          return { done: false, value: "tok" + counts.pulls++ };
        },
        async return() {
          counts.finallies++;
          return { done: true, value: undefined };
        }
      })
    };
    const Stream = () => {
      const v = createMemo(() => source);
      return <b>{v()}</b>;
    };
    await cancelAfterShell(
      () => (
        <div>
          <Loading fallback="loading">
            <Stream />
          </Loading>
        </div>
      ),
      counts
    );
    await expectClosed(counts);
  });

  test("a pipe sink whose write throws", async () => {
    const { counts, tokens } = makeSource();
    const Stream = () => {
      const v = createMemo(() => tokens());
      return <b>{v()}</b>;
    };
    let writes = 0;
    renderToStream(() => (
      <div>
        <Loading fallback="loading">
          <Stream />
        </Loading>
      </div>
    )).pipe({
      write() {
        if (++writes > 1) throw new Error("EPIPE");
      },
      end() {}
    });
    await until(() => writes > 1);
    await expectClosed(counts);
  });
});

describe("renderToStream delivers every value of a serialized async iterator when the response is read to the end", () => {
  const expectTokens = (html: string) => {
    for (let n = 0; n < 5; n++) expect(html).toContain("tok" + n);
  };

  test("an iterable memo", async () => {
    const { counts, tokens } = makeSource(5);
    const Stream = () => {
      const v = createMemo(() => tokens());
      return <b>{v()}</b>;
    };
    const html = await readToEnd(() => (
      <div>
        <Loading fallback="loading">
          <Stream />
        </Loading>
      </div>
    ));
    expectTokens(html);
    expect(counts).toEqual({ pulls: 5, finallies: 1 });
  });

  test("an async memo that resolves to an iterable", async () => {
    const { counts, tokens } = makeSource(5);
    const Stream = () => {
      const v = createMemo(async () => tokens());
      return <b>{v()}</b>;
    };
    const html = await readToEnd(() => (
      <div>
        <Loading fallback="loading">
          <Stream />
        </Loading>
      </div>
    ));
    expectTokens(html);
    expect(counts).toEqual({ pulls: 5, finallies: 1 });
  });

  test("an async memo whose slot a retry pass re-creates", async () => {
    const { counts, tokens } = makeSource(5);
    let bodies = 0;
    const Stream = () => {
      bodies++;
      const v = createMemo(async () => tokens());
      const gate = createMemo(async () => {
        await delay(TICK * 2);
        return "gate";
      });
      const g = gate();
      return (
        <b>
          {g}:{v()}
        </b>
      );
    };
    const renderStream = () => <Stream />;
    const html = await readToEnd(() => <main>{renderStream()}</main>);
    expect(bodies).toBe(2);
    expectTokens(html);
    expect(counts).toEqual({ pulls: 5, finallies: 1 });
  });

  test("a generator projection", async () => {
    const { counts, derive } = makeProjectionSource(5);
    const Stream = () => {
      const p = createProjection(derive, { n: -1 });
      return <b>{p.n}</b>;
    };
    const html = await readToEnd(() => (
      <div>
        <Loading fallback="loading">
          <Stream />
        </Loading>
      </div>
    ));
    expect(html).toContain('["n"],4]');
    expect(counts).toEqual({ pulls: 5, finallies: 1 });
  });
});

type HangCounts = { pulls: number; returns: number; finallies: number };

/**
 * A source whose second `next()` never settles. The tapped iterator's
 * disposed check runs on the NEXT pull, which never comes — the only road
 * to this source is the serializer's `close()`, run by the render's
 * wind-down, which calls `return()` on the tapped iterator, which returns
 * the source.
 *
 * A native async generator queues `return()` behind a pending `next()` by
 * spec, so its `finally` cannot run while the body is parked on an await.
 * The source is therefore the shape that CAN act on `return()` mid-pull:
 * an iterator whose `return()` aborts the wait (an event or socket
 * subscription is the everyday case) and then closes the generator behind
 * it, so the generator's `finally` runs.
 */
function makeHangingSource() {
  const counts: HangCounts = { pulls: 0, returns: 0, finallies: 0 };
  let abort!: () => void;
  const hang = new Promise<void>(r => (abort = r));
  async function* body() {
    try {
      await delay(TICK);
      yield "tok0";
      counts.pulls++;
      await hang;
    } finally {
      counts.finallies++;
    }
  }
  const gen = body();
  const source: AsyncIterable<string> = {
    [Symbol.asyncIterator]: () => ({
      next: () => gen.next(),
      return(value?: any) {
        counts.returns++;
        abort();
        return gen.return(value);
      }
    })
  };
  return { counts, source };
}

/** Second pull parked, then the response is abandoned: the source is returned within a tick. */
async function expectReturnedPromptly(counts: HangCounts) {
  await delay(0);
  expect(counts).toEqual({ pulls: 1, returns: 1, finallies: 1 });
  await delay(TICK * 5);
  expect(counts).toEqual({ pulls: 1, returns: 1, finallies: 1 });
}

/** Own the listener so an escaped rejection fails THIS test (see ssr-async-rejection-3570.spec.tsx). */
async function watchRejections<T>(run: () => Promise<T>) {
  const previous = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  const escaped: unknown[] = [];
  const capture = (reason: unknown) => escaped.push(reason);
  process.on("unhandledRejection", capture);
  try {
    const value = await run();
    await delay(TICK * 2);
    return { escaped, value };
  } finally {
    process.off("unhandledRejection", capture);
    for (const listener of previous) process.on("unhandledRejection", listener as any);
  }
}

describe("renderToStream returns a serialized async iterator whose pending next() never settles (#3626)", () => {
  const page = (Stream: () => any) => () => (
    <div>
      <Loading fallback="loading">
        <Stream />
      </Loading>
    </div>
  );

  test("readable cancel: an iterable memo", async () => {
    const { counts, source } = makeHangingSource();
    const Stream = () => {
      const v = createMemo(() => source);
      return <b>{v()}</b>;
    };
    const reader = renderToStream(page(Stream)).readable.getReader();
    await reader.read();
    await until(() => counts.pulls === 1);
    expect(counts.returns).toBe(0);
    await reader.cancel();
    await expectReturnedPromptly(counts);
  });

  test("readable cancel: an async memo that resolves to an iterable", async () => {
    const { counts, source } = makeHangingSource();
    const Stream = () => {
      const v = createMemo(async () => source);
      return <b>{v()}</b>;
    };
    const reader = renderToStream(page(Stream)).readable.getReader();
    await reader.read();
    await until(() => counts.pulls === 1);
    expect(counts.returns).toBe(0);
    await reader.cancel();
    await expectReturnedPromptly(counts);
  });

  test("pipeTo: a writable whose write rejects — the source is returned and the promise settles", async () => {
    const { counts, source } = makeHangingSource();
    const Stream = () => {
      const v = createMemo(() => source);
      return <b>{v()}</b>;
    };
    let writes = 0;
    const settled = renderToStream(page(Stream)).pipeTo(
      new WritableStream({
        write() {
          if (++writes > 1) throw new Error("EPIPE");
        }
      })
    );
    await until(() => writes > 1);
    await expectReturnedPromptly(counts);
    await settled;
  });

  test("pipe: a sink whose write throws", async () => {
    const { counts, source } = makeHangingSource();
    const Stream = () => {
      const v = createMemo(() => source);
      return <b>{v()}</b>;
    };
    let writes = 0;
    renderToStream(page(Stream)).pipe({
      write() {
        if (++writes > 1) throw new Error("EPIPE");
      },
      end() {}
    });
    await until(() => writes > 1);
    await expectReturnedPromptly(counts);
  });

  test("a custom serializer's close() is what reaches the source", async () => {
    const { counts, source } = makeHangingSource();
    const Stream = () => {
      const v = createMemo(() => source);
      return <b>{v()}</b>;
    };
    let closes = 0;
    const serializer = (opts: any) => {
      const inner = createHydrationSerializer(opts);
      return {
        write: (key: string, value: unknown) => inner.write(key, value),
        flush: () => inner.flush(),
        close() {
          closes++;
          inner.close();
        }
      };
    };
    const reader = renderToStream(page(Stream), { serializer } as any).readable.getReader();
    await reader.read();
    await until(() => counts.pulls === 1);
    expect(closes).toBe(0);
    await reader.cancel();
    await expectReturnedPromptly(counts);
    expect(closes).toBe(1);
  });

  test("a render failure: the source is returned, the promise resolves, onError hears one `failed`", async () => {
    const { counts, source } = makeHangingSource();
    const heard: ServerErrorContext[] = [];
    // A boundary that trips its convergence budget (#3003) pre-flush — the
    // failure `failRender` winds the render down through `abandon`.
    const NeverConverges = () => {
      throw new NotReadyError(Promise.resolve() as any);
    };
    const Stream = () => {
      const v = createMemo(() => source);
      return <b>{v()}</b>;
    };
    const { escaped, value } = await watchRejections(() =>
      renderToStream(
        () => (
          <div>
            <Loading fallback="loading">
              <Stream />
            </Loading>
            <Loading fallback="loading">
              <NeverConverges />
            </Loading>
          </div>
        ),
        { onError: (_e: unknown, context: ServerErrorContext) => void heard.push(context) }
      ).then(html => html)
    );
    expect(escaped).toEqual([]);
    expect(value).toBe("");
    expect(heard.map(h => h.handling)).toEqual(["failed"]);
    await until(() => counts.finallies === 1);
    expect(counts.returns).toBe(1);
  });

  test("a source whose return() throws synchronously does not escape the teardown", async () => {
    let returns = 0;
    let pulls = 0;
    const source: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({
        async next() {
          if (pulls++) return new Promise<IteratorResult<string>>(() => {});
          await delay(TICK);
          return { done: false, value: "tok0" };
        },
        return() {
          returns++;
          throw new Error("return boom");
        }
      })
    };
    const Stream = () => {
      const v = createMemo(() => source);
      return <b>{v()}</b>;
    };
    const { escaped } = await watchRejections(async () => {
      const reader = renderToStream(page(Stream)).readable.getReader();
      await reader.read();
      await delay(TICK * 3);
      await reader.cancel();
    });
    expect(escaped).toEqual([]);
    expect(returns).toBe(1);
  });
});
