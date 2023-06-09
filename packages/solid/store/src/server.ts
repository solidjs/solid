import type { SetStoreFunction, Store } from "./store.js";

export const $RAW = Symbol("state-raw");

export function isWrappable(obj: any) {
  return (
    obj != null &&
    typeof obj === "object" &&
    (Object.getPrototypeOf(obj) === Object.prototype || Array.isArray(obj))
  );
}

export function unwrap<T>(item: T): T {
  return item;
}

export function setProperty(state: any, property: PropertyKey, value: any, force?: boolean) {
  if (!force && state[property] === value) return;
  if (value === undefined) {
    delete state[property];
  } else state[property] = value;
}

function mergeStoreNode(state: any, value: any, force?: boolean) {
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    setProperty(state, key, value[key], force);
  }
}

function updateArray(
  current: any,
  next: Array<any> | Record<string, any> | ((prev: any) => Array<any> | Record<string, any>)
) {
  if (typeof next === "function") next = next(current);
  if (Array.isArray(next)) {
    if (current === next) return;
    let i = 0,
      len = next.length;
    for (; i < len; i++) {
      const value = next[i];
      if (current[i] !== value) setProperty(current, i, value);
    }
    setProperty(current, "length", len);
  } else mergeStoreNode(current, next);
}

export function updatePath(current: any, path: any[], traversed: PropertyKey[] = []) {
  let part,
    next = current;
  if (path.length > 1) {
    part = path.shift();
    const partType = typeof part,
      isArray = Array.isArray(current);

    if (Array.isArray(part)) {
      // Ex. update('data', [2, 23], 'label', l => l + ' !!!');
      for (let i = 0; i < part.length; i++) {
        updatePath(current, [part[i]].concat(path), traversed);
      }
      return;
    } else if (isArray && partType === "function") {
      // Ex. update('data', i => i.id === 42, 'label', l => l + ' !!!');
      for (let i = 0; i < current.length; i++) {
        if (part(current[i], i)) updatePath(current, [i].concat(path), traversed);
      }
      return;
    } else if (isArray && partType === "object") {
      // Ex. update('data', { from: 3, to: 12, by: 2 }, 'label', l => l + ' !!!');
      const { from = 0, to = current.length - 1, by = 1 } = part;
      for (let i = from; i <= to; i += by) {
        updatePath(current, [i].concat(path), traversed);
      }
      return;
    } else if (path.length > 1) {
      updatePath(current[part], path, [part].concat(traversed));
      return;
    }
    next = current[part];
    traversed = [part].concat(traversed);
  }
  let value = path[0];
  if (typeof value === "function") {
    value = value(next, traversed);
    if (value === next) return;
  }
  if (part === undefined && value == undefined) return;
  if (part === undefined || (isWrappable(next) && isWrappable(value) && !Array.isArray(value))) {
    mergeStoreNode(next, value);
  } else setProperty(current, part, value);
}

export function createStore<T>(state: T | Store<T>): [Store<T>, SetStoreFunction<T>] {
  const isArray = Array.isArray(state);
  function setStore(...args: any[]): void {
    isArray && args.length === 1 ? updateArray(state, args[0]) : updatePath(state, args);
  }
  return [state as Store<T>, setStore];
}

export function createMutable<T>(state: T | Store<T>): T {
  return state as T;
}

type ReconcileOptions = {
  key?: string | null;
  merge?: boolean;
};

// Diff method for setStore
export function reconcile<T extends U, U extends object>(
  value: T,
  options: ReconcileOptions = {}
): (state: U) => T {
  return state => {
    if (!isWrappable(state) || !isWrappable(value)) return value;
    const targetKeys = Object.keys(value) as (keyof T)[];
    for (let i = 0, len = targetKeys.length; i < len; i++) {
      const key = targetKeys[i];
      setProperty(state, key, value[key]);
    }
    const previousKeys = Object.keys(state) as (keyof T)[];
    for (let i = 0, len = previousKeys.length; i < len; i++) {
      if (value[previousKeys[i]] === undefined) setProperty(state, previousKeys[i], undefined);
    }
    return state as T;
  };
}

// Immer style mutation style
export function produce<T>(fn: (state: T) => void): (state: T) => T {
  return state => {
    if (isWrappable(state)) fn(state);
    return state;
  };
}

export const DEV = undefined;
