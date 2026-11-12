/**
 * #4778. A sync memo over `isPending(id)` read by the display and by an
 * async derivation is read by both: one version per node, so it is the
 * hold's (D-25, ruled 2026-11-12; #3905 out of scope). The async asks once,
 * of the truth, as it does reading `isPending` inline (S-51, F-2's producer
 * clause: the display shows, it never asks), and the display behind the
 * memo shows the hold's answer.
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
  it("an async derivation asks of the truth inline or through a sync memo; the shared memo is the hold's", async () => {
    let run!: () => any;
    const shown: Record<string, string> = {};
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
        v => void (shown.all = v)
      );
      run = action(function* () {
        setId(1);
        yield new Promise(() => {});
      });
    });
    flush();
    await tick();
    expect(shown.all).toBe("false false false");
    run();
    flush();
    await tick();
    // Both ask of the truth (S-51): in the hold's world `id` is final.
    expect(asked).toEqual({ direct: [false, false], wrapped: [false, false] });
    expect(shown.all).toBe("false false false");
  });
});
