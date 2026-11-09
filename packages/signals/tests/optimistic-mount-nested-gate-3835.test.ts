/**
 * #3835, the gate form: a memo whose own pass creates the truthiness memo it
 * reads — a component-root ternary compiles to
 * `memo(() => memo(() => !!c)() ? a : b)` — under an action's guess. The
 * mainline pass before the seam creates the new truthiness memo, whose first
 * pass reads the action's staging and publishes it. The flush parks; the
 * guess's lane re-derives that memo to the same value it published, and,
 * with no change, never reaches the gate: the branch the guess opens stayed
 * closed until the action landed. The memo has no screen (its creator's pass
 * is held), so the lane's value is a change (F-11: the guess is the slot's
 * value for the screen). Hoisted, the truthiness memo had a committed value
 * and the lane reached the gate.
 */
import { expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

const sync = { sync: true } as const;
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

for (const shape of ["hoisted", "nested", "nested, not sync"] as const)
  for (const transparent of [false, true])
    it(`a guess opens a ternary branch (${shape}${transparent ? ", transparent effect" : ""})`, async () => {
      const [enabled, setEnabled] = createSignal(false);
      const [visible, setVisible] = createOptimistic(enabled);
      let release!: () => void;
      const run = action(function* () {
        setEnabled(true);
        setVisible(true);
        yield new Promise<void>(r => (release = r));
      });
      const frames: unknown[] = [];
      const dispose = createRoot(d => {
        let out: () => unknown;
        if (shape === "hoisted") {
          const c = createMemo(() => !!visible(), sync);
          out = () => (c() ? "child" : undefined);
        } else {
          const opts = shape === "nested" ? sync : undefined;
          out = createMemo(
            () => (createMemo(() => !!visible(), opts)() ? "child" : undefined),
            opts
          );
        }
        createRenderEffect(
          () => out(),
          v => void frames.push(v),
          transparent ? { transparent: true, sync: true } : undefined
        );
        return d;
      });
      try {
        flush();
        const p = run();
        flush();
        await settle();
        const held = frames.at(-1);
        release();
        await p;
        await settle();
        expect([frames[0], held, frames.at(-1)]).toEqual([undefined, "child", "child"]);
      } finally {
        dispose();
      }
    });
