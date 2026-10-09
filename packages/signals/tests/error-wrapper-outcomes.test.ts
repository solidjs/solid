import { expect, it } from "vitest";
import { createEffect, createMemo, createRoot, createSignal, flush } from "../src/index.js";

const coercionFailure = () => {
  throw new Error("diagnostic coercion must not replace the outcome");
};
const messageGetter = new Error("unused");
Object.defineProperty(messageGetter, "message", { get: coercionFailure });
const messageValue = new Error("unused");
Object.defineProperty(messageValue, "message", { value: { toString: coercionFailure } });

it.each([
  { name: "throwing toString", payload: { toString: coercionFailure } },
  { name: "throwing message getter", payload: messageGetter },
  { name: "throwing message coercion", payload: messageValue }
])("preserves the thrown outcome with $name", ({ payload }) => {
  const [bad, setBad] = createSignal(false);
  const seen: unknown[] = [];
  const dispose = createRoot(d => {
    const source = createMemo(() => {
      if (bad()) throw payload;
      return 1;
    });
    createEffect(source, {
      effect: value => {
        seen.push(value);
      },
      error: error => {
        seen.push(error);
      }
    });
    return d;
  });
  try {
    flush();
    expect(seen).toEqual([1]);
    setBad(true);
    flush();
    expect(seen[1]).toBe(payload);
    setBad(false);
    flush();
    expect(seen[2]).toBe(1);
  } finally {
    dispose();
    flush();
  }
});
