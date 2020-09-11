import { createSignal, createComputed } from "solid-js";

export function delay<T>(timeMs: number): (v: () => T) => () => T;
export function delay<T>(input: () => T, timeMs: number): () => T;
export function delay<T>(input: any, timeMs?: number): any {
  if (arguments.length === 1) {
    timeMs = input;
    return delay;
  }
  return delay(input);

  function delay(input: () => T) {
    const [s, set] = createSignal();
    createComputed(() => {
      const value = input();
      setTimeout(() => set(value), timeMs);
    });
    return s;
  }
}
