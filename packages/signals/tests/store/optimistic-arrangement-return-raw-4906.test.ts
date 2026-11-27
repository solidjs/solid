import { expect, it } from "vitest";
import { createOptimisticStore, createRoot, flush } from "../../src/index.js";

// A derive that writes a row and then returns the store's own raw value: the
// return is the answer, over the write.
it("a derive's return of the raw list answers over its own draft write", () => {
  const value = Object.freeze({ a: 1 });
  const seed = [value];
  const [state] = createRoot(() =>
    createOptimisticStore(
      (draft: any) => {
        draft[0] = Object.freeze({ a: 2 });
        return seed;
      },
      seed as any,
      { shallow: true } as any
    )
  );
  flush();
  expect(state[0]).toBe(value);
});
