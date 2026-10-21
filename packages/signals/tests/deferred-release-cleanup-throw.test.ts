import { expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  onCleanup
} from "../src/index.js";

// #4164 defers last-reader releases while an unfinished pass's frame is
// dismantled. A cleanup throw must not leave that collector installed for
// later, unrelated disposal.
it.each([false, true])(
  "a cleanup throw does not suppress unrelated lazy cleanup (throws: %s)",
  throws => {
    const failure = new Error("cleanup failed");
    const [version, setVersion] = createSignal(0);
    const disposePending = createRoot(dispose => {
      createMemo(() => {
        const v = version();
        onCleanup(() => {
          if (throws && v === 0) throw failure;
        });
        return new Promise<number>(() => {});
      });
      return dispose;
    });
    let disposeOther: (() => void) | undefined;
    try {
      flush();
      setVersion(1);
      if (throws) expect(() => flush()).toThrow(failure);
      else expect(() => flush()).not.toThrow();

      let cleaned = 0;
      let stop!: () => void;
      disposeOther = createRoot(dispose => {
        const value = createMemo(
          () => {
            onCleanup(() => cleaned++);
            return 1;
          },
          { lazy: true }
        );
        stop = createRoot(dispose => {
          createRenderEffect(value, () => {});
          return dispose;
        });
        return dispose;
      });
      flush();
      stop();
      flush();
      // Its owner is still alive: losing the last observer releases it.
      expect(cleaned).toBe(1);
    } finally {
      disposeOther?.();
      disposePending();
      flush();
    }
  }
);

// A lazy node the dismantled frame's children released before the throw is
// still released: the throw no longer skips the drain at the end of the pass
// (the teardown is nested in the pass, and the flush rethrows when it ends).
it("a cleanup throw still releases lazy nodes collected before it", () => {
  const failure = new Error("cleanup failed");
  const [version, setVersion] = createSignal(0);
  let cleaned = 0;
  const dispose = createRoot(dispose => {
    const lazy = createMemo(
      () => {
        onCleanup(() => cleaned++);
        return 1;
      },
      { lazy: true }
    );
    createMemo(() => {
      if (version() === 0) {
        createMemo(() => lazy());
        onCleanup(() => {
          throw failure;
        });
      }
      return new Promise<number>(() => {});
    });
    return dispose;
  });
  try {
    flush();
    setVersion(1);
    expect(() => flush()).toThrow(failure);
    expect(cleaned).toBe(1);
  } finally {
    dispose();
    flush();
  }
});
