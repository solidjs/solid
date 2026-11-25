import { createEffect, createRoot, createSignal, flush, resetErrorHalt } from "../src/index.js";

declare const __DEV__: boolean;

// #5208. An effect whose apply arm returns a non-function value stores that
// value as its cleanup in production. The next run calls `prevCleanup?.()`,
// which throws on a string/number and halts the whole reactive system. The dev
// tier already reports the mistake at the first run; production should at
// least ignore the bad value instead of dying one run later with an opaque
// `TypeError: f is not a function`.
describe("invalid effect cleanup does not halt production (#5208)", () => {
  afterEach(() => {
    flush();
    resetErrorHalt();
  });

  it("keeps later runs alive when the apply arm returns a non-function", () => {
    createRoot(() => {
      const [held, setHeld] = createSignal(false);
      const labels: string[] = [];
      createEffect(
        () => held(),
        value => labels.push(value ? "held" : "free") as unknown as void
      );

      if (__DEV__) {
        // Dev reports the bad cleanup on the first run and halts.
        expect(() => flush()).toThrow("effect callback returned an invalid cleanup value");
      } else {
        expect(() => flush()).not.toThrow();
        setHeld(true);
        expect(() => flush()).not.toThrow();
        setHeld(false);
        expect(() => flush()).not.toThrow();
        expect(labels).toEqual(["free", "held", "free"]);
      }
    });
  });
});
