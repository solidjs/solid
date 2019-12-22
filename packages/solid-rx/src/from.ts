import { createSignal, onCleanup } from "solid-js";

export function from<T>(fn: (setter: (v: T) => void) => (() => void) | void) {
  const [s, set] = createSignal<T>(),
    disposer = fn(set);
  if (disposer) onCleanup(disposer);
  return s;
}
