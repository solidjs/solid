import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

describe("a direct writable-memo proposal replaces a failed outcome", () => {
  it.each([
    [true, 1],
    [true, 2],
    [false, 1],
    [false, 2]
  ] as const)("failure at creation: %s, manual payload: %s", (initiallyFailed, payload) => {
    let setFail!: (value: boolean) => void;
    let source!: () => number;
    let write!: (value: number) => void;
    let runs = 0;
    const previous: (number | undefined)[] = [];
    const shown: unknown[] = [];
    const marker = new Error("derived failure");
    const dispose = createRoot(stop => {
      const [fail, updateFail] = createSignal(initiallyFailed);
      setFail = updateFail;
      [source, write] = createSignal<number>(prev => {
        runs++;
        previous.push(prev);
        if (fail()) throw marker;
        return prev === undefined ? 1 : prev + 1;
      });
      createEffect(source, {
        effect: value => {
          shown.push(value);
        },
        error: error => {
          shown.push(error);
        }
      });
      return stop;
    });
    try {
      flush();
      if (!initiallyFailed) {
        setFail(true);
        flush();
      }
      expect(() => source()).toThrow("derived failure");
      const beforeWrite = runs;

      write(payload);
      // A28: the staged successful proposal has not replaced the shown failure.
      expect(() => source()).toThrow("derived failure");
      flush();
      expect(source()).toBe(payload);
      expect(shown.at(-1)).toBe(payload);
      expect(runs).toBe(beforeWrite);

      // A source change re-derives over the successful manual payload as prev.
      setFail(false);
      flush();
      expect(previous.at(-1)).toBe(payload);
      expect(source()).toBe(payload + 1);
    } finally {
      dispose();
      flush();
    }
  });

  it("a write to a held failed derivation becomes prev for its recovery", async () => {
    let finish!: (value: number) => void;
    const flight = new Promise<number>(done => (finish = done));
    let source!: () => number;
    let write!: (value: number) => void;
    let setCount!: (value: number) => void;
    const marker = new Error("held failure");
    const shown: unknown[] = [];
    const dispose = createRoot(stop => {
      const [count, updateCount] = createSignal(0);
      setCount = updateCount;
      [source, write] = createSignal<number>(prev => {
        count();
        if (prev !== 7) throw marker;
        return 8;
      });
      const slow = createMemo(() => (count() ? flight : 0));
      createRenderEffect(slow, () => {}, { schedule: true });
      createEffect(source, {
        effect: value => {
          shown.push(value);
        },
        error: error => {
          shown.push(error);
        }
      });
      return stop;
    });
    try {
      flush();
      setCount(1);
      flush();
      write(7);
      flush();
      expect(() => source()).toThrow("held failure");
      expect(shown.at(-1)).toBe(marker);
      finish(1);
      await new Promise<void>(done => setTimeout(done, 0));
      flush();
      // The re-derivation's 8 wins; its successful manual prev=7 never reveals.
      expect(source()).toBe(8);
      expect(shown).toEqual([marker, 8]);
    } finally {
      dispose();
      flush();
    }
  });

  it.each([false, true])(
    "direct proposal during a pending retry, old failure: %s",
    async failed => {
      let finish!: (value: number) => void;
      const flight = new Promise<number>(done => (finish = done));
      let setPhase!: (value: number) => void;
      let source!: () => number;
      let write!: (value: number) => void;
      let runs = 0;
      const marker = new Error("retry failure");
      const shown: unknown[] = [];
      const dispose = createRoot(stop => {
        const [phase, update] = createSignal(0);
        setPhase = update;
        [source, write] = createSignal<number>(() => {
          runs++;
          if (phase()) return flight;
          if (failed) throw marker;
          return 1;
        });
        createEffect(source, {
          effect: value => {
            shown.push(value);
          },
          error: error => {
            shown.push(error);
          }
        });
        return stop;
      });
      try {
        flush();
        setPhase(1);
        flush();
        const beforeWrite = runs;
        write(2);
        flush();
        // Same as a write over a successful pending source: publish the
        // manual answer without pretending its outstanding request settled.
        expect(source()).toBe(2);
        expect(isPending(source)).toBe(true);
        expect(runs).toBe(beforeWrite);
        finish(3);
        await new Promise<void>(done => setTimeout(done, 0));
        flush();
        expect(source()).toBe(3);
        expect(isPending(source)).toBe(false);
        expect(shown.at(-1)).toBe(3);
      } finally {
        dispose();
        flush();
      }
    }
  );
});
