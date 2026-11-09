import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  untrack
} from "../src/index.js";

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

  for (const where of ["in-action", "before-action"] as const)
    for (const strict of [false, true])
      it.each([
        ["-0 to +0", -0, 0],
        ["+0 to -0", 0, -0]
      ] as const)(
        `keeps %s pending until reveal (${where}, strict: ${strict})`,
        async (_, initial, next) => {
          const gate = Promise.withResolvers<void>();
          const state = createRoot(dispose => {
            const [value, setValue] = createSignal(initial, { equals });
            const [other, setOther] = createSignal(0);
            const plain: [number, boolean][] = [];
            const ahead: [boolean, number][] = [];
            createRenderEffect(other, () => {});
            createRenderEffect(
              () => {
                value();
                const v = strict ? untrack(value, "signed-zero") : value();
                return [1 / v, isPending(value)] as [number, boolean];
              },
              v => void plain.push(v)
            );
            createRenderEffect(
              () => [isPending(value), 1 / latest(value)] as [boolean, number],
              v => void ahead.push(v)
            );
            return { dispose, value, setValue, setOther, plain, ahead };
          });
          try {
            flush();
            if (where === "before-action") state.setValue(next);
            action(function* () {
              state.setOther(1);
              if (where === "in-action") state.setValue(next);
              yield gate.promise;
            })();
            flush();

            expect(state.value()).toBe(initial);
            expect(isPending(state.value)).toBe(true);
            expect(state.plain).toEqual([
              [1 / initial, false],
              [1 / initial, true]
            ]);
            expect(state.ahead).toEqual([
              [false, 1 / initial],
              [true, 1 / next]
            ]);

            gate.resolve();
            await new Promise<void>(resolve => setTimeout(resolve, 0));
            flush();

            expect(state.value()).toBe(next);
            expect(isPending(state.value)).toBe(false);
            expect(state.plain).toEqual([
              [1 / initial, false],
              [1 / initial, true],
              [1 / next, false]
            ]);
            expect(state.ahead).toEqual([
              [false, 1 / initial],
              [true, 1 / next],
              [false, 1 / next]
            ]);
          } finally {
            gate.resolve();
            state.dispose();
            flush();
          }
        }
      );
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

it("keeps an accepted NaN rewrite as a proposal", async () => {
  const gate = Promise.withResolvers<void>();
  const state = createRoot(dispose => {
    const [value, setValue] = createSignal(NaN, { equals: false });
    const seen: boolean[] = [];
    createRenderEffect(
      () => isPending(value),
      v => void seen.push(v)
    );
    return { dispose, value, setValue, seen };
  });
  try {
    flush();
    action(function* () {
      state.setValue(NaN);
      yield gate.promise;
    })();
    flush();
    expect(state.seen).toEqual([false, true]);
    expect(isPending(state.value)).toBe(true);

    gate.resolve();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    flush();
    expect(state.seen).toEqual([false, true, false]);
  } finally {
    gate.resolve();
    state.dispose();
    flush();
  }
});
