/**
 * #4010: a binding a held pass mounted reads the value that mounted it on
 * every pass. A write mounts a non-keyed Show branch and starts loading the
 * data the branch shows; the flush parks on that load, and the branch is a
 * member of the held frame (A29, ruling A). A binding in the branch reads the
 * narrowed accessor (the staged condition). When it runs again before the
 * landing — it probes `isPending` on the data (a verdict reader, which the
 * probe re-runs), or a live write reaches it — it was served the committed
 * screen, where the condition is still `null`, and threw into the error
 * boundary; with an unchanged landing the error stayed (#3977 no longer
 * re-runs an errored reader at the landing). The screen has no place for
 * it: its branch exists only in the transaction, so it reads that
 * transaction's values.
 */
import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  untrack
} from "../src/index.js";

for (const [binding, count] of [
  ["verdict", 0],
  ["verdict", 1],
  ["live write", 1]
] as const)
  it(`a held branch's binding reads the condition that mounted it (${binding}, ${count})`, async () => {
    const [selected, setSelected] = createSignal<{ name: string } | null>(null);
    const [suffix, setSuffix] = createSignal("");
    const answer = Promise.withResolvers<{ count: number }>();
    const errors: unknown[] = [];
    const screens: unknown[] = [];
    let label: unknown, busy: unknown, text: unknown, slot: unknown;
    const dispose = createRoot(dispose => {
      const [data] = createStore(() => (selected() ? answer.promise : { count: 0 }), {
        count: 0
      });
      const boundary = createLoadingBoundary(
        () =>
          createErrorBoundary(
            () => {
              // <Show when={selected()}>{item => <section …>{data.count}</section>}</Show>
              const conditionValue = createMemo(() => selected());
              const condition = createMemo(conditionValue, { equals: (a, b) => !a === !b });
              let shown: unknown = false;
              const item = () => {
                if (!shown) throw new Error("stale narrowed read");
                return conditionValue()!;
              };
              return createMemo(() => {
                const c = condition();
                shown = c;
                if (!c) return "Choose";
                return untrack(() => {
                  // aria-label={item().name} aria-busy={isPending(() => data.count)}
                  // (or title={item().name + suffix()})
                  createRenderEffect(
                    () =>
                      binding === "verdict"
                        ? [item().name, isPending(() => data.count)]
                        : [item().name + suffix(), false],
                    ([l, b]) => {
                      label = l;
                      busy = b;
                    }
                  );
                  // {data.count}
                  createRenderEffect(
                    () => data.count,
                    v => {
                      text = v;
                    }
                  );
                  return "section";
                });
              });
            },
            error => {
              errors.push(error());
              return "error";
            }
          ),
        () => "Loading"
      );
      createRenderEffect(
        () => {
          let v: unknown = boundary();
          while (typeof v === "function") v = (v as () => unknown)();
          return v;
        },
        v => {
          slot = v;
        }
      );
      return dispose;
    });
    const screen = () => screens.push(slot === "section" ? [slot, label, busy, text] : [slot]);
    try {
      flush();
      screen();
      setSelected({ name: "Example" });
      flush();
      screen();
      if (binding === "live write") {
        setSuffix("!");
        flush();
        screen();
      }
      answer.resolve({ count });
      await answer.promise;
      flush();
      screen();
      expect(errors).toEqual([]);
      expect(screens).toEqual([
        ["Choose"],
        ["Choose"],
        ...(binding === "live write"
          ? [["Choose"], ["section", "Example!", false, count]]
          : [["section", "Example", false, count]])
      ]);
    } finally {
      dispose();
    }
  });

// The same frame mounted by a keyed branch, whose binding also reads the
// flight it probes: every pass of the new branch reads the transaction's
// world (its key beside the held `k`, never the committed one), and waits on
// the flight with the rest of its frame instead of being served the
// committed value (which let the transaction land under it, and re-derived
// the binding into a fresh observation of the flight every round).
it("a held branch's verdict reader of the flight waits with its frame", async () => {
  const [k, setK] = createSignal("a");
  const [x, setX] = createSignal(0);
  const answer = Promise.withResolvers<number>();
  const runs: unknown[][] = [];
  const screen: Record<string, unknown> = {};
  const dispose = createRoot(dispose => {
    const data = createMemo(() => (k() === "a" ? 0 : answer.promise));
    const branch = createMemo(() => {
      const key = k();
      return untrack(() => {
        createRenderEffect(
          () => {
            const run = [key, k(), x(), isPending(() => data()), data()];
            runs.push(run);
            return run;
          },
          v => {
            screen.binding = v;
          }
        );
        return key;
      });
    });
    createRenderEffect(branch, v => {
      screen.branch = v;
    });
    createRenderEffect(x, v => {
      screen.x = v;
    });
    return dispose;
  });
  try {
    flush();
    expect(screen).toEqual({ branch: "a", binding: ["a", "a", 0, false, 0], x: 0 });
    setK("b");
    setX(1);
    flush();
    expect(screen).toEqual({ branch: "a", binding: ["a", "a", 0, true, 0], x: 0 });
    setX(2);
    flush();
    expect(screen.branch).toBe("a");
    answer.resolve(5);
    await answer.promise;
    flush();
    expect(screen).toEqual({ branch: "b", binding: ["b", "b", 2, false, 5], x: 2 });
    expect(runs.filter(([key, held]) => key !== held)).toEqual([]);
  } finally {
    dispose();
  }
});
