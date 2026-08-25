import { expect, it } from "vitest";
import {
  createEffect,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";
import { REACTIVE_IN_HEAP, REACTIVE_IN_HEAP_HEIGHT } from "../src/core/constants.js";
import { dirtyQueue, zombieQueue } from "../src/core/scheduler.js";
import type { Computed } from "../src/core/types.js";

/** A chain of pass-through memos, standing in for a deep derived-data pipeline. */
function chain<T>(src: () => T, n: number): () => T {
  let cur = src;
  for (let i = 0; i < n; i++) {
    const prev = cur;
    cur = createMemo(() => prev());
  }
  return cur;
}

/**
 * Every node physically linked in a heap must carry an in-heap flag, because
 * `runHeap` makes no progress on a bucket head that `deleteFromHeap` refuses
 * to unlink (it early-returns on the flag check), and every `deleteFromHeap`
 * call site picks the queue from the node's flags.
 */
function entriesWithoutInHeapFlags(heap: typeof dirtyQueue): number[] {
  const corrupted: number[] = [];
  for (let height = 0; height < heap._heap.length; height++) {
    for (
      let el: Computed<unknown> | undefined = heap._heap[height];
      el !== undefined;
      el = el._nextHeap
    ) {
      if (!(el._flags & (REACTIVE_IN_HEAP | REACTIVE_IN_HEAP_HEIGHT))) {
        corrupted.push(el._flags);
      }
    }
  }
  return corrupted;
}

/**
 * @see https://github.com/solidjs/solid/issues/2759
 */
it("disposing a subtree with a stale height-adjust entry does not corrupt the dirty queue", () => {
  const [open, setOpen] = createSignal(true);
  let setRows!: (v: number[] | null) => void;
  let view: () => unknown = () => null;
  let dispose!: () => void;

  createRoot(d => {
    dispose = d;
    // keeps the unmount recompute at a low height, so the flush that disposes
    // the subtree never advances the cursor up to the stale entry's bucket
    const gate = chain(() => open(), 4);
    const appView = createMemo(() => {
      if (!gate()) return null;

      // ~<Inner>: an async data source that lands after mount
      const [rows, set] = createSignal<number[] | null>(null);
      setRows = set;

      // parks the "condition value" memo at a height above everything the
      // unmount flush will visit
      const tall = chain(
        createMemo(() => 1),
        12
      );
      const deepA = chain(
        createMemo(() => 1),
        20
      );
      const deepB = chain(() => rows(), 45);

      // mirrors <Show when={expr}>: the compiler wraps the `when` expression
      // in a memo that is created lazily inside (and owned by) Show's
      // "condition value" memo, so the parent's height never tracks the
      // child's height
      let expr: (() => unknown) | undefined;
      const conditionValue = createMemo(() => {
        tall();
        expr ??= createMemo(() => (rows() === null ? deepA() : deepB()) && true);
        return expr();
      });
      const condition = createMemo(() => conditionValue(), {
        equals: (a, b) => !a === !b
      });
      const value = createMemo(() => (condition() ? "inner ready" : null));
      return value();
    });
    view = appView;
    createRenderEffect(appView, () => undefined);
  });

  flush();
  expect(view()).toBe("inner ready");

  // The async data lands: the condition expression memo recomputes, its
  // height grows past the already-advanced cursor while its value stays the
  // same, so its subscriber is re-inserted for height adjustment at a stale
  // height the cursor has already passed and survives the flush linked in
  // `dirtyQueue` with only `REACTIVE_IN_HEAP_HEIGHT` set.
  setRows([1, 2, 3]);
  flush();

  // Unmount: `markDisposal` zombifies the subtree and the pending disposal
  // commits. The height-only entry must migrate queues together with its
  // zombie flag, otherwise the commit deletes it from the queue its flag
  // names (`zombieQueue`) while it is physically linked in `dirtyQueue`.
  setOpen(false);
  flush();

  expect(entriesWithoutInHeapFlags(dirtyQueue)).toEqual([]);
  expect(entriesWithoutInHeapFlags(zombieQueue)).toEqual([]);

  // Remount: on corrupted state this flush livelocks in `runHeap`, pinning
  // the thread forever.
  setOpen(true);
  flush();
  setRows([1, 2, 3]);
  flush();
  expect(view()).toBe("inner ready");

  dispose();
  flush();
});

/**
 * A user effect watching `isPending(() => latest(asyncMemo))` — with no render
 * effect subscribed to the memo anywhere (the masking condition) — spun the
 * scheduler forever on the first post-settle refetch: the transition revert
 * re-armed the companion's `true` override on every pass. Fixed structurally
 * by the write-driven companion redesign (#2838); this pins the exact repro.
 *
 * @see https://github.com/solidjs/solid/issues/2843
 */
it("isPending(() => latest(x)) in a user effect does not loop on refetch (#2843)", async () => {
  // Deferred fetch (not wall-clock timers): the revalidating window must stay
  // open until the test closes it, or a loaded event loop lets the refetch
  // settle before the assertion samples and the pin flakes.
  const settle = () => new Promise(r => setTimeout(r, 0));
  const [version, setVersion] = createSignal(0);
  const states: boolean[] = [];
  let resolveFetch!: () => void;
  let dispose!: () => void;

  createRoot(d => {
    dispose = d;
    const data = createMemo(async () => {
      const v = version();
      await new Promise<void>(r => (resolveFetch = r));
      return `payload v${v}`;
    });
    // `data` deliberately not read by any render effect
    createEffect(
      () => isPending(() => latest(data)),
      pending => {
        states.push(pending);
      }
    );
  });

  flush();
  resolveFetch();
  await settle();
  flush();
  expect(states.at(-1)).toBe(false); // settled -> idle

  // the post-settle write that triggered the unbounded spin
  setVersion(v => v + 1);
  flush(); // threw "Potential Infinite Loop Detected." when broken
  await settle();
  flush();
  expect(states.at(-1)).toBe(true); // revalidating (fetch still deferred)

  resolveFetch();
  await settle();
  flush();
  expect(states.at(-1)).toBe(false); // back to idle

  dispose();
  flush();
});

it("disposing the current boundary queue does not skip its sibling", () => {
  const effects: string[] = [];
  const disposers: (() => void)[] = [];

  try {
    createRoot(dispose => {
      disposers.push(dispose);
      createLoadingBoundary(
        () => {
          createEffect(
            () => undefined,
            () => {
              effects.push("first");
              dispose();
            }
          );
        },
        () => undefined
      )();
    });

    createRoot(dispose => {
      disposers.push(dispose);
      createLoadingBoundary(
        () => {
          createEffect(
            () => undefined,
            () => {
              effects.push("second");
            }
          );
        },
        () => undefined
      )();
    });

    flush();
    expect(effects).toEqual(["first", "second"]);
  } finally {
    for (const dispose of disposers) dispose();
    flush();
  }
});

// One disposal can remove SEVERAL sibling queues at once (a root owning more
// than one boundary), shifting the list by more than a single slot. Stepping
// the cursor back by one is not enough to recover — the pass has to be able to
// rescan without re-running what it already ran.
it("disposing a root that owns two boundary queues does not skip a later sibling", () => {
  const effects: string[] = [];
  const disposers: (() => void)[] = [];

  const boundaryWithEffect = (label: string, body?: () => void) =>
    createLoadingBoundary(
      () => {
        createEffect(
          () => undefined,
          () => {
            effects.push(label);
            body?.();
          }
        );
      },
      () => undefined
    )();

  try {
    createRoot(dispose => {
      disposers.push(dispose);
      boundaryWithEffect("a1");
      boundaryWithEffect("a2", () => dispose());
    });

    createRoot(dispose => {
      disposers.push(dispose);
      boundaryWithEffect("b");
    });

    flush();
    expect(effects).toEqual(["a1", "a2", "b"]);
  } finally {
    for (const dispose of disposers) dispose();
    flush();
  }
});
