/**
 * @jsxImportSource @solidjs/web
 */
// Repro for solidjs/solid#3626: a serialized async iterator kept being
// pulled after the response was abandoned. The render was disposed, but the
// tapped iterator seroval drives never checked it, so the source generator's
// `finally` never ran and its timers stayed alive.
import { describe, expect, test } from "vitest";
import { Loading, renderToStream } from "@solidjs/web";
import { createMemo, createProjection } from "solid-js";

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function makeSource() {
  const counts = { pulls: 0, finallies: 0 };
  async function* tokens() {
    try {
      for (let n = 0; ; n++) {
        await delay(10);
        counts.pulls++;
        yield "tok" + n;
      }
    } finally {
      counts.finallies++;
    }
  }
  return { counts, tokens };
}

async function cancelAfterShell(code: () => any) {
  const reader = renderToStream(code).readable.getReader();
  await reader.read();
  await delay(25);
  await reader.cancel();
}

async function expectClosed(counts: { pulls: number; finallies: number }) {
  const atCancel = counts.pulls;
  expect(atCancel).toBeGreaterThan(0);
  await delay(100);
  // One pull may already be in flight when the response is abandoned.
  expect(counts.pulls).toBeLessThanOrEqual(atCancel + 1);
  expect(counts.finallies).toBe(1);
  const settled = counts.pulls;
  await delay(50);
  expect(counts.pulls).toBe(settled);
}

describe("renderToStream closes serialized async iterators once the response is abandoned (#3626)", () => {
  test("an iterable memo", async () => {
    const { counts, tokens } = makeSource();
    const Stream = () => {
      const v = createMemo(() => tokens());
      return <b>{v()}</b>;
    };
    await cancelAfterShell(() => (
      <div>
        <Loading fallback="loading">
          <Stream />
        </Loading>
      </div>
    ));
    await expectClosed(counts);
  });

  test("an async memo that resolves to an iterable", async () => {
    const { counts, tokens } = makeSource();
    const Stream = () => {
      const v = createMemo(async () => tokens());
      return <b>{v()}</b>;
    };
    await cancelAfterShell(() => (
      <div>
        <Loading fallback="loading">
          <Stream />
        </Loading>
      </div>
    ));
    await expectClosed(counts);
  });

  test("a generator projection", async () => {
    const counts = { pulls: 0, finallies: 0 };
    const Stream = () => {
      const p = createProjection(
        async function* (draft: { n: number }) {
          try {
            for (let n = 0; ; n++) {
              await delay(10);
              counts.pulls++;
              draft.n = n;
              yield;
            }
          } finally {
            counts.finallies++;
          }
        },
        { n: -1 }
      );
      return <b>{p.n}</b>;
    };
    await cancelAfterShell(() => (
      <div>
        <Loading fallback="loading">
          <Stream />
        </Loading>
      </div>
    ));
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
    await delay(35);
    await expectClosed(counts);
  });
});
