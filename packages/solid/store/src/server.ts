import { SetStoreFunction, Store } from "store";

export const $RAW = Symbol("state-raw");

export function isWrappable(obj: any) {
  return (
    obj != null &&
    typeof obj === "object" &&
    (obj.__proto__ === Object.prototype || Array.isArray(obj))
  );
}

export function unwrap<T>(item: any): T {
  return item;
}

export function setProperty(state: any, property: string | number, value: any, force?: boolean) {
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

export function updatePath(current: any, path: any[], traversed: (number | string)[] = []) {
  let part,
    next = current;
  if (path.length > 1) {
    part = path.shift();
    const partType = typeof part,
      isArray = Array.isArray(current);

    if (Array.isArray(part)) {
      // Ex. update('data', [2, 23], 'label', l => l + ' !!!');
      for (let i = 0; i < part.length; i++) {
        updatePath(current, [part[i]].concat(path), [part[i]].concat(traversed));
      }
      return;
    } else if (isArray && partType === "function") {
      // Ex. update('data', i => i.id === 42, 'label', l => l + ' !!!');
      for (let i = 0; i < current.length; i++) {
        if (part(current[i], i))
          updatePath(current, [i].concat(path), ([i] as (number | string)[]).concat(traversed));
      }
      return;
    } else if (isArray && partType === "object") {
      // Ex. update('data', { from: 3, to: 12, by: 2 }, 'label', l => l + ' !!!');
      const { from = 0, to = current.length - 1, by = 1 } = part;
      for (let i = from; i <= to; i += by) {
        updatePath(current, [i].concat(path), ([i] as (number | string)[]).concat(traversed));
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
  function setStore(...args: any[]): void {
    updatePath(state, args);
  }
  return [state as Store<T>, setStore];
}

export function createMutable<T>(state: T | Store<T>): Store<T> {
  return state as Store<T>;
}

type ReconcileOptions = {
  key?: string | null;
  merge?: boolean;
};

// Diff method for setStore
export function reconcile<T>(
  value: T | Store<T>,
  options: ReconcileOptions = {}
): (state: Store<T>) => void {
  return state => {
    if (!isWrappable(state)) return value;
    const targetKeys = Object.keys(value) as (keyof T)[];
    for (let i = 0, len = targetKeys.length; i < len; i++) {
      const key = targetKeys[i];
      setProperty(state, key as string, value[key]);
    }
    const previousKeys = Object.keys(state as object) as (keyof T)[];
    for (let i = 0, len = previousKeys.length; i < len; i++) {
      if (value[previousKeys[i]] === undefined)
        setProperty(state, previousKeys[i] as string, undefined);
    }
  };
}

// Immer style mutation style
export function produce<T>(fn: (state: T) => void): (state: Store<T>) => Store<T> {
  return state => {
    if (isWrappable(state)) fn(state as T);
    return state;
  };
}
