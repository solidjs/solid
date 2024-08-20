import { RenderEffect } from "./effect";
import { createStore } from "./store";

/**
 * Creates a mutable derived value
 *
 * @see {@link https://github.com/solidjs/x-reactivity#createprojection}
 */
export function createProjection<T extends Object>(fn: (draft: T) => void, initialValue: T, options?: { name?: string }) {
  const [store, setStore] = createStore(initialValue);
  // unsafe implementation
  new RenderEffect<T | undefined>(
    undefined,
    () => setStore(fn) as any,
    () => {},
    __DEV__ ? { name: options?.name } : undefined,
  );
  return store;
}