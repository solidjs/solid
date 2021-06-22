import { createMemo, Owner, createContext, useContext, lookup, runWithOwner } from "./reactive";
import type { JSX } from "../jsx";

type PropsWithChildren<P> = P & { children?: JSX.Element };
export type Component<P = {}> = (props: PropsWithChildren<P>) => JSX.Element;

type PossiblyWrapped<T> = {
  [P in keyof T]: T[P] | (() => T[P]);
};

function resolveSSRNode(node: any): string {
  const t = typeof node;
  if (t === "string") return node;
  if (node == null || t === "boolean") return "";
  if (Array.isArray(node)) return node.map(resolveSSRNode).join("");
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
        id: `${sharedConfig.context.id}${sharedConfig.context.count++}.`,
        count: 0
      }
    : undefined;
}

export function createComponent<T>(
  Comp: (props: T) => JSX.Element,
  props: PossiblyWrapped<T>
): JSX.Element {
  if (sharedConfig.context) {
    const c = sharedConfig.context;
    setHydrateContext(nextHydrateContext());
    const r = Comp(props as T);
    setHydrateContext(c);
    return r;
  }
  return Comp(props as T);
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
    let mapped = "";
    for (let i = 0; i < len; i++) mapped += resolveSSRNode(wrap(fn, list[i], i));
    return { t: mapped };
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

export function ErrorBoundary(props: {
  fallback: string | ((err: any) => string);
  children: string;
}) {
  // no op
  return props.children;
}

// Suspense Context
export interface Resource<T> {
  (): T | undefined;
  loading: boolean;
}

type SuspenseContextType = {
  resources: Map<string, { loading: boolean }>;
  completed: () => void;
};

type ResourceReturn<T> = [
  Resource<T>,
  {
    mutate: (v: T | undefined) => T | undefined;
    refetch: () => void;
  }
];

const SuspenseContext = createContext<SuspenseContextType>();
let resourceContext: any[] | null = null;
export function createResource<T, U = true>(
  fetcher: (k: U, getPrev: () => T | undefined) => T | Promise<T>,
  options?: { initialValue?: T }
): ResourceReturn<T>;
export function createResource<T, U>(
  fn: U | false | (() => U | false),
  fetcher: (k: U, getPrev: () => T | undefined) => T | Promise<T>,
  options?: { initialValue?: T }
): ResourceReturn<T>;
export function createResource<T, U>(
  fn:
    | U
    | true
    | false
    | (() => U | false)
    | ((k: U, getPrev: () => T | undefined) => T | Promise<T>),
  fetcher?: ((k: U, getPrev: () => T | undefined) => T | Promise<T>) | { initialValue?: T },
  options: { initialValue?: T } = {}
): ResourceReturn<T> {
  if (arguments.length === 2) {
    if (typeof fetcher === "object") {
      options = fetcher;
      fetcher = fn as (k: U, getPrev: () => T | undefined) => T | Promise<T>;
      fn = true;
    }
  } else if (arguments.length === 1) {
    fetcher = fn as (k: U, getPrev: () => T | undefined) => T | Promise<T>;
    fn = true;
  }
  const contexts = new Set<SuspenseContextType>();
  const id = sharedConfig.context!.id + sharedConfig.context!.count++;
  let resource: { ref?: any; data?: T } = {};
  let value = options.initialValue;
  let p: Promise<T> | T | null;
  if (sharedConfig.context!.async) {
    resource = sharedConfig.context!.resources[id] || (sharedConfig.context!.resources[id] = {});
    if (resource.ref) {
      if (!resource.data && !resource.ref[0].loading) resource.ref[1].refetch();
      return resource.ref;
    }
  }
  const read = () => {
    if (resourceContext && p) resourceContext.push(p!);
    const resolved = sharedConfig.context!.async && sharedConfig.context!.resources[id].data;
    if (sharedConfig.context!.async && !resolved) {
      const ctx = useContext(SuspenseContext);
      if (ctx) {
        ctx.resources.set(id, read);
        contexts.add(ctx);
      }
    }
    return resolved ? sharedConfig.context!.resources[id].data : value;
  };
  read.loading = false;
  function load() {
    const ctx = sharedConfig.context!;
    if (!ctx.async && !ctx.streaming) return;
    if (ctx.resources && id in ctx.resources && ctx.resources[id].data) {
      value = ctx.resources[id].data;
      return;
    }
    resourceContext = [];
    const lookup = typeof fn === "function" ? (fn as () => U)() : fn;
    if (resourceContext.length) {
      p = Promise.all(resourceContext).then(() =>
        (fetcher as (k: U, getPrev: () => T | undefined) => T | Promise<T>)(
          (fn as () => U)(),
          () => value
        )
      );
    }
    resourceContext = null;
    if (!p) {
      if (lookup == null || lookup === false) return;
      p = (fetcher as (k: U, getPrev: () => T | undefined) => T | Promise<T>)(
        lookup as U,
        () => value
      );
    }
    read.loading = true;
    if ("then" in p) {
      if (ctx.writeResource) {
        ctx.writeResource(id, p);
        p.then(v => {
          value = v;
          read.loading = false;
          p = null;
        });
        return;
      }
      p.then(res => {
        read.loading = false;
        ctx.resources[id].data = res;
        p = null;
        notifySuspense(contexts);
        return res;
      });
      return;
    }
    ctx.resources[id].data = p;
    p = null;
  }
  load();
  return (resource.ref = [read, { refetch: load, mutate: v => (value = v) }] as ResourceReturn<T>);
}

export function lazy(fn: () => Promise<{ default: any }>): (props: any) => string {
  let resolved: (props: any) => any;
  const p = fn();
  const contexts = new Set<SuspenseContextType>();
  p.then(mod => (resolved = mod.default));
  const wrap = (props: any) => {
    const id = sharedConfig.context!.id + sharedConfig.context!.count++;
    if (resolved) return resolved(props);
    const ctx = useContext(SuspenseContext);
    const track = { loading: true };
    if (ctx) {
      ctx.resources.set(id, track);
      contexts.add(ctx);
    }
    p.then(() => {
      track.loading = false;
      notifySuspense(contexts);
    });
    return "";
  };
  wrap.preload = () => {};
  return wrap;
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
  writeResource?: (id: string, v: Promise<any>) => void;
  resources: Record<string, any>;
  suspense: Record<string, SuspenseContextType>;
  async?: boolean;
  streaming?: boolean;
};

export function SuspenseList(props: {
  children: string;
  revealOrder: "forwards" | "backwards" | "together";
  tail?: "collapsed" | "hidden";
}) {
  // TODO: support tail options
  return props.children;
}

const SUSPENSE_GLOBAL = Symbol("suspense-global");
export function Suspense(props: { fallback: string; children: string }) {
  const ctx = sharedConfig.context!;
  // TODO: look at not always going to fallback
  if (ctx.streaming) createComponent(() => props.children, {});
  if (!ctx.async) return props.fallback;

  const id = ctx.id + ctx.count;
  const done = ctx.async ? lookup(Owner, SUSPENSE_GLOBAL)(id) : () => {};
  const o = Owner!;
  const value: SuspenseContextType =
    ctx.suspense[id] ||
    (ctx.suspense[id] = {
      resources: new Map<string, { loading: boolean }>(),
      completed: () => {
        const res = runSuspense();
        if (suspenseComplete(value)) {
          done(resolveSSRNode(res));
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
  if (suspenseComplete(value)) {
    done();
    return res;
  }
  return sharedConfig.context!.async ? { t: `<#${id}#>` } : props.fallback;
}

const SUSPENSE_REPLACE = /<#([0-9\.]+)\#>/;
export function awaitSuspense(fn: () => any) {
  return new Promise(resolve => {
    const registry = new Set<string>();
    const cache: Record<string, string> = Object.create(null);
    const res = createMemo(() => {
      Owner!.context = { [SUSPENSE_GLOBAL]: getCallback };
      return fn();
    });
    if (!registry.size) resolve(res());
    function getCallback(key: string) {
      registry.add(key);
      return (value: string) => {
        if (value) cache[key] = value;
        registry.delete(key);
        if (!registry.size)
          Promise.resolve().then(() => {
            let source = resolveSSRNode(res());
            let final = "";
            let match: any;
            while ((match = source.match(SUSPENSE_REPLACE))) {
              final += source.substring(0, match.index);
              source = cache[match[1]] + source.substring(match.index + match[0].length);
            }
            resolve(final + source);
          });
      };
    }
  });
}
