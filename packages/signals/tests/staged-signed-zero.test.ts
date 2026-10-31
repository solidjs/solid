import { describe, expect, it } from "vitest";
import { createMemo, createRenderEffect, createRoot, createSignal, flush } from "../src/index.js";

describe.each([
  ["Object.is", Object.is],
  ["false", false]
] as const)("staged signed zero with equals: %s", (_, equals) => {
  it.each([
    ["-0 to +0", -0, 0],
    ["+0 to -0", 0, -0]
  ] as const)("updates an observed derivation from %s", (_, initial, next) => {
    const { dispose, value, setValue, reciprocal, seen } = createRoot(dispose => {
      const [value, setValue] = createSignal(initial, { equals });
      const reciprocal = createMemo(() => 1 / value());
      const seen: number[] = [];
      createRenderEffect(reciprocal, value => void seen.push(value));
      return { dispose, value, setValue, reciprocal, seen };
    });
    try {
      flush();
      expect(seen).toEqual([1 / initial]);

      setValue(next);
      flush();

      expect(value()).toBe(next);
      expect(reciprocal()).toBe(1 / next);
      expect(seen).toEqual([1 / initial, 1 / next]);
    } finally {
      dispose();
    }
  });
});

it("keeps the default comparator's signed-zero equality", () => {
  const { dispose, value, setValue, reciprocal, seen } = createRoot(dispose => {
    const [value, setValue] = createSignal(-0);
    const reciprocal = createMemo(() => 1 / value());
    const seen: number[] = [];
    createRenderEffect(reciprocal, value => void seen.push(value));
    return { dispose, value, setValue, reciprocal, seen };
  });
  try {
    flush();

    setValue(0);
    flush();

    expect(value()).toBe(-0);
    expect(reciprocal()).toBe(-Infinity);
    expect(seen).toEqual([-Infinity]);
  } finally {
    dispose();
  }
});
