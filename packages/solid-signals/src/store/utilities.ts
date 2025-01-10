import { SUPPORTS_PROXY } from "../core/index.js";
import { createMemo } from "../signals.js";
import { $PROXY } from "./store.js";

function trueFn() {
  return true;
}

const propTraps: ProxyHandler<{
  get: (k: string | number | symbol) => any;
  has: (k: string | number | symbol) => boolean;
  keys: () => string[];
}> = {
  get(_, property, receiver) {
    if (property === $PROXY) return receiver;
    return _.get(property);
  },
  has(_, property) {
    if (property === $PROXY) return true;
    return _.has(property);
  },
  set: trueFn,
  deleteProperty: trueFn,
  getOwnPropertyDescriptor(_, property) {
    return {
      configurable: true,
      enumerable: true,
      get() {
        return _.get(property);
      },
      set: trueFn,
      deleteProperty: trueFn
    };
  },
  ownKeys(_) {
    return _.keys();
  }
};

type DistributeOverride<T, F> = T extends undefined ? F : T;
type Override<T, U> = T extends any
  ? U extends any
    ? {
        [K in keyof T]: K extends keyof U ? DistributeOverride<U[K], T[K]> : T[K];
      } & {
        [K in keyof U]: K extends keyof T ? DistributeOverride<U[K], T[K]> : U[K];
      }
    : T & U
  : T & U;
type OverrideSpread<T, U> = T extends any
  ? {
      [K in keyof ({ [K in keyof T]: any } & { [K in keyof U]?: any } & {
        [K in U extends any ? keyof U : keyof U]?: any;
      })]: K extends keyof T
        ? Exclude<U extends any ? U[K & keyof U] : never, undefined> | T[K]
        : U extends any
          ? U[K & keyof U]
          : never;
    }
  : T & U;
type Simplify<T> = T extends any ? { [K in keyof T]: T[K] } : T;
type _Merge<T extends unknown[], Curr = {}> = T extends [
  infer Next | (() => infer Next),
  ...infer Rest
]
  ? _Merge<Rest, Override<Curr, Next>>
  : T extends [...infer Rest, infer Next | (() => infer Next)]
    ? Override<_Merge<Rest, Curr>, Next>
    : T extends []
      ? Curr
      : T extends (infer I | (() => infer I))[]
        ? OverrideSpread<Curr, I>
        : Curr;

export type Merge<T extends unknown[]> = Simplify<_Merge<T>>;

function resolveSource(s: any) {
  return !(s = typeof s === "function" ? s() : s) ? {} : s;
}

const $SOURCES = Symbol(__DEV__ ? "MERGE_SOURCE" : 0);
export function merge<T extends unknown[]>(...sources: T): Merge<T> {
  if (sources.length === 1 && typeof sources[0] !== "function") return sources[0] as any;
  let proxy = false;
  const flattened: T[] = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    proxy = proxy || (!!s && $PROXY in (s as object));
    const childSources = !!s && (s as object)[$SOURCES];
    if (childSources) flattened.push(...childSources);
    else
      flattened.push(
        typeof s === "function" ? ((proxy = true), createMemo(s as () => any)) : (s as any)
      );
  }
  if (SUPPORTS_PROXY && proxy) {
    return new Proxy(
      {
        get(property: string | number | symbol) {
          if (property === $SOURCES) return flattened;
          for (let i = flattened.length - 1; i >= 0; i--) {
            const s = resolveSource(flattened[i]);
            if (property in s) return s[property];
          }
        },
        has(property: string | number | symbol) {
          for (let i = flattened.length - 1; i >= 0; i--) {
            if (property in resolveSource(flattened[i])) return true;
          }
          return false;
        },
        keys() {
          const keys: Array<string> = [];
          for (let i = 0; i < flattened.length; i++)
            keys.push(...Object.keys(resolveSource(flattened[i])));
          return [...new Set(keys)];
        }
      },
      propTraps
    ) as unknown as Merge<T>;
  }

  const defined: Record<string, PropertyDescriptor> = Object.create(null);
  let nonTargetKey = false;
  let lastIndex = flattened.length - 1;
  for (let i = lastIndex; i >= 0; i--) {
    const source = flattened[i] as Record<string, any>;
    if (!source) {
      i === lastIndex && lastIndex--;
      continue;
    }
    const sourceKeys = Object.getOwnPropertyNames(source);
    for (let j = sourceKeys.length - 1; j >= 0; j--) {
      const key = sourceKeys[j];
      if (key === "__proto__" || key === "constructor") continue;
      if (!defined[key]) {
        nonTargetKey = nonTargetKey || i !== lastIndex;
        const desc = Object.getOwnPropertyDescriptor(source, key)!;
        defined[key] = desc.get
          ? {
              enumerable: true,
              configurable: true,
              get: desc.get.bind(source)
            }
          : desc;
      }
    }
  }
  if (!nonTargetKey) return flattened[lastIndex] as any;
  const target: Record<string, any> = {};
  const definedKeys = Object.keys(defined);
  for (let i = definedKeys.length - 1; i >= 0; i--) {
    const key = definedKeys[i],
      desc = defined[key];
    if (desc.get) Object.defineProperty(target, key, desc);
    else target[key] = desc.value;
  }
  (target as any)[$SOURCES] = flattened;
  return target as any;
}

export type Omit<T, K extends readonly (keyof T)[]> = {
  [P in keyof T as Exclude<P, K[number]>]: T[P];
};

export function omit<T extends Record<any, any>, K extends readonly (keyof T)[]>(
  props: T,
  ...keys: K
): Omit<T, K> {
  const blocked = new Set<keyof T>(keys);
  if (SUPPORTS_PROXY && $PROXY in props) {
    return new Proxy(
      {
        get(property) {
          return blocked.has(property) ? undefined : props[property as any];
        },
        has(property) {
          return !blocked.has(property) && property in props;
        },
        keys() {
          return Object.keys(props).filter(k => !blocked.has(k));
        }
      },
      propTraps
    ) as unknown as Omit<T, K>;
  }
  const result: Record<string, any> = {};

  for (const propName of Object.getOwnPropertyNames(props)) {
    if (!blocked.has(propName)) {
      const desc = Object.getOwnPropertyDescriptor(props, propName)!;
      !desc.get && !desc.set && desc.enumerable && desc.writable && desc.configurable
        ? (result[propName] = desc.value)
        : Object.defineProperty(result, propName, desc);
    }
  }
  return result as any;
}
