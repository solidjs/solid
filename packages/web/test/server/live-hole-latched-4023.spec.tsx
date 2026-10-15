/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#4023 — a live markup hole whose expression holds a
 * conditional on a property (`{m.usage && <b>done</b>}`) shipped its markers
 * and then never re-emitted. The compiler memoizes a condition it cannot see
 * through, and the sweep's impurity gate closed any re-evaluation that
 * created a reactive scope. A nested `<For>` in a row hit the same gate.
 *
 * Sweeps now run in a throwaway scope disposed as soon as they return, so a
 * re-evaluation that creates scopes stays live. The gate still closes a
 * hole whose re-evaluation creates a scope that waits on async work (a
 * re-created async source would restart on every sweep), and in dev names
 * it with `SSR_LIVE_HOLE_LATCHED`.
 */
import { describe, expect, test, vi } from "vitest";
import { createMemo, For, OBSERVE } from "solid-js";
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

type Message = { id: string; text: string; usage?: number; tags?: string[] };

const rows = {
  property: (m: Message) => (
    <li>
      {m.text.length} {m.usage && <b>done</b>}
    </li>
  ),
  hoisted: (m: Message) => {
    const usage = m.usage;
    return (
      <li>
        {m.text.length} {usage && <b>done</b>}
      </li>
    );
  },
  nestedFor: (m: Message) => (
    <li>
      {m.text.length}
      <For each={m.tags ?? []}>{t => <i>{t}</i>}</For>
    </li>
  ),
  // A memo over a stream created inside the hole: every re-run would start
  // a new consumer, so this one still closes.
  asyncInside: (m: Message) => {
    const late = createMemo(async () => {
      await tick(1);
      return m.text.length;
    });
    return <li>{late()}</li>;
  }
};

async function run(row: (m: Message) => any) {
  const ch = channel<Message[]>();
  const Thread = () => {
    const view = createMemo(() => ch.iterable);
    return (
      <Loading fallback={<p>wait</p>}>
        <ol>{view().map(row)}</ol>
      </Loading>
    );
  };
  const { chunks, done } = consume(renderServerComponent(Thread, { frame: { id: "f" } }));
  await tick();
  ch.push([{ id: "a", text: "x" }]);
  await tick(20);
  ch.push([{ id: "a", text: "xx", tags: ["p"] }]);
  await tick(20);
  ch.push([{ id: "a", text: "xxx", usage: 3, tags: ["p", "q"] }]);
  await tick(20);
  ch.end();
  await done;
  return chunks;
}

const latchedEvents = (capture: any) =>
  capture.events.filter((e: any) => e.code === "SSR_LIVE_HOLE_LATCHED");

describe("live holes whose re-evaluation creates reactive scopes (#4023)", () => {
  test("a property condition stays live and says nothing", async () => {
    const capture = OBSERVE!.diagnostics.capture();
    try {
      const chunks = await run(rows.property);
      expect(chunks.filter(c => c.type === "hole").map(c => c.html)).toEqual([
        "<li><!--$-->2<!--/--> <!--$--><!--/--></li>",
        "<li><!--$-->3<!--/--> <!--$--><b>done</b><!--/--></li>"
      ]);
      expect(latchedEvents(capture)).toHaveLength(0);
    } finally {
      capture.stop();
    }
  });

  test("the same markup with the property read into a local is unchanged", async () => {
    const capture = OBSERVE!.diagnostics.capture();
    try {
      const chunks = await run(rows.hoisted);
      expect(chunks.filter(c => c.type === "hole").map(c => c.html)).toEqual([
        "<li><!--$-->2<!--/--> <!--$--><!--/--></li>",
        "<li><!--$-->3<!--/--> <!--$--><b>done</b><!--/--></li>"
      ]);
      expect(latchedEvents(capture)).toHaveLength(0);
    } finally {
      capture.stop();
    }
  });

  test("a nested <For> in a row stays live", async () => {
    const capture = OBSERVE!.diagnostics.capture();
    try {
      const holes = (await run(rows.nestedFor)).filter(c => c.type === "hole").map(c => c.html);
      expect(holes).toHaveLength(2);
      expect(holes[0]).toContain("<i>p</i>");
      expect(holes[1]).toContain("<i>p</i><i>q</i>");
      expect(latchedEvents(capture)).toHaveLength(0);
    } finally {
      capture.stop();
    }
  });

  test("a scope waiting on async work still closes the hole, with SSR_LIVE_HOLE_LATCHED", async () => {
    const capture = OBSERVE!.diagnostics.capture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const chunks = await run(rows.asyncInside);
      expect(chunks.find(c => c.type === "fragment").html).toMatch(/<!--lh:\d+-->/);
      expect(chunks.filter(c => c.type === "hole")).toHaveLength(0);
      const events = latchedEvents(capture);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe("ssr");
      expect(events[0].severity).toBe("warn");
      expect(events[0].data).toEqual({ cause: "owners" });
      expect(events[0].ownerPath).toEqual(["<Loading>"]);
      expect(warn.mock.calls.some(c => String(c[0]).includes("[SSR_LIVE_HOLE_LATCHED]"))).toBe(
        true
      );
    } finally {
      warn.mockRestore();
      capture.stop();
    }
  });
});
