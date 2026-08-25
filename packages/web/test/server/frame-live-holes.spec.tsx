/**
 * @jsxImportSource @solidjs/web
 *
 * Live markup holes (Stage 3) through Solid's real SSR compile + reactive
 * core: an async-iterable-fed memo read inside markup makes that hole live —
 * each yield commits, the hole's binding re-evaluates, and changed HTML
 * re-emits as a keyed `hole` chunk. This is the chat demo's shape (the
 * markdown memo), pinned at the integration layer.
 */
import { describe, expect, it } from "vitest";
import { createMemo } from "solid-js";
import { Loading } from "@solidjs/web";
import { renderServerComponent } from "../../frames/src/frame-sink.js";

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

/**
 * Pipe a frame stream, exposing the live chunk list and a waiter — sequencing
 * is chunk-driven, not sleep-driven, so the intended interleaving (push, see
 * it land, push again) holds under any scheduler load.
 */
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

/** A push-driven async iterable (the chat model's channel shape). */
function channel<T>() {
  const queue: T[] = [];
  let notify: (() => void) | null = null;
  let done = false;
  const wake = () => {
    notify?.();
    notify = null;
  };
  return {
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
            while (queue.length === 0) {
              if (done) return { value: undefined as any, done: true };
              await new Promise<void>(r => (notify = r));
            }
            return { value: queue.shift()!, done: false };
          }
        };
      }
    } as AsyncIterable<T>
  };
}

describe("live markup holes over async-iterable memos (the chat shape)", () => {
  it("re-emits the hole per yield and completes when the iterable ends", async () => {
    const ch = channel<string>();
    const ServerComp = () => {
      const text = createMemo(() => ch.iterable);
      return (
        <Loading fallback={<p>typing</p>}>
          <div class="md" innerHTML={text()} />
        </Loading>
      );
    };
    const { chunks, until, done } = consume(
      renderServerComponent(ServerComp, { frame: { id: "f" } })
    );
    await tick();
    ch.push("<b>one</b>");
    // The first yield settles the boundary: wait for the fragment so the
    // second push is genuinely mid-response.
    await until(c => c.type === "fragment");
    ch.push("<b>one two</b>");
    await until(c => c.type === "hole" && c.html === "<b>one two</b>");
    ch.end();
    await done;

    // The reply revealed with the first yield's markup, marker-wrapped...
    const fragment = chunks.find(c => c.type === "fragment");
    expect(fragment.html).toMatch(/<!--lh:(\d+)--><b>one<\/b><!--lh:\/\1-->/);
    // ...the second yield re-emitted the hole (exactly once — the first
    // yield's value shipped in the fragment splice, so the baseline gate
    // suppressed its redundant re-emission)...
    const holes = chunks.filter(c => c.type === "hole");
    expect(holes.map(h => h.html)).toEqual(["<b>one two</b>"]);
    // ...and the response stayed open for the trace and completed when the
    // iterable ended (the ctx.hold release).
    expect(chunks[chunks.length - 1].type).toBe("complete");
  }, 8000);
});
