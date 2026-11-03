/**
 * #4640: an error boundary built outside (`untrack`) over an async memo;
 * the boundary's output is read by a render effect, directly or through a
 * memo, in the open or under a `<Loading>` without `on`. The first ask
 * answers "A"; a write starts a held change; the second ask rejects.
 *
 * The rejection is the boundary's: it shows its fallback, and nothing halts
 * (F-12, D-39). A memo is not a reader in its own right — it counts only
 * through the render effect that reads it, wherever it was created
 * (Vocabulary "Reader"; F-3: "where the memo was created does not matter"),
 * so every shape shows the same frames. The memo over the output read the
 * output, not the staged error (D-41: only "a derivation that reads a staged
 * error throws it"), yet the settle walk from the rejected source marked it
 * with the staging through the output it does not mark; the commit then
 * published the error on the memo, past the boundary, and halted.
 */
import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let k = 0; k < 4; k++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

it.each([
  ["direct", "open"],
  ["memo", "open"],
  ["direct", "loading"],
  ["memo", "loading"]
] as const)(
  "a held rejection under an error boundary built outside shows its fallback (%s, %s)",
  async (between, place) => {
    const asks: { res: (v: string) => void; rej: (e: unknown) => void }[] = [];
    const frames: unknown[] = [];
    const [sel, setSel] = createSignal(3);
    const dispose = createRoot(d => {
      const detail = createMemo(() => {
        sel();
        return new Promise<string>((res, rej) => asks.push({ res, rej }));
      });
      const shown = untrack(() =>
        createErrorBoundary(
          () => detail(),
          () => "ERR"
        )
      );
      const t = between === "memo" ? createMemo(() => shown()) : shown;
      const view =
        place === "loading"
          ? untrack(() =>
              createLoadingBoundary(
                () => t(),
                () => "fb"
              )
            )
          : t;
      createRenderEffect(
        () => view(),
        v => void frames.push(v)
      );
      return d;
    });
    // The first load: the root attach waits for it in the open (D-6); a
    // fresh <Loading> shows its fallback (F-4).
    const first = place === "loading" ? ["fb", "A"] : ["A"];
    try {
      await tick();
      asks.shift()!.res("A");
      await tick();
      expect(frames).toEqual(first);

      setSel(1);
      flush();
      await tick();
      // Held: the screen keeps what it showed.
      expect(frames).toEqual(first);

      asks.shift()!.rej(new Error("boom"));
      await tick();
      // The boundary's fallback, no halt (an uncaught error fails the run).
      expect(frames).toEqual([...first, "ERR"]);
    } finally {
      dispose();
    }
  }
);
