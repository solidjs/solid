/**
 * #4776. A memo over `latest()` read only by the screen is display (D-25,
 * ruled 2026-11-12): a memo consuming it shows what the same reads inline
 * show, and what a guess in its place shows — the ahead value beside the
 * held `filter`. Nothing of the hold's own reads `pair`, so it is not the
 * hold's work (the #4544 branch is the case that is: see
 * verdict-memo-held-branch-4544).
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

describe("#4776: a memo over latest() only the screen reads", () => {
  for (const source of ["latest", "guess"] as const)
    for (const form of ["memo", "inline"] as const)
      it(`shows the ahead value beside the held write (${source}, ${form})`, async () => {
        let shown = "";
        let run!: () => any;
        createRoot(() => {
          const [id, setId] = createSignal(1);
          const [guess, setGuess] = createOptimistic(1);
          const [filter, setFilter] = createSignal(0);
          const ahead = source === "latest" ? () => latest(id) : guess;
          const proposed = createMemo(ahead);
          const pair =
            form === "memo"
              ? createMemo(() => `${proposed()} / ${filter()}`)
              : createMemo(() => `${ahead()} / ${filter()}`);
          createRenderEffect(
            () => `${proposed()} | ${pair()}`,
            v => void (shown = v)
          );
          run = action(function* () {
            if (source === "latest") setId(2);
            else setGuess(2);
            setFilter(1);
            yield new Promise(() => {});
          });
        });
        flush();
        expect(shown).toBe("1 | 1 / 0");
        run();
        flush();
        await tick();
        expect(shown).toBe("2 | 2 / 0");
      });
});
