import {
  untrack,
  createSignal,
  createResource,
  createMemo,
  devComponent,
  $PROXY,
  $DEVCOMP
} from "../reactive/signal";
import { sharedConfig, nextHydrateContext, setHydrateContext } from "./hydration";
import type { JSX } from "../jsx";

let hydrationEnabled = false;
export function enableHydration() {
  hydrationEnabled = true;
}

/**
 * A general `Component` has no implicit `children` prop.  If desired, you can
 * specify one as in `Component<{name: String, children: JSX.Element>}`.
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

/**
 * Takes the props of the passed component and returns its type
 *
 * @example
 * ComponentProps<typeof Portal> // { mount?: Node; useShadow?: boolean; children: JSX.Element }
 * ComponentProps<'div'> // JSX.HTMLAttributes<HTMLDivElement>
 */
export type ComponentProps<T extends keyof JSX.IntrinsicElements | Component<any>> =
  T extends Component<infer P>
    ? P
    : T extends keyof JSX.IntrinsicElements
    ? JSX.IntrinsicElements[T]
    : {};

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

type Override<T, U> = T extends any
  ? U extends any
    ? {
        [K in keyof T]: K extends keyof U
          ? undefined extends U[K]
            ? Exclude<U[K], undefined> | T[K]
            : U[K]
          : T[K];
      } & {
        [K in keyof U]: K extends keyof T
          ? undefined extends U[K]
            ? Exclude<U[K], undefined> | T[K]
            : U[K]
          : U[K];
      }
    : T & U
  : T & U;

export type MergeProps<T extends unknown[], Curr = {}> = T extends [
  infer Next | (() => infer Next),
  ...infer Rest
]
  ? MergeProps<Rest, Override<Curr, Next>>
  : Curr;

function resolveSource(s: any) {
  return (s = typeof s === "function" ? s() : s) == null ? {} : s;
}

export function mergeProps<T extends [unknown, ...unknown[]]>(...sources: T): MergeProps<T> {
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

export type SplitProps<T, K extends (readonly (keyof T)[])[]> = [
  ...{
    [P in keyof K]: P extends `${number}`
      ? Pick<T, Extract<K[P], readonly (keyof T)[]>[number]>
      : never;
  },
  Omit<T, K[number][number]>
];

export function splitProps<T, K extends [readonly (keyof T)[], ...(readonly (keyof T)[])[]]>(
  props: T,
  ...keys: K
): SplitProps<T, K> {
  const blocked = new Set<keyof T>(keys.flat());
  const descriptors = Object.getOwnPropertyDescriptors(props);
  const res = keys.map(k => {
    const clone = {};
    for (let i = 0; i < k.length; i++) {
      const key = k[i];
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
              }
            }
      );
    }
    return clone;
  });
  res.push(
    new Proxy(
      {
        get(property: string | number | symbol) {
          return blocked.has(property as keyof T) ? undefined : props[property as keyof T];
        },
        has(property: string | number | symbol) {
          return blocked.has(property as keyof T) ? false : property in props;
        },
        keys() {
          return Object.keys(props).filter(k => !blocked.has(k as keyof T));
        }
      },
      propTraps
    )
  );
  return res as SplitProps<T, K>;
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
    } else {
      const c = comp();
      if (c) return c(props);
    }
    let Comp: T | undefined;
    return createMemo(
      () =>
        (Comp = comp()) &&
        untrack(() => {
          if ("_SOLID_DEV_") Object.assign(Comp, { [$DEVCOMP]: true });
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
