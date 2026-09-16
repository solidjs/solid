/** @vitest-environment node */
import { describe, expect, test } from "vitest";
import { createRoot, createStore } from "../../src/server/index.js";
import { getProjectionTrace } from "../../src/server/signals.js";

describe("shallow SSR projections", () => {
  test("returns frozen leaves without wrapping them", () => {
    const value = Object.freeze({ key: {} });
    createRoot(() => {
      const [state] = createStore(
        draft => {
          expect(draft.value).toBe(value);
          expect(draft.value.key).toBe(value.key);
        },
        { value },
        { shallow: true }
      );
      expect(state.value).toBe(value);
    });
  });

  for (const array of [false, true]) {
    test(`preserves stream leaf identity and the first answer: array=${array}`, async () => {
      const value = Object.freeze({ key: {}, time: new Date(0), missing: undefined, n: NaN });
      const replacement = Object.freeze({ ...value, time: new Date(1) });
      let dispose!: () => void;
      const seed: { [key: number]: typeof value | undefined } = array ? [] : { 0: undefined };
      const [state] = createRoot(d => {
        dispose = d;
        return createStore(
          async function* (draft) {
            draft[0] = value;
            yield;
            draft[0] = replacement;
            yield;
          },
          seed,
          { shallow: true }
        );
      });
      try {
        for (let i = 0; i < 30; i++) await Promise.resolve();
        expect(state[0]).toBe(value);
        const iterator = getProjectionTrace(state)!.subscribe()[Symbol.asyncIterator]();
        expect((await iterator.next()).value[0]).toBe(value);
        const patch = (await iterator.next()).value;
        expect(patch[0][1]).toBe(replacement);
        expect(state[0]).toBe(value);
        await iterator.return?.();
      } finally {
        dispose();
      }
    });
  }
});
