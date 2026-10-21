// #4184: effects never compare compute values. The effect half (and the
// previous cleanup) runs every time the compute half re-runs, even when the
// compute returns a value equal to the last one. To skip work when the value
// is unchanged, put a memo in front and read it in the compute; the memo's
// `equals` stops propagation, so the effect's compute is never re-run.
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

afterEach(() => flush());

for (const [name, make] of [
  ["createEffect", createEffect],
  ["createRenderEffect", createRenderEffect]
] as const) {
  describe(`${name} with an equal compute value (#4184)`, () => {
    it("re-runs the effect half and its cleanup", () => {
      const [n, setN] = createSignal(1);
      let computes = 0,
        applies = 0,
        cleanups = 0;
      const dispose = createRoot(dispose => {
        make(
          () => (computes++, n() > 0),
          () => {
            applies++;
            return () => {
              cleanups++;
            };
          }
        );
        return dispose;
      });
      flush();
      setN(2);
      flush();
      setN(3);
      flush();
      expect(computes).toBe(3);
      expect(applies).toBe(3);
      expect(cleanups).toBe(2);
      dispose();
    });

    it("skips both when a memo in front absorbs the equal value", () => {
      const [n, setN] = createSignal(1);
      let applies = 0,
        cleanups = 0;
      const dispose = createRoot(dispose => {
        const positive = createMemo(() => n() > 0);
        make(
          () => positive(),
          () => {
            applies++;
            return () => {
              cleanups++;
            };
          }
        );
        return dispose;
      });
      flush();
      setN(2);
      flush();
      setN(3);
      flush();
      expect(applies).toBe(1);
      expect(cleanups).toBe(0);
      setN(-1);
      flush();
      expect(applies).toBe(2);
      expect(cleanups).toBe(1);
      dispose();
    });

    it("a memo with custom equals skips structurally equal values", () => {
      const [user, setUser] = createSignal({ id: 1, name: "a" });
      let applies = 0;
      createRoot(() => {
        const id = createMemo(() => ({ id: user().id }), {
          equals: (a, b) => a.id === b.id
        });
        make(
          () => id(),
          () => {
            applies++;
          }
        );
      });
      flush();
      setUser({ id: 1, name: "b" });
      flush();
      expect(applies).toBe(1);
      setUser({ id: 2, name: "b" });
      flush();
      expect(applies).toBe(2);
    });
  });
}
