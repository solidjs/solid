/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { Loading, renderToStream } from "@solidjs/web";
import { createMemo, createProjection } from "solid-js";

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
  expect(counts.pulls).toBeLessThanOrEqual(atCancel + 1);
  const settled = counts.pulls;
  await delay(TICK * 10);
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
