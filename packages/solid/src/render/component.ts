import {
  untrack,
  createSignal,
  createResource,
  createMemo,
  devComponent,
  $PROXY,
  $DEVCOMP,
  EffectFunction
} from "../reactive/signal.js";
import { sharedConfig, nextHydrateContext, setHydrateContext } from "./hydration.js";
import type { JSX } from "../jsx.js";

let hydrationEnabled = false;
export function enableHydration() {
  hydrationEnabled = true;
}

/**
 * A general `Component` has no implicit `children` prop.  If desired, you can
 * specify one as in `Component<{name: String, children: JSX.Element}>`.
 */
export type Component<P = {}> = (props: P) => JSX.Element;

/**
 * Extend props to forbid the `children` prop.
 * Use this to prevent accidentally passing `children` to components that
 * would silently throw them away.
 */
export type VoidProps<P = {}> = P & { children?: never };
/**
 * `VoidComponent` forbids the `children` prop.
 * Use this to prevent accidentally passing `children` to components that
 * would silently throw them away.
 */
export type VoidComponent<P = {}> = Component<VoidProps<P>>;

/**
 * Extend props to allow an optional `children` prop with the usual
 * type in JSX, `JSX.Element` (which allows elements, arrays, functions, etc.).
 * Use this for components that you want to accept children.
 */
export type ParentProps<P = {}> = P & { children?: JSX.Element };
/**
 * `ParentComponent` allows an optional `children` prop with the usual
 * type in JSX, `JSX.Element` (which allows elements, arrays, functions, etc.).
 * Use this for components that you want to accept children.
 */
export type ParentComponent<P = {}> = Component<ParentProps<P>>;

/**
 * Extend props to require a `children` prop with the specified type.
 * Use this for components where you need a specific child type,
 * typically a function that receives specific argument types.
 * Note that all JSX <Elements> are of the type `JSX.Element`.
 */
export type FlowProps<P = {}, C = JSX.Element> = P & { children: C };
/**
 * `FlowComponent` requires a `children` prop with the specified type.
 * Use this for components where you need a specific child type,
 * typically a function that receives specific argument types.
 * Note that all JSX <Elements> are of the type `JSX.Element`.
 */
export type FlowComponent<P = {}, C = JSX.Element> = Component<FlowProps<P, C>>;

/** @deprecated: use `ParentProps` instead */
export type PropsWithChildren<P = {}> = ParentProps<P>;

export type ValidComponent = keyof JSX.IntrinsicElements | Component<any> | (string & {});

/**
 * Takes the props of the passed component and returns its type
 *
 * @example
 * ComponentProps<typeof Portal> // { mount?: Node; useShadow?: boolean; children: JSX.Element }
 * ComponentProps<'div'> // JSX.HTMLAttributes<HTMLDivElement>
 */
export type ComponentProps<T extends ValidComponent> = T extends Component<infer P>
  ? P
  : T extends keyof JSX.IntrinsicElements
  ? JSX.IntrinsicElements[T]
  : Record<string, unknown>;

/**
 * Type of `props.ref`, for use in `Component` or `props` typing.
 *
 * @example Component<{ref: Ref<Element>}>
 */
export type Ref<T> = T | ((val: T) => void);

export function createComponent<T>(Comp: Component<T>, props: T): JSX.Element {
  if (hydrationEnabled) {
    if (sharedConfig.context) {
      const c = sharedConfig.context;
      setHydrateContext(nextHydrateContext());
      const r = "_SOLID_DEV_"
        ? devComponent(Comp, props || ({} as T))
        : untrack(() => Comp(props || ({} as T)));
      setHydrateContext(c);
      return r;
    }
  }
  if ("_SOLID_DEV_") return devComponent(Comp, props || ({} as T));
  return untrack(() => Comp(props || ({} as T)));
}

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
type _MergeProps<T extends unknown[], Curr = {}> = T extends [
  infer Next | (() => infer Next),
  ...infer Rest
]
  ? _MergeProps<Rest, Override<Curr, Next>>
  : T extends [...infer Rest, infer Next | (() => infer Next)]
  ? Override<_MergeProps<Rest, Curr>, Next>
  : T extends []
  ? Curr
  : T extends (infer I | (() => infer I))[]
  ? OverrideSpread<Curr, I>
  : Curr;

export type MergeProps<T extends unknown[]> = Simplify<_MergeProps<T>>;

function resolveSource(s: any) {
  return !(s = typeof s === "function" ? s() : s) ? {} : s;
}

export function mergeProps<T extends unknown[]>(...sources: T): MergeProps<T> {
  let proxy = false;
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    proxy = proxy || (!!s && $PROXY in (s as object));
    sources[i] =
      typeof s === "function" ? ((proxy = true), createMemo(s as EffectFunction<unknown>)) : s;
  }
  if (proxy) {
    return new Proxy(
      {
        get(property: string | number | symbol) {
          for (let i = sources.length - 1; i >= 0; i--) {
            const v = resolveSource(sources[i])[property];
            if (v !== undefined) return v;
          }
        },
        has(property: string | number | symbol) {
          for (let i = sources.length - 1; i >= 0; i--) {
            if (property in resolveSource(sources[i])) return true;
          }
          return false;
        },
        keys() {
          const keys = [];
          for (let i = 0; i < sources.length; i++)
            keys.push(...Object.keys(resolveSource(sources[i])));
          return [...new Set(keys)];
        }
      },
      propTraps
    ) as unknown as MergeProps<T>;
  }
  const target = {} as MergeProps<T>;
  for (let i = sources.length - 1; i >= 0; i--) {
    if (sources[i]) {
      const descriptors = Object.getOwnPropertyDescriptors(sources[i]);
      for (const key in descriptors) {
        if (key in target) continue;
        Object.defineProperty(target, key, {
          enumerable: true,
          get() {
            for (let i = sources.length - 1; i >= 0; i--) {
              const v = ((sources[i] as any) || {})[key];
              if (v !== undefined) return v;
            }
          }
        });
      }
    }
  }
  return target;
}

export type SplitProps<T, K extends (readonly (keyof T)[])[]> = [
  ...{
    [P in keyof K]: P extends `${number}`
      ? Pick<T, Extract<K[P], readonly (keyof T)[]>[number]>
      : never;
  },
  Omit<T, K[number][number]>
];

export function splitProps<
  T extends Record<any, any>,
  K extends [readonly (keyof T)[], ...(readonly (keyof T)[])[]]
>(props: T, ...keys: K): SplitProps<T, K> {
  const blocked = new Set<keyof T>(keys.flat());
  const descriptors = Object.getOwnPropertyDescriptors(props);
  const isProxy = $PROXY in props;
  if (isProxy) {
    const res = keys.map(k => {
      return new Proxy(
        {
          get(property) {
            if (k.includes(property) && props[property as any]) {
              return props[property as any];
            }
          },
          has(property) {
            if (k.includes(property) && props[property as any]) {
              return true;
            }
            return false;
          },
          keys() {
            return [...new Set(k.filter(property => props[property]))];
          }
        },
        propTraps
      );
    });
    res.push(
      new Proxy(
        {
          get(property) {
            return blocked.has(property) ? undefined : props[property as any];
          },
          has(property) {
            return blocked.has(property) ? false : property in props;
          },
          keys() {
            return Object.keys(props).filter(k => !blocked.has(k));
          }
        },
        propTraps
      )
    );
    return res as SplitProps<T, K>;
  }
  keys.push(Object.keys(descriptors).filter(k => !blocked.has(k as keyof T)) as (keyof T)[]);
  return keys.map(k => {
    const clone = {};
    for (let i = 0; i < k.length; i++) {
      const key = k[i];
      if (!(key in props)) continue; // skip defining keys that don't exist
      Object.defineProperty(
        clone,
        key,
        descriptors[key]
          ? descriptors[key]
          : {
              get() {
                return props[key];
              },
              set() {
                return true;
              },
              enumerable: true
            }
      );
    }
    return clone;
  }) as SplitProps<T, K>;
}

// lazy load a function component asynchronously
export function lazy<T extends Component<any>>(
  fn: () => Promise<{ default: T }>
): T & { preload: () => Promise<{ default: T }> } {
  let comp: () => T | undefined;
  let p: Promise<{ default: T }> | undefined;
  const wrap: T & { preload?: () => void } = ((props: any) => {
    const ctx = sharedConfig.context;
    if (ctx) {
      const [s, set] = createSignal<T>();
      (p || (p = fn())).then(mod => {
        setHydrateContext(ctx);
        set(() => mod.default);
        setHydrateContext();
      });
      comp = s;
    } else if (!comp) {
      const [s] = createResource<T>(() => (p || (p = fn())).then(mod => mod.default));
      comp = s;
    }
    let Comp: T | undefined;
    return createMemo(
      () =>
        (Comp = comp()) &&
        untrack(() => {
          if ("_SOLID_DEV_") Object.assign(Comp!, { [$DEVCOMP]: true });
          if (!ctx) return Comp!(props);
          const c = sharedConfig.context;
          setHydrateContext(ctx);
          const r = Comp!(props);
          setHydrateContext(c);
          return r;
        })
    );
  }) as T;
  wrap.preload = () => p || ((p = fn()).then(mod => (comp = () => mod.default)), p);
  return wrap as T & { preload: () => Promise<{ default: T }> };
}

let counter = 0;
export function createUniqueId(): string {
  const ctx = sharedConfig.context;
  return ctx ? `${ctx.id}${ctx.count++}` : `cl-${counter++}`;
}
