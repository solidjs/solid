import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
  onCleanup
} from "../src/index.js";

describe("a failed async comparator releases unobserved lazy readers", () => {
  it.each(["fulfillment", "rejection", "comparator"] as const)(
    "%s settles the flight's observation lifecycle",
    async outcome => {
      let resolve!: (value: number) => void;
      let reject!: (error: unknown) => void;
      const flight = new Promise<number>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const marker = new Error("failed outcome");
      let cleaned = 0;
      let released = 0;
      let setPhase!: (value: number) => void;
      let stopObserving!: () => void;
      const dispose = createRoot(stop => {
        const [phase, writePhase] = createSignal(0);
        setPhase = writePhase;
        const [input] = createSignal(0, { unobserved: () => released++ });
        const source = createMemo(() => (phase() ? flight : 1), {
          equals: (previous, next) => {
            if (outcome === "comparator") throw marker;
            return previous === next;
          }
        });
        const lazy = createMemo(
          () => {
            input();
            onCleanup(() => cleaned++);
            return source() + 1;
          },
          { lazy: true }
        );
        stopObserving = createRoot(disposeObserver => {
          createEffect(lazy, () => {});
          return disposeObserver;
        });
        return stop;
      });
      try {
        flush();
        setPhase(1);
        flush();
        stopObserving();
        flush();
        // The pending request temporarily stands in for the lost observer.
        expect(cleaned).toBe(0);
        expect(released).toBe(0);

        outcome === "rejection" ? reject(marker) : resolve(2);
        await new Promise<void>(done => setTimeout(done, 0));
        flush();
        // Terminal failure and success both retire that observation.
        expect(cleaned).toBe(1);
        expect(released).toBe(1);
      } finally {
        dispose();
        flush();
      }
    }
  );
});
