import { untrack, createSignal, createResource, createMemo, $LAZY } from "../reactive/signal";
import { sharedConfig, nextHydrateContext, setHydrateContext } from "./hydration";
import type { JSX } from "../jsx";

type PropsWithChildren<P> = P & { children?: JSX.Element };
export type Component<P = {}> = (props: PropsWithChildren<P>) => JSX.Element;
/**
 * Takes the props of the passed component and returns its type
 *
 * @example
 * ComponentProps<typeof Portal> // { mount?: Node; useShadow?: boolean; children: JSX.Element }
 * ComponentProps<'div'> // JSX.HTMLAttributes<HTMLDivElement>
 */
export type ComponentProps<
  T extends keyof JSX.IntrinsicElements | Component<any>
> = T extends Component<infer P>
  ? P
  : T extends keyof JSX.IntrinsicElements
  ? JSX.IntrinsicElements[T]
  : {};
export function createComponent<T>(Comp: (props: T) => JSX.Element, props: T): JSX.Element {
  if (sharedConfig.context) {
    const c = sharedConfig.context;
    setHydrateContext(nextHydrateContext());
    const r = untrack(() => Comp(props as T));
    setHydrateContext(c);
    return r;
  }
  return untrack(() => Comp(props as T));
}

const propTraps: ProxyHandler<{ get: (k: string | number | symbol) => any; keys: () => any }> = {
  get(_, property) {
    return _.get(property);
  },
  has(_, property) {
    return _.get(property) !== undefined;
  },
  getOwnPropertyDescriptor(_, property) {
    return {
      configurable: true,
      enumerable: true,
      get() {
        return _.get(property);
      }
    };
  },
  ownKeys(_) {
    return _.keys();
  }
};

export function mergeProps<T>(source: T): T;
export function mergeProps<T, U>(source: T, source1: U): T & U;
export function mergeProps<T, U, V>(source: T, source1: U, source2: V): T & U & V;
export function mergeProps<T, U, V, W>(
  source: T,
  source1: U,
  source2: V,
  source3: W
): T & U & V & W;
export function mergeProps(...sources: any): any {
  return new Proxy(
    {
      get(property: string | number | symbol) {
        for (let i = sources.length - 1; i >= 0; i--) {
          const v = sources[i][property];
          if (v !== undefined) return v;
        }
      },
      keys() {
        const keys = [];
        for (let i = 0; i < sources.length; i++) keys.push(...Object.keys(sources[i]));
        return [...new Set(keys)];
      }
    },
    propTraps
  );
}

export function splitProps<T extends object, K1 extends keyof T>(
  props: T,
  ...keys: [K1[]]
): [Pick<T, K1>, Omit<T, K1>];
export function splitProps<T extends object, K1 extends keyof T, K2 extends keyof T>(
  props: T,
  ...keys: [K1[], K2[]]
): [Pick<T, K1>, Pick<T, K2>, Omit<T, K1 | K2>];
export function splitProps<
  T extends object,
  K1 extends keyof T,
  K2 extends keyof T,
  K3 extends keyof T
>(
  props: T,
  ...keys: [K1[], K2[], K3[]]
): [Pick<T, K1>, Pick<T, K2>, Pick<T, K3>, Omit<T, K1 | K2 | K3>];
export function splitProps<
  T extends object,
  K1 extends keyof T,
  K2 extends keyof T,
  K3 extends keyof T,
  K4 extends keyof T
>(
  props: T,
  ...keys: [K1[], K2[], K3[], K4[]]
): [Pick<T, K1>, Pick<T, K2>, Pick<T, K3>, Pick<T, K4>, Omit<T, K1 | K2 | K3 | K4>];
export function splitProps<
  T extends object,
  K1 extends keyof T,
  K2 extends keyof T,
  K3 extends keyof T,
  K4 extends keyof T,
  K5 extends keyof T
>(
  props: T,
  ...keys: [K1[], K2[], K3[], K4[], K5[]]
): [
  Pick<T, K1>,
  Pick<T, K2>,
  Pick<T, K3>,
  Pick<T, K4>,
  Pick<T, K5>,
  Omit<T, K1 | K2 | K3 | K4 | K5>
];
export function splitProps<T>(props: T, ...keys: Array<(keyof T)[]>) {
  const blocked = new Set(keys.flat());
  const descriptors = Object.getOwnPropertyDescriptors(props);
  const res = keys.map(k => {
    const clone = {};
    for (let i = 0; i < k.length; i++) {
      const key = k[i];
      if (descriptors[key]) Object.defineProperty(clone, key, descriptors[key]);
    }
    return clone;
  });
  res.push(
    new Proxy(
      {
        get(property: string | number | symbol) {
          if (blocked.has(property as keyof T)) return;
          return props[property as keyof T];
        },
        keys() {
          return Object.keys(props).filter(k => !blocked.has(k as keyof T));
        }
      },
      propTraps
    )
  );
  return res;
}

// lazy load a function component asynchronously
export function lazy<T extends Component<any>>(fn: () => Promise<{ default: T }>): T {
  let p: Promise<{ default: T }>;
  return ((props: any) => {
    const ctx = sharedConfig.context;
    let comp: () => T | undefined;
    if (ctx && sharedConfig.resources) {
      ctx.count++; // increment counter for hydration
      const [s, set] = createSignal<T>();
      (p || (p = fn())).then(mod => {
        setHydrateContext(ctx);
        set(mod.default);
        setHydrateContext(undefined);
      });
      comp = s;
    } else {
      const [s] = createResource($LAZY, () => (p || (p = fn())).then(mod => mod.default));
      comp = s;
    }
    let Comp: T | undefined;
    return createMemo(
      () =>
        (Comp = comp()) &&
        untrack(() => {
          if (!ctx) return Comp!(props);
          const c = sharedConfig.context;
          setHydrateContext(ctx);
          const r = Comp!(props);
          setHydrateContext(c);
          return r;
        })
    );
  }) as T;
}
