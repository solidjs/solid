/**
 * onFlush(fn): run `fn` once right after the pending flush, in the same
 * microtask checkpoint, without waiting on async work. A write made there is
 * its own update: it is not held by async work another write in the same
 * frame started, unless what it changes also derives from that work.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  OBSERVE,
  onFlush,
  onSettled
} from "../src/index.js";

afterEach(() => flush());

const microtasks = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
const tick = () => new Promise<void>(r => setTimeout(r, 0));

/** A menu's `open` and a route whose page loads async. */
function menu(overlap?: "memo" | "effect" | "render") {
  const [open, setOpen] = createSignal(true);
  const [route, setRoute] = createSignal(0);
  let resolve: ((v: number) => void) | undefined;
  const page = createMemo(() => (route() === 0 ? 0 : new Promise<number>(r => (resolve = r))));
  const log: string[] = [];
  createRoot(() => {
    createRenderEffect(open, v => void log.push(`open:${v}`));
    createRenderEffect(page, v => void log.push(`page:${v}`));
    if (overlap === "memo") {
      const both = createMemo(() => `${open()},${page()}`);
      createRenderEffect(both, v => void log.push(`both:${v}`));
    } else if (overlap === "effect")
      createEffect(
        () => `${open()},${page()}`,
        v => void log.push(`both:${v}`)
      );
    else if (overlap === "render")
      createRenderEffect(
        () => `${open()},${page()}`,
        v => void log.push(`both:${v}`)
      );
  });
  flush();
  log.length = 0;
  return { open, setOpen, setRoute, log, land: () => resolve!(1) };
}

describe("onFlush", () => {
  it("a write made before the async write commits while the route is pending", async () => {
    const { open, setOpen, setRoute, log, land } = menu();
    onFlush(() => setOpen(false));
    setRoute(1);
    await microtasks();
    expect(log).toEqual(["open:false"]);
    expect(open()).toBe(false);
    land();
    await tick();
    expect(log).toEqual(["open:false", "page:1"]);
  });

  it("works after the async write too", async () => {
    const { setOpen, setRoute, log, land } = menu();
    setRoute(1);
    onFlush(() => setOpen(false));
    await microtasks();
    expect(log).toEqual(["open:false"]);
    land();
    await tick();
    expect(log).toEqual(["open:false", "page:1"]);
  });

  it("queueMicrotask before the frame's first write joins that flush and is held", async () => {
    const { setOpen, setRoute, log, land } = menu();
    queueMicrotask(() => setOpen(false));
    setRoute(1);
    await tick();
    expect(log).toEqual([]);
    land();
    await tick();
    expect(log).toContain("open:false");
  });

  it("joins the hold when a memo derives from both", async () => {
    const { open, setOpen, setRoute, log, land } = menu("memo");
    onFlush(() => setOpen(false));
    setRoute(1);
    await tick();
    expect(log).toEqual([]);
    expect(open()).toBe(true);
    land();
    await tick();
    expect(log).toContain("open:false");
    expect(log).toContain("both:false,1");
  });

  it("joins the hold when a createEffect reads both, and the effect runs once", async () => {
    const { setOpen, setRoute, log, land } = menu("effect");
    onFlush(() => setOpen(false));
    setRoute(1);
    await tick();
    expect(log).toEqual([]);
    land();
    await tick();
    expect(log.filter(l => l.startsWith("both"))).toEqual(["both:false,1"]);
  });

  it("a render effect reading both shows the committed route beside the new value", async () => {
    const { setOpen, setRoute, log, land } = menu("render");
    onFlush(() => setOpen(false));
    setRoute(1);
    await microtasks();
    expect(log).toEqual(["open:false", "both:false,0"]);
    land();
    await tick();
    expect(log).toEqual(["open:false", "both:false,0", "page:1", "both:false,1"]);
  });

  it.each([
    [
      "inside flush(fn)",
      (o: () => void, r: () => void) =>
        flush(() => {
          onFlush(o);
          r();
        })
    ],
    [
      "inside nested flush(fn)",
      (o: () => void, r: () => void) =>
        flush(() =>
          flush(() => {
            onFlush(o);
            r();
          })
        )
    ],
    [
      "with flush(fn) inside the callback",
      (o: () => void, r: () => void) => {
        onFlush(() => flush(o));
        r();
      }
    ],
    [
      "nested in another onFlush",
      (o: () => void, r: () => void) => {
        onFlush(() => onFlush(o));
        r();
      }
    ],
    [
      "followed by a bare flush()",
      (o: () => void, r: () => void) => {
        onFlush(o);
        r();
        flush();
      }
    ]
  ])("stays out of the hold %s", async (_, act) => {
    const { setOpen, setRoute, log, land } = menu();
    act(
      () => setOpen(false),
      () => setRoute(1)
    );
    await microtasks();
    expect(log).toEqual(["open:false"]);
    land();
    await tick();
    expect(log).toEqual(["open:false", "page:1"]);
  });

  it("runs after the drain when called from an effect callback", async () => {
    const [trigger, setTrigger] = createSignal(0);
    const [value, setValue] = createSignal(0);
    const log: string[] = [];
    createRoot(() => {
      createEffect(trigger, t => {
        if (t) onFlush(() => setValue(t * 10));
      });
      createRenderEffect(value, v => void log.push(`value:${v}`));
    });
    flush();
    setTrigger(1);
    await microtasks();
    expect(log).toEqual(["value:0", "value:10"]);
  });

  it("lands after inline writes in the same frame; callbacks run in order and batch", async () => {
    const [v, setV] = createSignal(0);
    const log: number[] = [];
    createRoot(() => createRenderEffect(v, x => void log.push(x)));
    flush();
    log.length = 0;

    onFlush(() => setV(1));
    setV(2);
    await microtasks();
    expect(log).toEqual([2, 1]);

    log.length = 0;
    onFlush(() => setV(x => x + 10));
    setV(x => x * 2);
    await microtasks();
    expect(log).toEqual([2, 12]);

    log.length = 0;
    onFlush(() => setV(100));
    onFlush(() => setV(200));
    await microtasks();
    expect(log).toEqual([200]);
  });

  describe("ON_FLUSH_IN_OWNED_SCOPE", () => {
    const capture = async (fn: () => void) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const c = OBSERVE!.diagnostics.capture();
      try {
        fn();
        flush();
        await microtasks();
      } finally {
        warn.mockRestore();
      }
      return c.stop().filter(e => e.code === "ON_FLUSH_IN_OWNED_SCOPE");
    };

    it("warns in a component body or computation, and still runs", async () => {
      let ran = 0;
      const events = await capture(() =>
        createRoot(() => {
          onFlush(() => ran++);
          createMemo(() => onFlush(() => ran++))();
        })
      );
      expect(events).toHaveLength(2);
      expect(events[0].severity).toBe("warn");
      expect(events[0].kind).toBe("lifecycle");
      expect(ran).toBe(2);
    });

    it("is silent in handlers, effect callbacks and onSettled bodies", async () => {
      let ran = 0;
      const events = await capture(() => {
        onFlush(() => ran++);
        createRoot(() => {
          createEffect(
            () => 0,
            () => onFlush(() => ran++)
          );
          onSettled(() => onFlush(() => ran++));
        });
      });
      expect(events).toEqual([]);
      expect(ran).toBe(3);
    });
  });
});
