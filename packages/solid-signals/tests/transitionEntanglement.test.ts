// Graph:
//   S1 ──> A1 (async) ──> O1 (createOptimistic) ──┐
//                                                  └─> M1 (memo) ──> E1 (renderEffect)
//   S2 ─────────────────────────────────────────────┘
//
// S1 and S2 are written in the same flush as an optimistic override on O1.
// A1 is the async boundary that pushes work into a transition. A1 reads S1
// as an async driver — it must see the latest S1 to fetch correctly.
// O1 speculates a value. M1 combines O1 and S2. E1 observes M1.
//
// Under Option A (observer-posture entanglement):
//   Observers (memos, effects, any non-driver) of a plain signal written
//   during a transition with optimistic + pending async read the signal's
//   committed value. Optimistic overrides still show their optimistic value.
//   Drivers (async-producing computations) read latest.
//
//   This produces an observable optimistic+entangled projection
//   mid-transition. At commit, plain signals flip to their pending values,
//   optimistic overrides collapse to committed values, and observers run
//   again with the final committed pair.
//
// Shape A — optimistic O1 write DIFFERS from committed:
//   mid-transition E1 observes "99:a" (O1 override + S2 entangled)
//   at commit       E1 observes "2:b" (O1 resolved + S2 committed)
//
// Shape B — optimistic O1 write MATCHES committed:
//   mid-transition E1 observes "2:a" (O1 override happens to equal future
//                                     committed, S2 still entangled)
//   at commit       E1 observes "2:b" (S2 flipping drives the re-run)

import {
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

afterEach(() => flush());

describe("createOptimistic + mid-memo + plain-signal entanglement", () => {
  it("Shape A — optimistic O1 DIFFERS from committed: E1 observes 99:a then 2:b", async () => {
    let resolveAsync: (n: number) => void = () => {};
    const [s1, setS1] = createSignal(1);
    const [s2, setS2] = createSignal("a");

    const a1 = createMemo(() => {
      const v = s1();
      return new Promise<number>(res => (resolveAsync = res));
    });

    const e1Values: string[] = [];

    await createRoot(async () => {
      const [o1, setO1] = createOptimistic<number>(() => a1());
      const m1 = createMemo(() => `${o1()}:${s2()}`);

      createRenderEffect(
        () => m1(),
        v => {
          if (v !== undefined) e1Values.push(v);
        }
      );

      flush();
      resolveAsync(1);
      await Promise.resolve();
      flush();

      expect(e1Values.at(-1)).toBe("1:a");
      const baselineLen = e1Values.length;

      // One transition: setS1 drives async; setS2 is entangled plain-signal
      // write; setO1 guesses wrong ("99" vs future committed "2").
      setS1(2);
      setS2("b");
      setO1(99);
      flush();

      expect(e1Values.length).toBe(baselineLen + 1);
      expect(e1Values.at(-1)).toBe("99:a");

      resolveAsync(2);
      await Promise.resolve();
      flush();

      expect(e1Values.at(-1)).toBe("2:b");
      expect(e1Values.length).toBe(baselineLen + 2);
    });
  });

  it("Shape B — optimistic O1 MATCHES committed: E1 observes 2:a then 2:b", async () => {
    let resolveAsync: (n: number) => void = () => {};
    const [s1, setS1] = createSignal(1);
    const [s2, setS2] = createSignal("a");

    const a1 = createMemo(() => {
      const v = s1();
      return new Promise<number>(res => (resolveAsync = res));
    });

    const e1Values: string[] = [];

    await createRoot(async () => {
      const [o1, setO1] = createOptimistic<number>(() => a1());
      const m1 = createMemo(() => `${o1()}:${s2()}`);

      createRenderEffect(
        () => m1(),
        v => {
          if (v !== undefined) e1Values.push(v);
        }
      );

      flush();
      resolveAsync(1);
      await Promise.resolve();
      flush();

      expect(e1Values.at(-1)).toBe("1:a");
      const baselineLen = e1Values.length;

      // Optimistic guess matches committed: A1 will resolve to 2.
      setS1(2);
      setS2("b");
      setO1(2);
      flush();

      expect(e1Values.length).toBe(baselineLen + 1);
      expect(e1Values.at(-1)).toBe("2:a");

      resolveAsync(2);
      await Promise.resolve();
      flush();

      expect(e1Values.at(-1)).toBe("2:b");
      expect(e1Values.length).toBe(baselineLen + 2);
    });
  });
});
