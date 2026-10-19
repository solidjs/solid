/**
 * A writable memo that throws keeps throwing for every later reader. Clearing
 * STATUS_ERROR only happens on a recompute or an async settle, and a direct
 * write deliberately does neither, so the written value commits underneath a
 * node that still reports an error and the memo cannot be recovered.
 *
 * @see https://github.com/solidjs/solid/issues/4110
 */
import { expect, it } from "vitest";
import { createEffect, createRoot, createSignal, flush } from "../src/index.js";

it("a write clears an error the derivation left behind", () => {
  const seen: unknown[] = [];
  const { value, setValue } = createRoot(() => {
    const [failing] = createSignal(true);
    const [value, setValue] = createSignal(() => {
      if (failing()) throw new Error("boom");
      return 1;
    });
    createEffect(() => value(), {
      effect: v => void seen.push({ ok: v }),
      error: e => void seen.push({ err: (e as Error).message })
    });
    return { value, setValue };
  });

  flush();
  expect(seen).toEqual([{ err: "boom" }]);

  setValue(2);
  flush();
  expect(seen).toEqual([{ err: "boom" }, { ok: 2 }]);
  expect(value()).toBe(2);
});

it("a write of the last good value still recovers the memo", () => {
  const { value, setValue, setFailing } = createRoot(() => {
    const [failing, setFailing] = createSignal(false);
    const [value, setValue] = createSignal(() => {
      if (failing()) throw new Error("boom");
      return 1;
    });
    return { value, setValue, setFailing };
  });

  expect(value()).toBe(1);

  setFailing(true);
  flush();
  expect(() => value()).toThrow("boom");

  // equal to the last good value, so the equality gate must not drop it
  setValue(1);
  flush();
  expect(value()).toBe(1);
});
