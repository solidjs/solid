import { describe, expect, test } from "vitest";
import { setFlagsFromString } from "v8";
import { runInNewContext } from "vm";
import { mapArray, indexArray, createSignal, createMemo, createRoot } from "../src/index.js";

describe("Map operator", () => {
  test("simple mapArray", () => {
    createRoot(() => {
      const [s, set] = createSignal([1, 2, 3, 4]),
        r = createMemo(mapArray(s, v => v * 2));
      expect(r()).toEqual([2, 4, 6, 8]);
      set([3, 4, 5]);
      expect(r()).toEqual([6, 8, 10]);
    });
  });

  test("show fallback", () => {
    createRoot(() => {
      const [s, set] = createSignal([1, 2, 3, 4]),
        double = mapArray<number, number | string>(s, v => v * 2, {
          fallback: () => "Empty"
        }),
        r = createMemo(double);
      expect(r()).toEqual([2, 4, 6, 8]);
      set([]);
      expect(r()).toEqual(["Empty"]);
      set([3, 4, 5]);
      expect(r()).toEqual([6, 8, 10]);
    });
  });

  test("a surviving row does not retain removed items", async () => {
    setFlagsFromString("--expose-gc");
    const gc: () => void = runInNewContext("gc");
    const kept = {};
    let removed: WeakRef<object>, set: (v: object[]) => void;
    const dispose = createRoot(dispose => {
      const [s, setS] = createSignal(createItems()),
        r = createMemo(mapArray(s, v => v));
      set = setS;
      r();
      return dispose;
    });
    function createItems() {
      const item = {};
      removed = new WeakRef(item);
      return [kept, item];
    }
    // The row for `kept` was created from the original list.
    set!([kept]);
    // WeakRef targets stay alive until the current job ends.
    await new Promise(r => setTimeout(r, 0));
    gc();
    expect(removed!.deref()).toBeUndefined();
    dispose();
  });
});

describe("Index operator", () => {
  test("simple indexArray", () => {
    createRoot(() => {
      const [s, set] = createSignal([1, 2, 3, 4]),
        r = createMemo(indexArray(s, v => v() * 2));
      expect(r()).toEqual([2, 4, 6, 8]);
    });
  });

  test("show fallback", () => {
    createRoot(() => {
      const [s, set] = createSignal([1, 2, 3, 4]),
        double = indexArray<number, number | string>(s, v => v() * 2, {
          fallback: () => "Empty"
        }),
        r = createMemo(double);
      expect(r()).toEqual([2, 4, 6, 8]);
      set([]);
      expect(r()).toEqual(["Empty"]);
      set([3, 4, 5]);
      expect(r()).toEqual([6, 8, 10]);
    });
  });
});
