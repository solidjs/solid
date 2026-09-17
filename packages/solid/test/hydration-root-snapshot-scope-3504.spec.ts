/**
 * @vitest-environment jsdom
 *
 * #3504: a user-tier effect (onSettled / createEffect) fires during the
 * hydration pass and writes a signal read by a control-flow memo created on
 * the core `createMemo` (the way <Show> builds its condition). Nothing
 * hydration-aware ran under the root before that memo, so the lazily marked
 * snapshot scope did not cover it and the write cascaded live, mid-claim.
 * A root created while hydrating now marks the scope itself: the write is
 * held until hydration ends, then replays.
 */
import { describe, expect, test, afterEach } from "vitest";
import { flush, onSettled, createMemo as coreMemo } from "@solidjs/signals";
import {
  enableHydration,
  sharedConfig,
  createRoot,
  createRenderEffect,
  createSignal,
  createEffect
} from "../src/client/hydration.js";

enableHydration();

function startHydration() {
  sharedConfig.hydrating = true;
  (sharedConfig as any).has = () => false;
  (sharedConfig as any).load = () => undefined;
  (sharedConfig as any).gather = () => {};
}

function stopHydration() {
  sharedConfig.hydrating = false;
  (sharedConfig as any).has = undefined;
  (sharedConfig as any).load = undefined;
  (sharedConfig as any).gather = undefined;
}

// A hydrating root whose only derived node is a core memo (no hydration-aware
// primitive marks the scope), with `write` fired from the user tier.
function mount(write: (set: () => void) => void) {
  const seen: number[] = [];
  createRoot(
    () => {
      const [toasts, setToasts] = createSignal<string[]>([]);
      const cond = coreMemo(() => toasts().length);
      createRenderEffect(
        () => cond(),
        v => {
          seen.push(v);
        }
      );
      write(() => setToasts(p => ["t", ...p]));
    },
    { id: "t" }
  );
  return seen;
}

describe("#3504 hydrating root marks the snapshot scope before its first child", () => {
  afterEach(() => stopHydration());

  test("onSettled write during the hydration pass is held until release", () => {
    startHydration();
    const seen = mount(set => {
      onSettled(() => {
        set();
      });
    });
    flush();
    // Held: the claim pass sees the server-rendered state only.
    expect(seen).toEqual([0]);
    stopHydration();
    flush();
    // Replayed once the pass is over.
    expect(seen).toEqual([0, 1]);
  });

  test("createEffect write during the hydration pass is held until release", () => {
    startHydration();
    const seen = mount(set => {
      createEffect(
        () => 1,
        () => {
          set();
        }
      );
    });
    flush();
    expect(seen).toEqual([0]);
    stopHydration();
    flush();
    expect(seen).toEqual([0, 1]);
  });

  test("outside hydration the root is a plain root: the write applies in the same flush", () => {
    const seen = mount(set => {
      onSettled(() => {
        set();
      });
    });
    flush();
    expect(seen).toEqual([0, 1]);
  });
});
