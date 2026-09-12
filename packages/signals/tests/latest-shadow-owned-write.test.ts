/**
 * #3378: the latest() shadow was the one companion created without
 * `ownedWrite`. Companion syncs are internal plumbing that can run from inside
 * a computation: a transition-held memo recompute pulled mid-tick by a reader
 * (core.ts's held branch of recompute → syncCompanions → setSignal on the
 * shadow) fires with `context` set to the pulling node. The isPending signal
 * companion already carried the flag, so only the shadow write tripped the
 * dev owned-scope write guard — and halted the app.
 *
 * The issue's shape: a branch reading `latest(memo)` is toggled off while an
 * action is pending (its shadow goes dormant with the reader) and restored as
 * the action resumes. The restored reader runs before the memo's own heap
 * slot, so the fresh shadow's first compute pulls the still-dirty memo, whose
 * held recompute syncs companions from inside that compute. A live shadow
 * brought current through latestRead's mid-tick pull hits the same write with
 * the pulling reader as context.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};

function mount(keepShadowAlive: boolean) {
  const log: string[] = [];
  const errors: Error[] = [];
  let setCount!: (v: number) => void;
  let setShow!: (v: boolean) => void;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [count, s1] = createSignal(0);
    setCount = s1;
    const [show, s2] = createSignal(true);
    setShow = s2;
    const copy = createMemo(() => count());
    // A permanent reader keeps the memo's shadow alive across the toggle, so
    // the restored branch pulls the EXISTING shadow current instead of
    // creating a fresh one.
    if (keepShadowAlive)
      createRenderEffect(
        () => latest(() => copy()),
        () => {}
      );
    // `{show() ? <p>Latest: {latest(copy)}</p> : "hidden"}`: the branch mounts
    // a nested reader inside the conditional's own render effect.
    createRenderEffect(
      () => {
        if (!show()) return "hidden";
        createRenderEffect(
          () => {
            try {
              return latest(() => copy());
            } catch (e) {
              errors.push(e as Error);
              throw e;
            }
          },
          v => {
            log.push(`latest:${v}`);
          }
        );
        return "branch";
      },
      v => {
        log.push(`cond:${v}`);
      }
    );
  });
  flush();
  return { log, errors, setCount, setShow, dispose };
}

describe("latest() shadow companion writes from inside a computation (#3378)", () => {
  for (const keepShadowAlive of [false, true]) {
    it(`restoring a latest(memo) branch as an action resumes (${
      keepShadowAlive ? "live shadow pulled current" : "fresh shadow"
    })`, async () => {
      const { log, errors, setCount, setShow, dispose } = mount(keepShadowAlive);
      expect(log).toEqual(["latest:0", "cond:branch"]);

      // Toggle the branch off while nothing is held.
      setShow(false);
      flush();
      expect(log[log.length - 1]).toBe("cond:hidden");

      // The action resumes after its async gap: restore the branch and write
      // the memo's source in one held slice. The conditional runs first, and
      // its nested reader pulls the dirty memo through latest().
      const run = action(async function* () {
        await new Promise(r => setTimeout(r, 0));
        yield;
        setShow(true);
        setCount(1);
      });
      const done = run();
      flush();
      await tick();
      await done;
      await tick();

      expect(errors).toEqual([]);
      expect(log.slice(-2)).toEqual(["latest:1", "cond:branch"]);
      dispose();
    });
  }
});
