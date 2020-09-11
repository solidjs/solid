import { State, SetStateFunction, updatePath } from "./reactive";
import { resolveSSRNode } from "./ssr";

type PropsWithChildren<P> = P & { children?: JSX.Element };
export type Component<P = {}> = (props: PropsWithChildren<P>) => JSX.Element;

type PossiblyWrapped<T> = {
  [P in keyof T]: T[P] | (() => T[P]);
};

export function createComponent<T>(
  Comp: (props: T) => JSX.Element,
  props: PossiblyWrapped<T>
): JSX.Element {
  return Comp(props as T);
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
  return Object.assign(target, ...sources);
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
  const split = (k: (keyof T)[]) => {
    const clone: Partial<T> = {};
    for (let i = 0; i < k.length; i++) {
      const key = k[i];
      if (props[key]) {
        clone[key] = props[key];
        delete props[key];
      }
    }
    return clone;
  };
  return keys.map(split).concat(split(Object.keys(props) as (keyof T)[]));
}

function simpleMap(
  props: { each: any[]; children: Function; fallback?: string },
  wrap: (fn: Function, item: any, i: number) => string
) {
  const list = props.each || [],
    len = list.length,
    fn = props.children;
  if (len) {
    let mapped = "";
    for (let i = 0; i < len; i++) mapped += resolveSSRNode(wrap(fn, list[i], i));
    return mapped;
  }
  return props.fallback || "";
}

export function For<T>(props: {
  each: T[];
  fallback?: string;
  children: (item: T, index: () => number) => string;
}) {
  return simpleMap(props, (fn, item, i) => fn(item, () => i));
}

// non-keyed
export function Index<T>(props: {
  each: T[];
  fallback?: string;
  children: (item: () => T, index: number) => string;
}) {
  return simpleMap(props, (fn, item, i) => fn(() => item, i));
}

export function Show<T>(props: {
  when: T | false;
  fallback?: string;
  children: string | ((item: T) => string);
}) {
  return props.when
    ? typeof props.children === "function"
      ? props.children(props.when)
      : props.children
    : props.fallback || "";
}

export function Switch(props: {
  fallback?: string;
  children: MatchProps<unknown> | MatchProps<unknown>[];
}) {
  let conditions = props.children;
  Array.isArray(conditions) || (conditions = [conditions]);

  for (let i = 0; i < conditions.length; i++) {
    const w = conditions[i].when;
    if (w) {
      const c = conditions[i].children;
      return typeof c === "function" ? c(w) : c;
    }
  }
  return props.fallback || "";
}

type MatchProps<T> = {
  when: T | false;
  children: string | ((item: T) => string);
};
export function Match<T>(props: MatchProps<T>) {
  return props;
}

export function ErrorBoundary(props: {
  fallback: string | ((err: any) => string);
  children: string;
}) {
  // no op
  return props.children;
}

// Suspense Context
type SuspenseConfig = { timeoutMs: number };

export interface Resource<T> {
  (): T | undefined;
  loading: boolean;
}

export function createResource<T>(value?: T): [Resource<T>, (fn: () => Promise<T> | T) => void] {
  const resource = () => value;
  resource.loading = false;
  function load(fn: () => Promise<T> | T) {
    if (typeof fn === "function") {
      resource.loading = true;
      const p = (fn as () => Promise<T>)();
      globalThis._$HYDRATION.register && globalThis._$HYDRATION.register(p);
    } else value = fn;
  }
  return [resource, load];
}

export interface LoadStateFunction<T> {
  (
    v: { [P in keyof T]: () => Promise<T[P]> | T[P] },
    reconcilerFn?: (v: Partial<T>) => (state: State<T>) => void
  ): void;
}

export function createResourceState<T>(
  state: T | State<T>
): [
  State<T & { loading: { [P in keyof T]: boolean } }>,
  LoadStateFunction<T>,
  SetStateFunction<T>
] {
  (state as any).loading = {};
  function setState(...args: any[]): void {
    updatePath(state, args);
  }
  function loadState(
    v: { [P in keyof T]: () => Promise<T[P]> | T[P] },
    reconcilerFn?: (v: Partial<T>) => (state: State<T>) => void
  ) {
    const keys = Object.keys(v);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i] as keyof T,
        [, l] = createResource(state[k]);
      l(v[k]);
    }
  }
  return [state as State<T & { loading: { [P in keyof T]: boolean } }>, loadState, setState];
}

export function lazy(fn: () => Promise<{ default: any }>): (props: any) => string {
  return (props: any) => {
    fn().then(mod => mod.default(props));
    return "";
  };
}

export function useTransition(config: SuspenseConfig): [() => boolean, (fn: () => any) => void] {
  return [
    () => false,
    fn => {
      fn();
    }
  ];
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

export function SuspenseList(props: {
  children: string;
  revealOrder: "forwards" | "backwards" | "together";
  tail?: "collapsed" | "hidden";
}) {
  // TODO: support tail options
  return props.children;
}

export function Suspense(props: { fallback: string; children: string }) {
  props.children;
  return props.fallback;
}
