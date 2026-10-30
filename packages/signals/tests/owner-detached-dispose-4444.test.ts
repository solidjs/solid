/**
 * #4444: `createOwner()`'s `dispose` is handed around as a plain function
 * (`queueMicrotask(o.dispose)`, `setTimeout(o.dispose)`, an event listener)
 * and threw `TypeError: Cannot read properties of undefined (reading
 * '_flags')`: the method was a shared function that read its owner from
 * `this`, which a detached call leaves undefined. Nothing about the effect
 * in the report mattered — a bare owner threw the same way.
 *
 * No F-/D- rule governs this: it is the call shape of the owner's disposer,
 * not a reactive semantic. The disposal it performs is unchanged: everything
 * under the owner dies, cleanups run, and an effect whose first run is still
 * scheduled never runs.
 */
import { describe, expect, it } from "vitest";
import {
  createEffect,
  createOwner,
  createRenderEffect,
  flush,
  isDisposed,
  onCleanup,
  runWithOwner
} from "../src/index.js";

const macrotask = () => new Promise<void>(r => setTimeout(r, 0));

describe("createOwner dispose called detached (#4444)", () => {
  it("the issue's shape: a scheduled render effect, owner disposed from a microtask", async () => {
    const ran: string[] = [];
    const o = createOwner();
    runWithOwner(o, () => {
      createRenderEffect(
        () => {},
        () => {
          ran.push("effect");
          return () => ran.push("cleanup");
        },
        { schedule: true }
      );
      queueMicrotask(o.dispose);
    });
    // The flush microtask was queued at creation, ahead of the dispose, so the
    // first run lands and the dispose then tears it down.
    await macrotask();
    expect(isDisposed(o)).toBe(true);
    expect(ran).toEqual(["effect", "cleanup"]);
  });

  it("a detached dispose disposes, with `self` defaulting to true", () => {
    const o = createOwner();
    let cleaned = 0;
    runWithOwner(o, () => onCleanup(() => cleaned++));
    const dispose = o.dispose;
    dispose();
    expect(isDisposed(o)).toBe(true);
    expect(cleaned).toBe(1);
  });

  it("a detached dispose(false) keeps the owner and disposes its contents", () => {
    const o = createOwner();
    let cleaned = 0;
    runWithOwner(o, () => onCleanup(() => cleaned++));
    const dispose = o.dispose;
    dispose(false);
    expect(isDisposed(o)).toBe(false);
    expect(cleaned).toBe(1);
  });

  for (const kind of ["createRenderEffect", "createEffect"] as const) {
    for (const schedule of [true, false]) {
      const make = kind === "createRenderEffect" ? createRenderEffect : createEffect;
      const label = `${kind}${schedule ? " { schedule: true }" : ""}`;

      it(`${label}: detached dispose before the first scheduled run — effects never run`, async () => {
        const ran: string[] = [];
        const o = createOwner();
        runWithOwner(o, () => {
          for (let i = 0; i < 3; i++)
            make(
              () => i,
              v => {
                ran.push(`e${v}`);
              },
              schedule ? { schedule: true } : undefined
            );
        });
        const dispose = o.dispose;
        dispose();
        flush();
        await macrotask();
        expect(isDisposed(o)).toBe(true);
        // A render effect without `schedule` runs its effect at creation; the
        // rest defer to the flush, which the disposal empties first.
        expect(ran).toEqual(kind === "createRenderEffect" && !schedule ? ["e0", "e1", "e2"] : []);
      });

      for (const when of ["microtask", "macrotask"] as const) {
        it(`${label}: detached dispose from a ${when}`, async () => {
          const ran: string[] = [];
          const o = createOwner();
          runWithOwner(o, () => {
            for (let i = 0; i < 3; i++)
              make(
                () => i,
                v => {
                  ran.push(`e${v}`);
                  return () => ran.push(`c${v}`);
                },
                schedule ? { schedule: true } : undefined
              );
          });
          if (when === "microtask") queueMicrotask(o.dispose);
          else setTimeout(o.dispose, 0);
          await macrotask();
          await macrotask();
          flush();
          expect(isDisposed(o)).toBe(true);
          // Each effect ran once (the creation flush precedes the dispose) and
          // was cleaned up by the dispose; none runs again after it.
          expect(ran.filter(s => s[0] === "e").sort()).toEqual(["e0", "e1", "e2"]);
          expect(ran.filter(s => s[0] === "c").sort()).toEqual(["c0", "c1", "c2"]);
        });
      }
    }
  }
});
