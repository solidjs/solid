/**
 * #4767 / F-7: `runRefCallback` may serve a born-held memo's staged value only
 * when the ref's creating pass was born into that memo's hold. A ref whose
 * creating pass is outside the hold must keep A19 exc. 1 (NotReadyError).
 */
import { describe, expect, it } from "vitest";
import {
  NotReadyError,
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  runRefCallback
} from "../src/index.js";

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

function heldSignal() {
  const [x, setX] = createSignal(0);
  const pre: number[] = [];
  createRoot(() => {
    createRenderEffect(x, v => {
      pre.push(v);
    });
  });
  flush();
  let release!: () => void;
  action(function* () {
    setX(1);
    yield new Promise<void>(r => (release = r));
  })();
  flush();
  return { x, pre, release };
}

describe("#4767 / F-7: refCallback staged serve is hold-local", () => {
  it("a ref whose creating pass was born into the hold sees the staged value", () => {
    const { x, release } = heldSignal();
    let seen: number | undefined;
    createRoot(() => {
      createMemo(() => {
        x();
        const m = createMemo(() => x());
        runRefCallback(() => {
          seen = m();
        });
        return 0;
      });
    });
    expect(seen).toBe(1);
    release();
  });

  it("a ref outside the hold does not see a born-held memo's staged value", async () => {
    const { x, release } = heldSignal();
    let m!: () => number;
    createRoot(() => {
      m = createMemo(() => x());
    });
    expect(() => m()).toThrow(NotReadyError);

    let outsideSeen: number | "blocked" | undefined;
    createRoot(() => {
      runRefCallback(() => {
        try {
          outsideSeen = m();
        } catch (e) {
          expect(e).toBeInstanceOf(NotReadyError);
          outsideSeen = "blocked";
        }
      });
    });
    expect(outsideSeen).toBe("blocked");

    release();
    await settle();
    expect(m()).toBe(1);
  });
});
