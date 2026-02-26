import { isWrappable, type NotWrappable } from "./store.js";

type W<T> = Exclude<T, NotWrappable>;

type KeyOf<T> = number extends keyof T
  ? 0 extends 1 & T
    ? keyof T
    : [T] extends [never]
      ? never
      : [T] extends [readonly unknown[]]
        ? number
        : keyof T
  : keyof T;

export type CustomPartial<T> = T extends readonly unknown[]
  ? "0" extends keyof T
    ? { [K in Extract<keyof T, `${number}`>]?: T[K] }
    : { [x: number]: T[number] }
  : Partial<T>;

export type StorePathRange = { from?: number; to?: number; by?: number };

export type ArrayFilterFn<T> = (item: T, index: number) => boolean;

export type PathSetter<T> =
  | T
  | CustomPartial<T>
  | ((prev: T) => T | CustomPartial<T>)
  | typeof DELETE;

export type Part<T, K extends KeyOf<T> = KeyOf<T>> =
  | K
  | ([K] extends [never] ? never : readonly K[])
  | ([T] extends [readonly unknown[]] ? ArrayFilterFn<T[number]> | StorePathRange : never);

const DELETE = Symbol(__DEV__ ? "STORE_PATH_DELETE" : 0);

function updatePath(current: any, args: any[], i = 0) {
  let part: any,
    prev = current;
  if (i < args.length - 1) {
    part = args[i];
    const partType = typeof part;
    const isArray = Array.isArray(current);

    if (Array.isArray(part)) {
      for (let j = 0; j < part.length; j++) {
        args[i] = part[j];
        updatePath(current, args, i);
      }
      args[i] = part;
      return;
    } else if (isArray && partType === "function") {
      for (let j = 0; j < current.length; j++) {
        if (part(current[j], j)) {
          args[i] = j;
          updatePath(current, args, i);
        }
      }
      args[i] = part;
      return;
    } else if (isArray && partType === "object") {
      const { from = 0, to = current.length - 1, by = 1 } = part;
      for (let j = from; j <= to; j += by) {
        args[i] = j;
        updatePath(current, args, i);
      }
      args[i] = part;
      return;
    } else if (i < args.length - 2) {
      updatePath(current[part], args, i + 1);
      return;
    }
    prev = current[part];
  }
  let value = args[args.length - 1];
  if (typeof value === "function") {
    value = value(prev);
    if (value === prev) return;
  }
  if (part === undefined && value == undefined) return;
  if (value === DELETE) {
    delete current[part];
  } else if (
    part === undefined ||
    (isWrappable(prev) && isWrappable(value) && !Array.isArray(value))
  ) {
    const target = part !== undefined ? current[part] : current;
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) target[keys[i]] = value[keys[i]];
  } else {
    current[part] = value;
  }
}

export interface storePath {
  DELETE: typeof DELETE;

  <
    T,
    K1 extends KeyOf<W<T>>,
    K2 extends KeyOf<W<W<T>[K1]>>,
    K3 extends KeyOf<W<W<W<T>[K1]>[K2]>>,
    K4 extends KeyOf<W<W<W<W<T>[K1]>[K2]>[K3]>>,
    K5 extends KeyOf<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>>,
    K6 extends KeyOf<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>>,
    K7 extends KeyOf<W<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>[K6]>>
  >(
    k1: Part<W<T>, K1>,
    k2: Part<W<W<T>[K1]>, K2>,
    k3: Part<W<W<W<T>[K1]>[K2]>, K3>,
    k4: Part<W<W<W<W<T>[K1]>[K2]>[K3]>, K4>,
    k5: Part<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>, K5>,
    k6: Part<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>, K6>,
    k7: Part<W<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>[K6]>, K7>,
    setter: PathSetter<W<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>[K6]>[K7]>
  ): (state: T) => void;

  <
    T,
    K1 extends KeyOf<W<T>>,
    K2 extends KeyOf<W<W<T>[K1]>>,
    K3 extends KeyOf<W<W<W<T>[K1]>[K2]>>,
    K4 extends KeyOf<W<W<W<W<T>[K1]>[K2]>[K3]>>,
    K5 extends KeyOf<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>>,
    K6 extends KeyOf<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>>
  >(
    k1: Part<W<T>, K1>,
    k2: Part<W<W<T>[K1]>, K2>,
    k3: Part<W<W<W<T>[K1]>[K2]>, K3>,
    k4: Part<W<W<W<W<T>[K1]>[K2]>[K3]>, K4>,
    k5: Part<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>, K5>,
    k6: Part<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>, K6>,
    setter: PathSetter<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>[K6]>
  ): (state: T) => void;

  <
    T,
    K1 extends KeyOf<W<T>>,
    K2 extends KeyOf<W<W<T>[K1]>>,
    K3 extends KeyOf<W<W<W<T>[K1]>[K2]>>,
    K4 extends KeyOf<W<W<W<W<T>[K1]>[K2]>[K3]>>,
    K5 extends KeyOf<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>>
  >(
    k1: Part<W<T>, K1>,
    k2: Part<W<W<T>[K1]>, K2>,
    k3: Part<W<W<W<T>[K1]>[K2]>, K3>,
    k4: Part<W<W<W<W<T>[K1]>[K2]>[K3]>, K4>,
    k5: Part<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>, K5>,
    setter: PathSetter<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>
  ): (state: T) => void;

  <
    T,
    K1 extends KeyOf<W<T>>,
    K2 extends KeyOf<W<W<T>[K1]>>,
    K3 extends KeyOf<W<W<W<T>[K1]>[K2]>>,
    K4 extends KeyOf<W<W<W<W<T>[K1]>[K2]>[K3]>>
  >(
    k1: Part<W<T>, K1>,
    k2: Part<W<W<T>[K1]>, K2>,
    k3: Part<W<W<W<T>[K1]>[K2]>, K3>,
    k4: Part<W<W<W<W<T>[K1]>[K2]>[K3]>, K4>,
    setter: PathSetter<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>
  ): (state: T) => void;

  <
    T,
    K1 extends KeyOf<W<T>>,
    K2 extends KeyOf<W<W<T>[K1]>>,
    K3 extends KeyOf<W<W<W<T>[K1]>[K2]>>
  >(
    k1: Part<W<T>, K1>,
    k2: Part<W<W<T>[K1]>, K2>,
    k3: Part<W<W<W<T>[K1]>[K2]>, K3>,
    setter: PathSetter<W<W<W<T>[K1]>[K2]>[K3]>
  ): (state: T) => void;

  <T, K1 extends KeyOf<W<T>>, K2 extends KeyOf<W<W<T>[K1]>>>(
    k1: Part<W<T>, K1>,
    k2: Part<W<W<T>[K1]>, K2>,
    setter: PathSetter<W<W<T>[K1]>[K2]>
  ): (state: T) => void;

  <T, K1 extends KeyOf<W<T>>>(
    k1: Part<W<T>, K1>,
    setter: PathSetter<W<T>[K1]>
  ): (state: T) => void;

  <T>(setter: PathSetter<T>): (state: T) => void;
}

export const storePath: storePath = Object.assign(
  function storePath(...args: any[]) {
    return (state: any) => {
      updatePath(state, args);
    };
  },
  { DELETE } as { DELETE: typeof DELETE }
);
