/**
 * @jsxImportSource @solidjs/web
 *
 * The plain-response streaming bound (frames savings pass §6 decision 4,
 * ruled 2026-10-06; frames-rulings §"The server half" (ii)). A plain
 * (non-`live`) server component whose content reads a standing source
 * keeps its response open and ships each later commit as holes — with no
 * declaration of liveness anywhere. The producer ends such a response at a
 * bound, detectably: `complete` carries `bound: "yields" | "time"`, then
 * the body closes, and the render is torn down (its sources returned). A
 * `live` response is never bounded — liveness IS the declaration that
 * there is no bound. The request's `signal` aborting after the first flush
 * ends a plain response as the time bound does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemo } from "solid-js";
import { Loading } from "@solidjs/web";
import { renderServerComponent, serverComponentResponse } from "../../frames/src/frame-sink.js";
import { ChunkReader } from "../../server-functions/src/shared.js";

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

function consume(stream: any) {
  const chunks: any[] = [];
  const waiters: { test: (c: any) => boolean; resolve: () => void }[] = [];
  const done = new Promise<void>(res =>
    stream.pipe({
      write: (c: any) => {
        chunks.push(c);
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].test(c)) waiters.splice(i, 1)[0].resolve();
        }
      },
      end: res
    })
  );
  const until = (test: (c: any) => boolean) => {
    if (chunks.some(test)) return Promise.resolve();
    return new Promise<void>(resolve => waiters.push({ test, resolve }));
  };
  return { chunks, until, done };
}

/** A push-driven async iterable that records whether it was returned. */
function channel<T>() {
  const queue: T[] = [];
  let notify: (() => void) | null = null;
  let done = false;
  const state = { closed: false, pulls: 0 };
  const wake = () => {
    notify?.();
    notify = null;
  };
  return {
    state,
    push(v: T) {
      queue.push(v);
      wake();
    },
    end() {
      done = true;
      wake();
    },
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<T>> {
            state.pulls++;
            while (queue.length === 0) {
              if (done) return { value: undefined as any, done: true };
              await new Promise<void>(r => (notify = r));
            }
            return { value: queue.shift()!, done: false };
          },
          return() {
            state.closed = true;
            done = true;
            wake();
            return Promise.resolve({ value: undefined as any, done: true as const });
          }
        };
      }
    } as AsyncIterable<T>
  };
}

/** One live hole over the channel, under a boundary (the first yield settles it). */
function holeComponent(source: () => AsyncIterable<string>) {
  return () => {
    const text = createMemo(source);
    return (
      <Loading fallback={<p>typing</p>}>
        <p>{text()}</p>
      </Loading>
    );
  };
}

const complete = (chunks: any[]) => chunks.find(c => c.type === "complete");
const yields = (chunks: any[]) =>
  chunks.filter(c => c.type === "hole" || c.type === "ops" || c.type === "attr").length;

async function readBody(response: Response) {
  const reader = new ChunkReader(response.body!);
  const chunks: any[] = [];
  for (let r = await reader.next(); !r.done; r = await reader.next()) {
    chunks.push(JSON.parse(r.value as string));
  }
  return chunks;
}

describe("the plain-response streaming bound", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('yields: a plain response over a source that keeps yielding ends at `maxYields` later yields with `complete.bound: "yields"`, and the source is returned', async () => {
    const ch = channel<string>();
    const { chunks, until, done } = consume(
      renderServerComponent(
        holeComponent(() => ch.iterable),
        {
          frame: { id: "b" },
          maxYields: 3
        }
      )
    );
    await tick();
    ch.push("v0");
    await until(c => c.type === "fragment");
    // Later yields — more than the bound allows; each is one commit, one
    // emitting sweep, one hole.
    for (let i = 1; i <= 10; i++) {
      ch.push(`v${i}`);
      await tick(1);
    }
    await done;

    const end = complete(chunks);
    expect(end).toBeDefined();
    expect(end.bound).toBe("yields");
    expect(chunks[chunks.length - 1]).toBe(end);
    // Exactly the bound's worth of later yields shipped; the first yield
    // rode the fragment (not a later yield).
    expect(yields(chunks)).toBe(3);
    expect(chunks.filter(c => c.type === "hole").map(h => h.html)).toEqual(["v1", "v2", "v3"]);
    // The render was torn down at the cut: the source was returned, not
    // left pumping for a response that ended.
    expect(ch.state.closed).toBe(true);
  }, 8000);

  it("yields: the default is 64 later yields", async () => {
    const ch = channel<string>();
    const { chunks, until, done } = consume(
      renderServerComponent(
        holeComponent(() => ch.iterable),
        { frame: { id: "b64" } }
      )
    );
    await tick();
    ch.push("v0");
    await until(c => c.type === "fragment");
    for (let i = 1; i <= 70; i++) {
      ch.push(`v${i}`);
      await tick(0);
    }
    await done;
    expect(complete(chunks).bound).toBe("yields");
    expect(yields(chunks)).toBe(64);
  }, 8000);

  it("yields: a sweep that emits nothing is not a yield (the source repeating a value does not count)", async () => {
    const ch = channel<string>();
    const { chunks, until, done } = consume(
      renderServerComponent(
        holeComponent(() => ch.iterable),
        {
          frame: { id: "bq" },
          maxYields: 2
        }
      )
    );
    await tick();
    ch.push("v0");
    await until(c => c.type === "fragment");
    // Three repeats of the first value: three commits, no emission.
    ch.push("v0");
    await tick(1);
    ch.push("v0");
    await tick(1);
    ch.push("v0");
    await tick(1);
    ch.push("v1");
    await until(c => c.type === "hole" && c.html === "v1");
    ch.push("v2");
    await done;
    expect(complete(chunks).bound).toBe("yields");
    expect(chunks.filter(c => c.type === "hole").map(h => h.html)).toEqual(["v1", "v2"]);
  }, 8000);

  it('time: a plain response ends `maxDurationMs` after its first flush with `complete.bound: "time"` (fake timers)', async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const ch = channel<string>();
    const { chunks, until, done } = consume(
      renderServerComponent(
        holeComponent(() => ch.iterable),
        {
          frame: { id: "bt" },
          maxDurationMs: 1000
        }
      )
    );
    // The shell flushes with the fallback (the first flush); the source
    // never yields. Nothing ends the response but the timer.
    await until(c => c.type === "html");
    await vi.advanceTimersByTimeAsync(999);
    expect(complete(chunks)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(complete(chunks).bound).toBe("time");
    expect(chunks[chunks.length - 1].type).toBe("complete");
    expect(ch.state.closed).toBe(true);
  });

  it("time: the default is 30 s after the first flush", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const ch = channel<string>();
    const { chunks, until, done } = consume(
      renderServerComponent(
        holeComponent(() => ch.iterable),
        { frame: { id: "bt30" } }
      )
    );
    await until(c => c.type === "html");
    await vi.advanceTimersByTimeAsync(29_999);
    expect(complete(chunks)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(complete(chunks).bound).toBe("time");
  });

  it("time: the timer arms at the first flush, not at the request", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // An un-boundaried async read: the shell itself waits on the first
    // value, so the clock must not start until it arrives.
    const ch = channel<string>();
    const Comp = () => {
      const text = createMemo(() => ch.iterable);
      return <p>{text()}</p>;
    };
    const { chunks, until, done } = consume(
      renderServerComponent(Comp, { frame: { id: "bta" }, maxDurationMs: 1000 })
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(chunks.some(c => c.type === "html")).toBe(false);
    expect(complete(chunks)).toBeUndefined();
    ch.push("v0");
    await until(c => c.type === "html");
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(complete(chunks).bound).toBe("time");
  });

  it("a `live` response is not bounded: neither count nor clock ends it; it completes when its source does, with no `bound`", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const ch = channel<string>();
    const { chunks, until, done } = consume(
      renderServerComponent(
        holeComponent(() => ch.iterable),
        {
          frame: { id: "bl" },
          live: true,
          maxYields: 2,
          maxDurationMs: 1000
        }
      )
    );
    await vi.advanceTimersByTimeAsync(1);
    ch.push("v0");
    await until(c => c.type === "fragment");
    for (let i = 1; i <= 5; i++) {
      ch.push(`v${i}`);
      await until(c => c.type === "hole" && c.html === `v${i}`);
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(complete(chunks)).toBeUndefined();
    ch.end();
    await done;
    const end = complete(chunks);
    expect(end).toBeDefined();
    expect("bound" in end).toBe(false);
    expect(chunks.filter(c => c.type === "hole")).toHaveLength(5);
  });

  it("`complete` without a bound is unchanged for a response whose sources settle", async () => {
    const ch = channel<string>();
    const { chunks, until, done } = consume(
      renderServerComponent(
        holeComponent(() => ch.iterable),
        {
          frame: { id: "bs" },
          maxYields: 10
        }
      )
    );
    await tick();
    ch.push("v0");
    await until(c => c.type === "fragment");
    ch.push("v1");
    await until(c => c.type === "hole");
    ch.end();
    await done;
    expect(complete(chunks)).toEqual({ type: "complete", id: "bs", version: 1 });
  });

  describe("the request's signal", () => {
    it('aborting after the first flush ends a plain response as the time bound does: `complete.bound: "time"`, then the body closes', async () => {
      const ch = channel<string>();
      const controller = new AbortController();
      const response = serverComponentResponse(
        holeComponent(() => ch.iterable),
        {
          frame: { id: "sig" },
          signal: controller.signal
        }
      );
      const reader = new ChunkReader(response.body!);
      const chunks: any[] = [];
      const read = async () => {
        for (let r = await reader.next(); !r.done; r = await reader.next()) {
          chunks.push(JSON.parse(r.value as string));
        }
      };
      const ended = read();
      await tick();
      ch.push("v0");
      await tick(10);
      expect(chunks.some(c => c.type === "fragment")).toBe(true);
      controller.abort();
      await ended;
      const end = complete(chunks);
      expect(end).toBeDefined();
      expect(end.bound).toBe("time");
      expect(chunks[chunks.length - 1]).toBe(end);
      expect(ch.state.closed).toBe(true);
    });

    it("aborting before the first flush ends the body without `complete` (the death the client already knows)", async () => {
      const ch = channel<string>();
      const controller = new AbortController();
      const Comp = () => {
        const text = createMemo(() => ch.iterable);
        return <p>{text()}</p>;
      };
      const response = serverComponentResponse(Comp, {
        frame: { id: "sig0" },
        signal: controller.signal
      });
      const reading = readBody(response);
      await tick();
      controller.abort();
      const chunks = await reading;
      expect(chunks.map(c => c.type)).toEqual(["start"]);
      expect(ch.state.closed).toBe(true);
    });

    it("aborting a `live` response ends the body without `complete`", async () => {
      const ch = channel<string>();
      const controller = new AbortController();
      const response = serverComponentResponse(
        holeComponent(() => ch.iterable),
        {
          frame: { id: "sigl" },
          signal: controller.signal,
          live: true
        }
      );
      const text = response.body!.pipeThrough(new TextDecoderStream());
      const reader = text.getReader();
      let out = "";
      const reading = (async () => {
        for (let r = await reader.read(); !r.done; r = await reader.read()) out += r.value;
      })();
      await tick();
      ch.push("v0");
      await tick(10);
      expect(out).toContain('"fragment"');
      controller.abort();
      await reading;
      expect(out).not.toContain('"complete"');
    });

    it("the body's own cancel (the reader left) is a death, never a bound", async () => {
      const ch = channel<string>();
      const response = serverComponentResponse(
        holeComponent(() => ch.iterable),
        {
          frame: { id: "cancel" }
        }
      );
      const reader = response.body!.getReader();
      await reader.read();
      await tick();
      ch.push("v0");
      await tick(10);
      await reader.cancel();
      await tick(5);
      expect(ch.state.closed).toBe(true);
    });
  });
});
