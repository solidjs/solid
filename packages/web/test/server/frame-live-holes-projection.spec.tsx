/**
 * @jsxImportSource @solidjs/web
 *
 * Projections pump in frame scope (Stage 8 B5). A `createStore` /
 * `createProjection` over an async iterable read inside a server-owned frame
 * render behaves like the memo in frame-live-holes.spec.tsx: the first
 * value settles the boundary, every later yield lands in the store, commits
 * the binding ledger (live holes re-emit), and holds the response until the
 * source ends. Under a LIVE component's document render the projection
 * takes the first value like a memo does (frame-live-document.spec.tsx),
 * and the document completes.
 */
import { describe, expect, it } from "vitest";
import { createMemo, createProjection, createStore } from "solid-js";
import { Loading, renderToStream } from "@solidjs/web";
import {
  frameTransformDirectResult,
  renderServerComponent,
  ServerComponentPlugin
} from "../../frames/src/frame-sink.js";

const LIVE_SOURCE = Symbol.for("solid.LiveSource");
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

/** A push-driven async iterable; records whether the consumer closed it. */
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

function collectDocument(code: () => any): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code, { plugins: [ServerComponentPlugin] } as any).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve(chunks.join(""))
    });
  });
}

const holeHtml = (chunks: any[]) => chunks.filter(c => c.type === "hole").map(h => h.html);

describe("projections pump in frame scope (B5)", () => {
  it("createProjection over a value-yielding iterable: per-yield hole re-emits, completes when the source ends — as the memo does", async () => {
    const ch = channel<{ text: string }>();
    const ServerComp = () => {
      const store = createProjection(() => ch.iterable, { text: "" });
      return (
        <Loading fallback={<p>typing</p>}>
          <div class="md" innerHTML={store.text} />
        </Loading>
      );
    };
    const { chunks, until, done } = consume(
      renderServerComponent(ServerComp, { frame: { id: "p" } })
    );
    await tick();
    ch.push({ text: "<b>one</b>" });
    await until(c => c.type === "fragment");
    ch.push({ text: "<b>one two</b>" });
    await until(c => c.type === "hole" && c.html === "<b>one two</b>");
    ch.push({ text: "<b>one two three</b>" });
    await until(c => c.type === "hole" && c.html === "<b>one two three</b>");
    ch.end();
    await done;

    const fragment = chunks.find(c => c.type === "fragment");
    expect(fragment.html).toMatch(/<!--lh:(\d+)--><b>one<\/b><!--lh:\/\1-->/);
    expect(holeHtml(chunks)).toEqual(["<b>one two</b>", "<b>one two three</b>"]);
    expect(chunks[chunks.length - 1].type).toBe("complete");
  }, 8000);

  it("createStore over a draft-mutating generator: the same per-yield story (patch stream as yields)", async () => {
    const ch = channel<string>();
    const ServerComp = () => {
      const [store] = createStore(
        async function* (draft: { text: string; n: number }) {
          for await (const text of ch.iterable) {
            draft.text = text;
            draft.n++;
            yield;
          }
        },
        { text: "", n: 0 }
      );
      return (
        <Loading fallback={<p>typing</p>}>
          <div class="md" innerHTML={store.text} />
          <span class="n">{store.n}</span>
        </Loading>
      );
    };
    const { chunks, until, done } = consume(
      renderServerComponent(ServerComp, { frame: { id: "g" } })
    );
    await tick();
    ch.push("<i>a</i>");
    await until(c => c.type === "fragment");
    ch.push("<i>a b</i>");
    await until(c => c.type === "hole" && c.html === "2");
    ch.end();
    await done;

    const fragment = chunks.find(c => c.type === "fragment");
    expect(fragment.html).toContain("<i>a</i>");
    expect(fragment.html).toMatch(/<!--lh:(\d+)-->1<!--lh:\/\1-->/);
    // Both holes read the store: the text hole and the counter re-emitted
    // once each for the second yield.
    expect(holeHtml(chunks).sort()).toEqual(["2", "<i>a b</i>"]);
    expect(chunks[chunks.length - 1].type).toBe("complete");
  }, 8000);

  it("memo and projection over the same source behave identically in frame scope", async () => {
    const ch = channel<{ text: string }>();
    // One source, two readers: a seat each (shareAsyncIterable is the memo's;
    // the projection consumes the raw iterable) would double-pull a raw
    // iterable, so each reader gets its own channel fed the same values.
    const chMemo = channel<{ text: string }>();
    const ServerComp = () => {
      const store = createProjection(() => ch.iterable, { text: "" });
      const memo = createMemo(() => chMemo.iterable);
      return (
        <Loading fallback={<p>typing</p>}>
          <div class="p" innerHTML={store.text} />
          <div class="m" innerHTML={memo().text} />
        </Loading>
      );
    };
    const { chunks, until, done } = consume(
      renderServerComponent(ServerComp, { frame: { id: "pm" } })
    );
    await tick();
    ch.push({ text: "v1" });
    chMemo.push({ text: "v1" });
    await until(c => c.type === "fragment");
    ch.push({ text: "v2" });
    chMemo.push({ text: "v2" });
    await until(c => holeHtml(chunks).filter(h => h === "v2").length === 2);
    ch.end();
    chMemo.end();
    await done;

    const fragment = chunks.find(c => c.type === "fragment");
    expect(fragment.html).toContain('<div class="p"><!--lh:');
    expect(fragment.html).toContain('<div class="m"><!--lh:');
    expect(holeHtml(chunks)).toEqual(["v2", "v2"]);
    expect(chunks[chunks.length - 1].type).toBe("complete");
  }, 8000);

  it("a thenable-resolved iterable (async derive returning a generator) pumps too", async () => {
    const ch = channel<{ text: string }>();
    const ServerComp = () => {
      // Promise-of-AsyncIterable flattening is a runtime posture the public
      // derive type does not spell (see signals' flatten-async-iterable
      // tests, which cast the same way).
      const store = createProjection<{ text: string }>(
        (async () => {
          await tick(1);
          return ch.iterable;
        }) as unknown as () => Promise<{ text: string }>,
        { text: "" }
      );
      return (
        <Loading fallback={<p>typing</p>}>
          <div class="md" innerHTML={store.text} />
        </Loading>
      );
    };
    const { chunks, until, done } = consume(
      renderServerComponent(ServerComp, { frame: { id: "t" } })
    );
    await tick();
    ch.push({ text: "one" });
    await until(c => c.type === "fragment");
    ch.push({ text: "one two" });
    await until(c => c.type === "hole" && c.html === "one two");
    ch.end();
    await done;

    expect(holeHtml(chunks)).toEqual(["one two"]);
    expect(chunks[chunks.length - 1].type).toBe("complete");
  }, 8000);

  it("a live-branded source in frame scope stays connected (the memo's exception), and disposal closes it from the disposal", async () => {
    const ch = channel<{ text: string }>();
    (ch.iterable as any)[LIVE_SOURCE] = true;
    const ServerComp = () => {
      const store = createProjection(() => ch.iterable, { text: "" });
      return (
        <Loading fallback={<p>typing</p>}>
          <div class="md" innerHTML={store.text} />
        </Loading>
      );
    };
    const controller = new AbortController();
    const { chunks, until } = consume(
      renderServerComponent(ServerComp, { frame: { id: "lv" }, signal: controller.signal } as any)
    );
    await tick();
    ch.push({ text: "one" });
    await until(c => c.type === "fragment");
    ch.push({ text: "two" });
    await until(c => c.type === "hole" && c.html === "two");
    expect(ch.state.closed).toBe(false);
    // The source is parked in `next()`; the render's teardown must close it
    // now, not at an event nobody would see.
    controller.abort();
    await tick(10);
    expect(ch.state.closed).toBe(true);
  }, 8000);

  it("under a live component's document render the projection takes the first value and the document completes", async () => {
    const ch = channel<{ text: string }>();
    const ServerComp = () => {
      const store = createProjection(() => ch.iterable, { text: "" });
      return (
        <Loading fallback={<span>FB</span>}>
          <section>{store.text}</section>
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "fld/proj" }) as any;
    Inline[LIVE_SOURCE] = true;
    ch.push({ text: "first" });
    ch.push({ text: "second" });
    // Completing at all is the proof: a pumped source would hold the document.
    const html = await collectDocument(() => Inline({}));
    expect(html).toContain("first");
    expect(html).not.toContain("second");
    expect(ch.state.closed).toBe(true);
    expect(ch.state.pulls).toBe(1);
  });
});
