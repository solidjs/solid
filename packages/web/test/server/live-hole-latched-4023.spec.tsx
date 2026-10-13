/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#4023 — a live markup hole whose expression holds a
 * conditional on a property (`{m.usage && <b>done</b>}`) shipped its markers
 * and then never re-emitted. The compiler memoizes a condition it cannot see
 * through, a re-run would re-create that memo, and the sweep's impurity gate
 * closed the binding without a word: markup that silently stops updating.
 *
 * The gate's verdict stands (a hole that creates reactive scopes is not
 * re-runnable); what changes is that it is no longer silent. In dev the
 * closing sweep names it with `SSR_LIVE_HOLE_LATCHED`. The same expression
 * with the property read into a local first stays live and says nothing.
 */
import { describe, expect, test, vi } from "vitest";
import { createMemo, OBSERVE } from "solid-js";
import { Loading } from "@solidjs/web";
import { renderServerComponent } from "../../frames/src/frame-sink.js";

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

function consume(stream: any) {
  const chunks: any[] = [];
  const done = new Promise<void>(res =>
    stream.pipe({ write: (c: any) => chunks.push(c), end: res })
  );
  return { chunks, done };
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

type Message = { id: string; text: string; usage?: number };

async function run(hoisted: boolean) {
  const ch = channel<Message[]>();
  const Thread = () => {
    const view = createMemo(() => ch.iterable);
    return (
      <Loading fallback={<p>wait</p>}>
        <ol>
          {hoisted
            ? view().map(m => {
                const usage = m.usage;
                return (
                  <li>
                    {m.text.length} {usage && <b>done</b>}
                  </li>
                );
              })
            : view().map(m => (
                <li>
                  {m.text.length} {m.usage && <b>done</b>}
                </li>
              ))}
        </ol>
      </Loading>
    );
  };
  const { chunks, done } = consume(renderServerComponent(Thread, { frame: { id: "f" } }));
  await tick();
  ch.push([{ id: "a", text: "x" }]);
  await tick(20);
  ch.push([{ id: "a", text: "xx" }]);
  await tick(20);
  ch.push([{ id: "a", text: "xxx", usage: 3 }]);
  await tick(20);
  ch.end();
  await done;
  return chunks;
}

describe("a live hole the impurity gate closes is named in dev (#4023)", () => {
  test("a property condition closes the hole with SSR_LIVE_HOLE_LATCHED", async () => {
    const capture = OBSERVE!.diagnostics.capture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const chunks = await run(false);
      // The gate's verdict is unchanged: the hole shipped its markers and
      // then stopped (no `hole` chunk)…
      expect(chunks.find(c => c.type === "fragment").html).toMatch(/<!--lh:\d+-->/);
      expect(chunks.filter(c => c.type === "hole")).toHaveLength(0);
      // …but it is no longer silent.
      const events = capture.events.filter(e => e.code === "SSR_LIVE_HOLE_LATCHED");
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe("ssr");
      expect(events[0].severity).toBe("warn");
      expect(events[0].data).toMatchObject({ cause: "owners" });
      expect(String((events[0].data as any).expression)).toContain("usage");
      expect(events[0].message).toContain("const usage = m.usage");
      expect(warn.mock.calls.some(c => String(c[0]).includes("[SSR_LIVE_HOLE_LATCHED]"))).toBe(
        true
      );
    } finally {
      warn.mockRestore();
      capture.stop();
    }
  });

  test("the same markup with the property read into a local stays live and says nothing", async () => {
    const capture = OBSERVE!.diagnostics.capture();
    try {
      const chunks = await run(true);
      expect(chunks.filter(c => c.type === "hole").map(c => c.html)).toEqual([
        "<li><!--$-->2<!--/--> <!--$--><!--/--></li>",
        "<li><!--$-->3<!--/--> <!--$--><b>done</b><!--/--></li>"
      ]);
      expect(capture.events.filter(e => e.code === "SSR_LIVE_HOLE_LATCHED")).toHaveLength(0);
    } finally {
      capture.stop();
    }
  });
});
