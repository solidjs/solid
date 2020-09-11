import { untrack, createResource, createMemo } from "../reactive/signal";

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
  return untrack(() => Comp(props as T));
}

export function assignProps<T, U>(target: T, source: U): T & U;
export function assignProps<T, U, V>(target: T, source1: U, source2: V): T & U & V;
export function assignProps<T, U, V, W>(
  target: T,
  source1: U,
  source2: V,
  source3: W
): T & U & V & W;
export function assignProps(target: any, ...sources: any): any {
  for (let i = 0; i < sources.length; i++) {
    const descriptors = Object.getOwnPropertyDescriptors(sources[i]);
    Object.defineProperties(target, descriptors);
  }
  return target;
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
export function splitProps<T>(props: T, ...keys: [(keyof T)[]]) {
  const descriptors = Object.getOwnPropertyDescriptors(props),
    split = (k: (keyof T)[]) => {
      const clone: Partial<T> = {};
      for (let i = 0; i < k.length; i++) {
        const key = k[i];
        if (descriptors[key]) {
          Object.defineProperty(clone, key, descriptors[key]);
          delete descriptors[key];
        }
      }
      return clone;
    };
  return keys.map(split).concat(split(Object.keys(descriptors) as (keyof T)[]));
}

// lazy load a function component asynchronously
export function lazy<T extends Component<any>>(fn: () => Promise<{ default: T }>): T {
  return ((props: any) => {
    const h = globalThis._$HYDRATION,
      hydrating = h.context && h.context.registry,
      ctx = nextHydrateContext(),
      [s, l] = createResource<T>(undefined, { notStreamed: true });
    if (hydrating && h.resources) {
      fn().then(mod => l(() => mod.default));
    } else l(() => fn().then(mod => mod.default));
    let Comp: T | undefined;
    return createMemo(
      () =>
        (Comp = s()) &&
        untrack(() => {
          if (!ctx) return Comp!(props);
          const c = h.context;
          setHydrateContext(ctx);
          const r = Comp!(props);
          !c && setHydrateContext();
          return r;
        })
    );
  }) as T;
}

function setHydrateContext(context?: HydrationContext): void {
  globalThis._$HYDRATION.context = context;
}

function nextHydrateContext(): HydrationContext | undefined {
  const hydration = globalThis._$HYDRATION;
  return hydration && hydration.context
    ? {
        id: `${hydration.context.id}.${hydration.context.count++}`,
        count: 0,
        registry: hydration.context.registry
      }
    : undefined;
}

type HydrationContext = {
  id: string;
  count: number;
  registry?: Map<string, Element>;
};

type GlobalHydration = {
  context?: HydrationContext;
  register?: (v: Promise<any>) => void;
  loadResource?: () => Promise<any>;
  resources?: { [key: string]: any };
  asyncSSR?: boolean;
};

declare global {
  var _$HYDRATION: GlobalHydration;
}
