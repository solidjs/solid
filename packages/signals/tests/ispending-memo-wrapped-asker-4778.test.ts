/**
 * #4778. A sync memo over `isPending(id)` read by the display and by an
 * async derivation. A pass that asks is a display-ahead reader like a sync
 * one (F-6, S-51 as re-ruled 2026-11-12): reading `isPending(id)` inline or
 * through the memo, the async derivation runs on the screen with the
 * probe's answer — it asks `true` and shows it beside the memo's `true`,
 * whole (F-1, D-23) — and asks again on the landed world at the landing.
 * Before, the async asked of the truth (`false`) and showed its stale
 * answer beside the display's `true`.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

describe("#4778", () => {
  it("an async derivation reads isPending ahead, inline or through a sync memo, as the display does", async () => {
    let run!: () => any;
    const gate = Promise.withResolvers<void>();
    const shown: string[] = [];
    const asked: Record<string, boolean[]> = { direct: [], wrapped: [] };
    createRoot(() => {
      const [id, setId] = createSignal(0);
      const pending = createMemo(() => isPending(id));
      const direct = createMemo(async () => {
        const v = isPending(id);
        asked.direct.push(v);
        await Promise.resolve();
        return String(v);
      });
      const wrapped = createMemo(async () => {
        const v = pending();
        asked.wrapped.push(v);
        await Promise.resolve();
        return String(v);
      });
      createRenderEffect(
        () => [String(pending()), direct(), wrapped()].join(" "),
        // (An effect has no comparator: a run that repeats the text shows nothing.)
        v => void (shown.at(-1) !== v && shown.push(v))
      );
      run = action(function* () {
        setId(1);
        yield gate.promise;
      });
    });
    flush();
    await tick();
    expect(shown).toEqual(["false false false"]);
    run();
    flush();
    await tick();
    // Both ask of the screen: `id` is pending there (F-6).
    expect(asked).toEqual({ direct: [false, true], wrapped: [false, true] });
    expect(shown).toEqual(["false false false", "true true true"]);
    gate.resolve();
    await tick();
    // The landing asks again on the landed world; the commit shows whole.
    expect(asked).toEqual({ direct: [false, true, false], wrapped: [false, true, false] });
    expect(shown).toEqual(["false false false", "true true true", "false false false"]);
  });
});
