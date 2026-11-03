// #4661: a memo outside a `<Loading on={f()}>` reads `f()` and, in the branch
// taken before the switch, `latest(() => list())`. Its last pass asked
// (`latest`), so its next run is still the hold's verdict reader (D-25, "a
// verdict posture outlives the pass that asked", 2026-10-28): its read of
// `f`'s staging is the screen's ("open", A10) — a stale reader of the
// frame — and it reads `list`'s new flight only inside `latest()`, ahead of
// it. That stale-reader mark made it a frame reader of the flight too, and
// the switch was held: the `on` fallback (D-15) never showed.
//
// F-6: a display-ahead read never holds the change it reads ahead of. The
// maintainer's ruling (2026-11-03) on what the memo shows meanwhile: "It
// should read the committed value, we can't reveal early outside of latest.
// This is intentional tearing." So the fallback shows at once and the count
// keeps its committed value (`[3]`) until `list`'s answer lands (`[-1]`).
// (The issue's table had `[-1]` during the flight.)
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createEffect,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  untrack
} from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// latest-branch:   f() === "open" ? latest(len) : -1
// untrack-branch:  f() === "open" ? untrack(len) : -1
// latest-always:   latest(len)
// latest-reads-f:  (f(), latest(len)) — isolates the cause: the stale read of
//                  `f`'s staging beside the window read of `list`'s flight.
// f-after-latest:  latest(len) + (f(), 0) — the same reads in the other order.
// plain-first:     (f(), len() + latest(len)) — a plain read of the flight
//                  before the window: the frame's reader, it holds (A10, A15).
// plain-after:     (f(), latest(len) + len()) — the same reads, the window
//                  first: read order never changes what holds.
// plain-after-alone: latest(len) + len() — no read of f: the plain read after
//                  the window holds as `len() + latest(len)` does (A10).
type Shape =
  | "latest-branch"
  | "untrack-branch"
  | "latest-always"
  | "latest-reads-f"
  | "f-after-latest"
  | "plain-first"
  | "plain-after"
  | "plain-after-alone";

function page(shape: Shape, reader: "effect" | "view") {
  const asks: { key: string; res: (v: number[]) => void }[] = [];
  const ask = (key: string) => new Promise<number[]>(res => asks.push({ key, res }));
  const out: { el: { text: string } | null; count: string; seen: unknown } = {
    el: null,
    count: "",
    seen: undefined
  };
  const [f, setF] = createSignal("open");
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const list = createMemo(() => ask(`list:${f()}`));
    const len = () => list().length;
    const count = createMemo(() =>
      shape === "latest-always"
        ? latest(len)
        : shape === "latest-reads-f"
          ? (f(), latest(len))
          : shape === "f-after-latest"
            ? latest(len) + (f(), 0)
            : shape === "plain-first"
              ? (f(), len() + latest(len))
              : shape === "plain-after"
                ? (f(), latest(len) + len())
                : shape === "plain-after-alone"
                  ? latest(len) + len()
                  : f() === "open"
                    ? shape === "untrack-branch"
                      ? untrack(len)
                      : latest(len)
                    : -1
    );
    if (reader === "view")
      createRenderEffect(count, v => {
        out.count = `[${v}]`;
      });
    else
      createEffect(count, v => {
        out.seen = v;
      });
    const part = (read: () => string) => {
      const el = { text: "-" };
      createRenderEffect(read, v => {
        el.text = v;
      });
      return el;
    };
    // <Loading fallback="first"><Loading on={f()} fallback={`loading ${f()}`}>
    //   {list().join(",")}</Loading></Loading>
    const inner = untrack(() =>
      createLoadingBoundary(
        () => part(() => list().join(",")),
        () => part(() => `loading ${f()}`),
        { on: () => f() }
      )
    );
    const outer = untrack(() =>
      createLoadingBoundary(
        () => {
          const r: { el?: { text: string } } = {};
          createRenderEffect(inner, v => {
            r.el = v as { text: string };
          });
          return {
            get text() {
              return r.el ? r.el.text : "-";
            }
          };
        },
        () => part(() => "first")
      )
    );
    createRenderEffect(outer, v => {
      out.el = v as { text: string };
    });
  });
  const settle = async (key?: string, v?: number[]) => {
    const i = asks.findIndex(a => a.key === key);
    if (i >= 0) asks.splice(i, 1)[0].res(v!);
    for (let k = 0; k < 4; k++) {
      await vi.advanceTimersByTimeAsync(0);
      flush();
    }
  };
  const screen = () => `${out.count}${out.el ? out.el.text : "-"}`;
  return { setF, settle, screen, out, dispose };
}

async function run(shape: Shape, reader: "effect" | "view") {
  const p = page(shape, reader);
  flush();
  await p.settle("list:open", [1, 2, 3]);
  const before = [p.screen(), p.out.seen];
  p.setF("closed");
  flush();
  await p.settle();
  const during = [p.screen(), p.out.seen];
  await p.settle("list:closed", [9]);
  const after = [p.screen(), p.out.seen];
  p.dispose();
  return { before, during, after };
}

describe("#4661 a memo's latest() posture does not hold a Loading on switch (F-6)", () => {
  test("latest in the branch, read by an effect: the fallback shows, the count keeps 3", async () => {
    expect(await run("latest-branch", "effect")).toEqual({
      before: ["1,2,3", 3],
      during: ["loading closed", 3],
      after: ["9", -1]
    });
  });

  test("latest in the branch, read by a view outside the boundary: [3]loading closed", async () => {
    expect(await run("latest-branch", "view")).toEqual({
      before: ["[3]1,2,3", undefined],
      during: ["[3]loading closed", undefined],
      after: ["[-1]9", undefined]
    });
  });

  test("untrack in the branch: an ordinary derivation, shown with the switch", async () => {
    expect(await run("untrack-branch", "effect")).toEqual({
      before: ["1,2,3", 3],
      during: ["loading closed", -1],
      after: ["9", -1]
    });
  });

  test("latest with no branch: the latest view of the flight, nothing held", async () => {
    expect(await run("latest-always", "effect")).toEqual({
      before: ["1,2,3", 3],
      during: ["loading closed", 3],
      after: ["9", 1]
    });
  });

  test("latest beside a plain read of f: the stale read of f's staging does not hold the flight", async () => {
    expect(await run("latest-reads-f", "view")).toEqual({
      before: ["[3]1,2,3", undefined],
      during: ["[3]loading closed", undefined],
      after: ["[1]9", undefined]
    });
  });

  test("the same reads in the other order: the window read comes first", async () => {
    expect(await run("f-after-latest", "view")).toEqual({
      before: ["[3]1,2,3", undefined],
      during: ["[3]loading closed", undefined],
      after: ["[1]9", undefined]
    });
  });

  test("a plain read of the flight before the window: a frame reader, the switch is held", async () => {
    expect(await run("plain-first", "view")).toEqual({
      before: ["[6]1,2,3", undefined],
      during: ["[6]1,2,3", undefined],
      after: ["[2]9", undefined]
    });
  });

  test("a plain read of the flight after the window: the switch is held all the same", async () => {
    expect(await run("plain-after", "view")).toEqual({
      before: ["[6]1,2,3", undefined],
      during: ["[6]1,2,3", undefined],
      after: ["[2]9", undefined]
    });
  });

  test("a plain read after the window, with no read of f: held as in the other order", async () => {
    expect(await run("plain-after-alone", "view")).toEqual({
      before: ["[6]1,2,3", undefined],
      during: ["[6]1,2,3", undefined],
      after: ["[2]9", undefined]
    });
  });
});
