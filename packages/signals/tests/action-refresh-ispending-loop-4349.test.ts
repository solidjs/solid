// #4349: an action's transaction lands beneath its own `refresh()`: nothing
// on screen observed the re-ask's flight yet, so the landing commits the node
// in flight (CONFIG_INPUTS_PUBLISHED, #3305). A render effect reading
// `isPending(likes)` and `likes()` then probes the flight before anything
// joined (a seam watcher, `watchVerdict`) and observes it with the plain
// read: it goes pending and opens a frame of its own, which parks on it. The
// lane seam re-derived the watcher "on the committed world" — and the re-run
// re-entered the same transaction and parked it again, every round, until
// the dev guard: "Potential Infinite Loop Detected … last staged node:
// effect". A reader the parked transaction holds that read none of its
// stagings has nothing to re-derive: it runs at the landing.
//
// Frames (F-9; optimistic-lanes R12): a bare refresh is a quiet re-ask —
// `v41` stays until `v42` lands; a declared reload (`affects`) shows
// `pending`, then `v42` — also when the action ends before the re-ask lands:
// its mark stays on the node until that flight lands, in the inline and the
// memo form alike.
import { describe, expect, it } from "vitest";
import {
  action,
  affects,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  refresh
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

type Shape = {
  affects?: boolean;
  /** "refresh-yield": refresh, then a pending step; "yield-refresh": the
   * Like button's save, then the refresh; "refresh": refresh only. */
  order: "refresh" | "refresh-yield" | "yield-refresh";
  /** The JSX shape: the ternary's condition is its own memo. */
  conditionMemo?: boolean;
  outside?: boolean;
};

async function likeButton(shape: Shape) {
  const errors: unknown[] = [];
  const onError = (e: unknown) => errors.push(e);
  process.on("unhandledRejection", onError);
  process.on("uncaughtException", onError);
  let server = 41;
  const fetches: (() => void)[] = [];
  let saved: (() => void) | undefined;
  const frames: string[] = [];
  let likes!: () => number;
  const dispose = createRoot(dispose => {
    likes = createMemo(async () => {
      const v = server;
      await new Promise<void>(r => fetches.push(r));
      return v;
    });
    const pending = shape.conditionMemo
      ? createMemo(() => isPending(likes))
      : () => isPending(likes);
    createRenderEffect(
      () => (pending() ? "pending" : `v${likes()}`),
      v => {
        if (frames.at(-1) !== v) frames.push(v);
      }
    );
    return dispose;
  });
  const steps: string[] = [];
  const step = async () => {
    await tick();
    steps.push(frames.at(-1)!);
  };
  try {
    flush();
    fetches.shift()!();
    await step();
    const reask = () => {
      server++;
      refresh(likes);
    };
    if (shape.outside) {
      if (shape.affects) affects(likes);
      reask();
    } else
      action(function* () {
        if (shape.affects) affects(likes);
        if (shape.order === "yield-refresh") {
          yield new Promise<void>(r => (saved = r));
          reask();
        } else {
          reask();
          if (shape.order === "refresh-yield") yield new Promise<void>(r => (saved = r));
        }
      })();
    await step();
    if (saved) {
      saved();
      await step();
    }
    expect(fetches.length).toBe(1);
    fetches.shift()!();
    await step();
    return { frames, steps, errors };
  } finally {
    dispose();
    process.off("unhandledRejection", onError);
    process.off("uncaughtException", onError);
  }
}

describe("refresh(memo) inside an action with an isPending reader settles (#4349)", () => {
  for (const conditionMemo of [false, true]) {
    const via = conditionMemo ? " (condition memo)" : "";
    it(`the issue's shape: a bare refresh is quiet${via}`, async () => {
      const r = await likeButton({ order: "refresh", conditionMemo });
      expect(r.errors).toEqual([]);
      expect(r.steps).toEqual(["v41", "v41", "v42"]);
      expect(r.frames).toEqual(["v41", "v42"]);
    });

    it(`a bare refresh, then a yield${via}`, async () => {
      const r = await likeButton({ order: "refresh-yield", conditionMemo });
      expect(r.errors).toEqual([]);
      expect(r.steps).toEqual(["v41", "v41", "v41", "v42"]);
      expect(r.frames).toEqual(["v41", "v42"]);
    });

    it(`the Like button: affects, yield, refresh — pending, then v42${via}`, async () => {
      const r = await likeButton({ affects: true, order: "yield-refresh", conditionMemo });
      expect(r.errors).toEqual([]);
      expect(r.steps).toEqual(["v41", "pending", "pending", "v42"]);
      expect(r.frames).toEqual(["v41", "pending", "v42"]);
    });

    it(`affects, refresh, yield — pending, then v42${via}`, async () => {
      const r = await likeButton({ affects: true, order: "refresh-yield", conditionMemo });
      expect(r.errors).toEqual([]);
      expect(r.steps).toEqual(["v41", "pending", "pending", "v42"]);
      expect(r.frames).toEqual(["v41", "pending", "v42"]);
    });

    it(`affects and refresh with no step — pending, then v42${via}`, async () => {
      // The action's transaction lands in its own flush, beneath the re-ask:
      // its mark stays on the node until that flight lands (as an ambient
      // mark does), so the inline and the memo form show the same frames.
      const r = await likeButton({ affects: true, order: "refresh", conditionMemo });
      expect(r.errors).toEqual([]);
      expect(r.steps).toEqual(["v41", "pending", "v42"]);
      expect(r.frames).toEqual(["v41", "pending", "v42"]);
    });
  }

  for (const declared of [false, true])
    it(`the same ${declared ? "declared reload" : "refresh"} outside an action (control)`, async () => {
      const r = await likeButton({ affects: declared, order: "refresh", outside: true });
      expect(r.errors).toEqual([]);
      expect(r.frames).toEqual(declared ? ["v41", "pending", "v42"] : ["v41", "v42"]);
    });

  it("`[isPending(x), x()]` after an action's write holds like `x()` alone (D-23), once", async () => {
    // The same loop without a refresh: the action's write lands beneath its
    // memo's new question, and the render effect that probes and reads it
    // parked the frame it opened every round.
    const fetches: (() => void)[] = [];
    const frames: string[] = [];
    let set!: (v: number) => void;
    const dispose = createRoot(dispose => {
      const [s, setS] = createSignal(41);
      set = setS;
      const x = createMemo(async () => {
        const v = s();
        await new Promise<void>(r => fetches.push(r));
        return v;
      });
      createRenderEffect(
        () => `${isPending(x)}:${x()}`,
        v => {
          frames.push(v);
        }
      );
      return dispose;
    });
    try {
      flush();
      fetches.shift()!();
      await tick();
      expect(frames).toEqual(["false:41"]);
      action(function* () {
        set(42);
      })();
      expect(() => flush()).not.toThrow();
      await tick();
      expect(frames).toEqual(["false:41"]);
      fetches.shift()!();
      await tick();
      expect(frames).toEqual(["false:41", "false:42"]);
    } finally {
      dispose();
    }
  });
});
