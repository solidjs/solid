import type { Store, StoreSetter } from "@solidjs/signals";

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
