import {
  Owner,
  createContext,
  createMemo,
  useContext,
  runWithOwner,
  onError,
  Accessor,
  Setter
} from "./reactive";
import type { JSX } from "../jsx";

export type Component<P = {}> = (props: P) => JSX.Element;
export type VoidProps<P = {}> = P & { children?: never };
export type VoidComponent<P = {}> = Component<VoidProps<P>>;
export type ParentProps<P = {}> = P & { children?: JSX.Element };
export type ParentComponent<P = {}> = Component<ParentProps<P>>;
export type FlowProps<P = {}, C = JSX.Element> = P & { children: C };
export type FlowComponent<P = {}, C = JSX.Element> = Component<FlowProps<P, C>>;
export type Ref<T> = T | ((val: T) => void);
export type ComponentProps<T extends keyof JSX.IntrinsicElements | Component> = T extends Component<
  infer P
>
  ? P
  : T extends keyof JSX.IntrinsicElements
  ? JSX.IntrinsicElements[T]
  : {};

type PossiblyWrapped<T> = {
  [P in keyof T]: T[P] | (() => T[P]);
};

function resolveSSRNode(node: any): string {
  const t = typeof node;
  if (t === "string") return node;
  if (node == null || t === "boolean") return "";
  if (Array.isArray(node)) {
    let mapped = "";
    for (let i = 0, len = node.length; i < len; i++) mapped += resolveSSRNode(node[i]);
    return mapped;
  }
  if (t === "object") return resolveSSRNode(node.t);
  if (t === "function") return resolveSSRNode(node());
  return String(node);
}

type SharedConfig = {
  context?: HydrationContext;
};
export const sharedConfig: SharedConfig = {};

function setHydrateContext(context?: HydrationContext): void {
  sharedConfig.context = context;
}

function nextHydrateContext(): HydrationContext | undefined {
  return sharedConfig.context
    ? {
        ...sharedConfig.context,
        id: `${sharedConfig.context.id}${sharedConfig.context.count++}-`,
        count: 0
      }
    : undefined;
}

export function createUniqueId(): string {
  const ctx = sharedConfig.context;
  if (!ctx) throw new Error(`createUniqueId cannot be used under non-hydrating context`);
  return `${ctx.id}${ctx.count++}`;
}

export function createComponent<T>(Comp: (props: T) => JSX.Element, props: T): JSX.Element {
  if (sharedConfig.context && !sharedConfig.context.noHydrate) {
    const c = sharedConfig.context;
    setHydrateContext(nextHydrateContext());
    const r = Comp(props || {} as T);
    setHydrateContext(c);
    return r;
  }
  return Comp(props || {} as T);
}

export function mergeProps<T, U>(source: T, source1: U): T & U;
export function mergeProps<T, U, V>(source: T, source1: U, source2: V): T & U & V;
export function mergeProps<T, U, V, W>(
  source: T,
  source1: U,
  source2: V,
  source3: W
): T & U & V & W;
export function mergeProps(...sources: any): any {
  const target = {};
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

function simpleMap(
  props: { each: any[]; children: Function; fallback?: string },
  wrap: (fn: Function, item: any, i: number) => string
) {
  const list = props.each || [],
    len = list.length,
    fn = props.children;
  if (len) {
    let mapped = Array(len);
    for (let i = 0; i < len; i++) mapped[i] = wrap(fn, list[i], i);
    return mapped;
  }
  return props.fallback;
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
  let c: string | ((item: T) => string);
  return props.when
    ? typeof (c = props.children) === "function"
      ? c(props.when)
      : c
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

export function resetErrorBoundaries() {}
export function ErrorBoundary(props: {
  fallback: string | ((err: any, reset: () => void) => string);
  children: string;
}) {
  let error: any, res: any;
  const ctx = sharedConfig.context!;
  const id = ctx.id + ctx.count;
  onError(err => (error = err));
  createMemo(() => (res = props.children));
  if (error) {
    ctx.writeResource!(id, error, true);
    setHydrateContext({ ...ctx, count: 0 });
    const f = props.fallback;
    return typeof f === "function" && f.length ? f(error, () => {}) : f;
  }
  return res;
}

// Suspense Context
export interface Resource<T> {
  (): T | undefined;
  loading: boolean;
  error: any;
  latest: T | undefined;
}

type SuspenseContextType = {
  resources: Map<string, { loading: boolean; error: any }>;
  completed: () => void;
};

export type ResourceActions<T> = { mutate: Setter<T>; refetch: (info?: unknown) => void };

export type ResourceReturn<T> = [Resource<T>, ResourceActions<T>];

export type ResourceSource<S> = S | false | null | undefined | (() => S | false | null | undefined);

export type ResourceFetcher<S, T> = (k: S, info: ResourceFetcherInfo<T>) => T | Promise<T>;

export type ResourceFetcherInfo<T> = { value: T | undefined; refetching?: unknown };

export type ResourceOptions<T> = undefined extends T
  ? {
      initialValue?: T;
      name?: string;
      deferStream?: boolean;
      onHydrated?: <S, T>(k: S, info: ResourceFetcherInfo<T>) => void;
    }
  : {
      initialValue: T;
      name?: string;
      deferStream?: boolean;
      onHydrated?: <S, T>(k: S, info: ResourceFetcherInfo<T>) => void;
    };

const SuspenseContext = createContext<SuspenseContextType>();
let resourceContext: any[] | null = null;
export function createResource<T, S = true>(
  fetcher: ResourceFetcher<S, T>,
  options?: ResourceOptions<undefined>
): ResourceReturn<T | undefined>;
export function createResource<T, S = true>(
  fetcher: ResourceFetcher<S, T>,
  options: ResourceOptions<T>
): ResourceReturn<T>;
export function createResource<T, S>(
  source: ResourceSource<S>,
  fetcher: ResourceFetcher<S, T>,
  options?: ResourceOptions<undefined>
): ResourceReturn<T | undefined>;
export function createResource<T, S>(
  source: ResourceSource<S>,
  fetcher: ResourceFetcher<S, T>,
  options: ResourceOptions<T>
): ResourceReturn<T>;
export function createResource<T, S>(
  source: ResourceSource<S> | ResourceFetcher<S, T>,
  fetcher?: ResourceFetcher<S, T> | ResourceOptions<T> | ResourceOptions<undefined>,
  options: ResourceOptions<T> | ResourceOptions<undefined> = {}
): ResourceReturn<T> | ResourceReturn<T | undefined> {
  if (arguments.length === 2) {
    if (typeof fetcher === "object") {
      options = fetcher as ResourceOptions<T> | ResourceOptions<undefined>;
      fetcher = source as ResourceFetcher<S, T>;
      source = true as ResourceSource<S>;
    }
  } else if (arguments.length === 1) {
    fetcher = source as ResourceFetcher<S, T>;
    source = true as ResourceSource<S>;
  }
  const contexts = new Set<SuspenseContextType>();
  const id = sharedConfig.context!.id + sharedConfig.context!.count++;
  let resource: { ref?: any; data?: T } = {};
  let value = options.initialValue;
  let p: Promise<T> | T | null;
  let error: any;
  if (sharedConfig.context!.async) {
    resource = sharedConfig.context!.resources[id] || (sharedConfig.context!.resources[id] = {});
    if (resource.ref) {
      if (!resource.data && !resource.ref[0].loading && !resource.ref[0].error)
        resource.ref[1].refetch();
      return resource.ref;
    }
  }
  const read = () => {
    if (error) throw error;
    if (resourceContext && p) resourceContext.push(p!);
    const resolved = sharedConfig.context!.async && sharedConfig.context!.resources[id].data;
    if (!resolved && read.loading) {
      const ctx = useContext(SuspenseContext);
      if (ctx) {
        ctx.resources.set(id, read);
        contexts.add(ctx);
      }
    }
    return resolved ? sharedConfig.context!.resources[id].data : value;
  };
  read.loading = false;
  read.error = undefined as any;
  Object.defineProperty(read, "latest", {
    get() {
      return read();
    }
  });
  function load() {
    const ctx = sharedConfig.context!;
    if (!ctx.async)
      return (read.loading = !!(typeof source === "function" ? (source as () => S)() : source));
    if (ctx.resources && id in ctx.resources && ctx.resources[id].data) {
      value = ctx.resources[id].data;
      return;
    }
    resourceContext = [];
    const lookup = typeof source === "function" ? (source as () => S)() : source;
    if (resourceContext.length) {
      p = Promise.all(resourceContext).then(() =>
        (fetcher as ResourceFetcher<S, T>)((source as Accessor<S>)(), { value })
      );
    }
    resourceContext = null;
    if (!p) {
      if (lookup == null || lookup === false) return;
      p = (fetcher as ResourceFetcher<S, T>)(lookup, { value });
    }
    if (p != undefined && typeof p === "object" && "then" in p) {
      read.loading = true;
      if (ctx.writeResource) ctx.writeResource(id, p, undefined, options.deferStream);
      return p
        .then(res => {
          read.loading = false;
          ctx.resources[id].data = res;
          p = null;
          notifySuspense(contexts);
          return res;
        })
        .catch(err => {
          read.loading = false;
          read.error = error = err;
          p = null;
          notifySuspense(contexts);
        });
    }
    ctx.resources[id].data = p;
    if (ctx.writeResource) ctx.writeResource(id, p);
    p = null;
    return ctx.resources[id].data;
  }
  load();
  return (resource.ref = [
    read,
    { refetch: load, mutate: (v: T) => (value = v) }
  ] as ResourceReturn<T>);
}

export function lazy<T extends Component<any>>(
  fn: () => Promise<{ default: T }>
): T & { preload: () => Promise<{ default: T }> } {
  let resolved: T;
  const p = fn();
  const contexts = new Set<SuspenseContextType>();
  p.then(mod => (resolved = mod.default));
  const wrap: Component<ComponentProps<T>> & {
    preload?: () => Promise<{ default: T }>;
  } = props => {
    const id = sharedConfig.context!.id.slice(0, -1);
    if (resolved) return resolved(props);
    const ctx = useContext(SuspenseContext);
    const track = { loading: true, error: undefined };
    if (ctx) {
      ctx.resources.set(id, track);
      contexts.add(ctx);
    }
    if (sharedConfig.context!.async)
      p.then(() => {
        track.loading = false;
        notifySuspense(contexts);
      });
    return "";
  };
  wrap.preload = () => p;
  return wrap as T & { preload: () => Promise<{ default: T }> };
}

function suspenseComplete(c: SuspenseContextType) {
  for (const r of c.resources.values()) {
    if (r.loading) return false;
  }
  return true;
}

function notifySuspense(contexts: Set<SuspenseContextType>) {
  for (const c of contexts) {
    if (suspenseComplete(c)) c.completed();
  }
  contexts.clear();
}

export function enableScheduling() {}

export function enableHydration() {}

export function startTransition(fn: () => any): void {
  fn();
}

export function useTransition(): [() => boolean, (fn: () => any) => void] {
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
  writeResource?: (id: string, v: Promise<any> | any, error?: boolean, deferStream?: boolean) => void;
  resources: Record<string, any>;
  suspense: Record<string, SuspenseContextType>;
  registerFragment: (v: string) => (v?: string, err?: any) => boolean;
  async?: boolean;
  streaming?: boolean;
  noHydrate: boolean;
};

export function SuspenseList(props: {
  children: string;
  revealOrder: "forwards" | "backwards" | "together";
  tail?: "collapsed" | "hidden";
}) {
  // TODO: support tail options
  return props.children;
}

export function Suspense(props: { fallback?: string; children: string }) {
  let done: undefined | ((html?: string, error?: any) => boolean);
  const ctx = sharedConfig.context!;
  const id = ctx.id + ctx.count;
  const o = Owner!;
  const value: SuspenseContextType =
    ctx.suspense[id] ||
    (ctx.suspense[id] = {
      resources: new Map<string, { loading: boolean; error: any }>(),
      completed: () => {
        const res = runSuspense();
        if (suspenseComplete(value)) {
          done!(resolveSSRNode(res));
        }
      }
    });
  function runSuspense() {
    setHydrateContext({ ...ctx, count: 0 });
    return runWithOwner(o, () => {
      return createComponent(SuspenseContext.Provider, {
        value,
        get children() {
          return props.children;
        }
      });
    });
  }
  const res = runSuspense();

  // never suspended
  if (suspenseComplete(value)) {
    ctx.writeResource!(id, null);
    return res;
  }

  onError(err => {
    if (!done || !done(undefined, err)) throw err;
  });
  done = ctx.async ? ctx.registerFragment(id) : undefined;
  if (ctx.streaming) {
    setHydrateContext(undefined);
    const res = { t: `<span id="pl-${id}">${resolveSSRNode(props.fallback)}</span>` };
    setHydrateContext(ctx);
    return res;
  } else if (ctx.async) {
    return { t: `<![${id}]>` };
  }
  setHydrateContext({ ...ctx, count: 0, id: ctx.id + "0.f" });
  return props.fallback;
}
