import type { Merge, Store, StoreSetter, Omit } from "@solidjs/signals";

export type { NotWrappable, SolidStore, Store, StoreNode, StoreSetter } from "@solidjs/signals";

export function isWrappable(obj: any) {
  return obj != null && typeof obj === "object" && !Object.isFrozen(obj);
}

export function unwrap<T>(item: T): T {
  return item;
}

function setProperty(state: any, property: PropertyKey, value: any) {
  if (state[property] === value) return;
  if (value === undefined) {
    delete state[property];
  } else state[property] = value;
}

export function createStore<T>(state: T | Store<T>): [get: Store<T>, set: StoreSetter<T>] {
  function setStore(fn: (state: T) => void): void {
    fn(state as T);
  }
  return [state as Store<T>, setStore];
}

export function createProjection<T extends Object>(
  fn: (draft: T) => void,
  initialValue: T = {} as T
): Store<T> {
  const [state] = createStore(initialValue);
  fn(state);
  return state;
}

export const createOptimisticStore = createStore;

// Diff method for setStore TODO: Review
export function reconcile<T extends U, U extends object>(value: T): (state: U) => T {
  return state => {
    if (!isWrappable(state) || !isWrappable(value)) return value;
    const targetKeys = Object.keys(value) as (keyof T)[];
    const previousKeys = Object.keys(state) as (keyof T)[];
    for (let i = 0, len = targetKeys.length; i < len; i++) {
      const key = targetKeys[i];
      setProperty(state, key, value[key]);
    }
    for (let i = 0, len = previousKeys.length; i < len; i++) {
      if (value[previousKeys[i]] === undefined) setProperty(state, previousKeys[i], undefined);
    }
    return state as T;
  };
}

export function merge<T extends unknown[]>(...sources: T): Merge<T> {
  const target = {};
  for (let i = 0; i < sources.length; i++) {
    let source = sources[i];
    if (typeof source === "function") source = source();
    if (source) {
      const descriptors = Object.getOwnPropertyDescriptors(source);
      for (const key in descriptors) {
        if (key in target) continue;
        Object.defineProperty(target, key, {
          enumerable: true,
          get() {
            for (let i = sources.length - 1; i >= 0; i--) {
              let v,
                s = sources[i],
                t = typeof s;
              if (t === "function") s = (s as Function)();
              if (t === "object" && t !== null && key in (s as Object)) return v;
            }
          }
        });
      }
    }
  }
  return target as Merge<T>;
}

export function omit<T extends Record<any, any>, K extends readonly (keyof T)[]>(
  props: T,
  ...keys: K
): Omit<T, K> {
  const descriptors = Object.getOwnPropertyDescriptors(props),
    descriptorKeys: (keyof T)[] = Object.keys(descriptors),
    clone: Partial<T> = {};
  for (let i = 0; i < descriptorKeys.length; i++) {
    const key = descriptorKeys[i];
    if (keys.indexOf(key) === -1) {
      Object.defineProperty(clone, key, descriptors[key]);
      delete descriptors[key];
    }
  }
  return clone as unknown as Omit<T, K>;
}

export function deep<T extends object>(store: Store<T>): Store<T> {
  return store;
}
