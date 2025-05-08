import {
  NotReadyError,
  Owner,
  setContext,
  getContext,
  type Accessor,
  type Context,
  flatten,
  getOwner
} from "@solidjs/signals";
import { createMemo, mapArray, repeat, runWithOwner } from "./signals.js";
import type { JSX } from "../jsx.js";
import type { Component, ComponentProps } from "../index.js";
import { children } from "./reactive.js";

const SuspenseContext: Context<SuspenseContextType | null> = {
  id: Symbol("SuspenseContext"),
  defaultValue: null
};

const ErrorContext: Context<Function | null> = {
  id: Symbol("ErrorContext"),
  defaultValue: null
};

export function ssrHandleError(err: any) {
  if (err instanceof NotReadyError) {
    getContext(SuspenseContext)?.promises.add(err.cause as Promise<any>);
    return true;
  }
  const handler = getContext(ErrorContext);
  if (handler) {
    handler(err);
    return true;
  }
}

type SharedConfig = {
  context?: HydrationContext;
  getNextContextId(): string;
};
export const sharedConfig: SharedConfig = {
  getNextContextId() {
    const o = getOwner();
    if (!o) throw new Error(`getNextContextId cannot be used under non-hydrating context`);
    return o.getNextChildId();
  }
};

export function createUniqueId(): string {
  return sharedConfig.getNextContextId();
}

export function createComponent<T>(Comp: (props: T) => JSX.Element, props: T): JSX.Element {
  return Comp(props || ({} as T));
}

export function For<T>(props: {
  each: T[];
  fallback?: string;
  children: (item: Accessor<T>, index: Accessor<number>) => string;
}) {
  return mapArray(() => props.each, props.children, { fallback: () => props.fallback });
}

// non-keyed
export function Repeat(props: {
  count: number;
  from?: number | undefined;
  fallback?: string;
  children: (index: number) => string;
}) {
  return repeat(
    () => props.count,
    index => props.children(index),
    { fallback: () => props.fallback, from: () => props.from }
  );
}

/**
 * Conditionally render its children or an optional fallback component
 * @description https://docs.solidjs.com/reference/components/show
 */
export function Show<T>(props: {
  when: T | undefined | null | false;
  keyed?: boolean;
  fallback?: string;
  children: string | ((item: NonNullable<T> | Accessor<NonNullable<T>>) => string);
}): string {
  let c: string | ((item: NonNullable<T> | Accessor<NonNullable<T>>) => string);
  const when = props.when;
  return when
    ? typeof (c = props.children) === "function"
      ? c(() => when as any)
      : c
    : props.fallback || "";
}

export function Switch(props: {
  fallback?: string;
  children: MatchProps<unknown> | MatchProps<unknown>[];
}) {
  const o = getOwner();
  const conditions = children(() => props.children as any);
  o!.getNextChildId();
  return createMemo(() => {
    let conds: MatchProps<unknown> | MatchProps<unknown>[] = conditions() as any;
    Array.isArray(conds) || (conds = [conds]);

    for (let i = 0; i < conds.length; i++) {
      const w = conds[i].when;
      if (w) {
        const c = conds[i].children;
        return typeof c === "function" ? c(() => w) : c;
      }
    }
    return props.fallback || "";
  });
}

type MatchProps<T> = {
  when: T | false;
  keyed?: boolean;
  children: string | ((item: NonNullable<T> | Accessor<NonNullable<T>>) => string);
};
export function Match<T>(props: MatchProps<T>) {
  return props;
}

export function ErrorBoundary(props: {
  fallback: string | ((err: any, reset: () => void) => string);
  children: string;
}) {
  const ctx = sharedConfig.context!;
  let sync = true;
  return createMemo(() => {
    const o = getOwner()!;
    const id = o.id!;
    let res: any;
    setContext(
      ErrorContext,
      (err: any) => {
        o.dispose(false);
        // display fallback
        ctx.serialize(id, err);
        runWithOwner(o, () => {
          const f = props.fallback;
          res = typeof f === "function" && f.length ? f(err, () => {}) : f;
          !sync && ctx.replace("e" + id, () => res);
        });
      },
      o
    );
    try {
      res = flatten(props.children);
    } catch (err) {
      if (!ssrHandleError(err)) throw err;
    }
    sync = false;
    return { t: `<!--!$e${id}-->${ctx.resolve(res)}<!--!$/e${id}-->` };
  });
}

// Suspense Context
type SuspenseContextType = {
  promises: Set<Promise<any>>;
};

export function lazy<T extends Component<any>>(
  fn: () => Promise<{ default: T }>
): T & { preload: () => Promise<{ default: T }> } {
  let p: Promise<{ default: T }> & { resolved?: T };
  let load = (id?: string) => {
    if (!p) {
      p = fn();
      p.then(mod => (p.resolved = mod.default));
      if (id) sharedConfig.context!.resources[id] = p;
    }
    return p;
  };
  const wrap: Component<ComponentProps<T>> & {
    preload?: () => Promise<{ default: T }>;
  } = props => {
    const id = sharedConfig.getNextContextId();
    let ref = sharedConfig.context!.resources[id];
    if (ref) p = ref;
    else load(id);
    if (p.resolved) return p.resolved(props);
    const ctx = getContext(SuspenseContext);
    if (ctx) ctx.promises.add(p);
    if (sharedConfig.context!.async) {
      sharedConfig.context!.block(
        p.then(() => {
          (p as any).status = "success";
        })
      );
    }
    return "";
  };
  wrap.preload = load;
  return wrap as T & { preload: () => Promise<{ default: T }> };
}

export function enableHydration() {}

type HydrationContext = {
  id: string;
  count: number;
  serialize: (id: string, v: Promise<any> | any, deferStream?: boolean) => void;
  resolve(value: any): string;
  replace: (id: string, replacement: () => any) => void;
  block: (p: Promise<any>) => void;
  resources: Record<string, any>;
  registerFragment: (v: string) => (v?: string, err?: any) => boolean;
  async?: boolean;
  noHydrate: boolean;
};

function suspenseComplete(c: SuspenseContextType) {
  for (const r of c.promises.values()) {
    if (!(r as any).status) return false;
  }
  return true;
}

export function Suspense(props: { fallback?: string; children: string }) {
  let done: undefined | ((html?: string, error?: any) => boolean);
  const ctx = sharedConfig.context!;
  const o = new Owner();
  o.id += "0"; // fake depth
  const id = o.id!;
  const value: SuspenseContextType =
    ctx.resources[id] ||
    (ctx.resources[id] = {
      promises: new Set()
    });
  setContext(SuspenseContext, value, o);

  function runSuspense() {
    o.dispose(false);
    const res = runWithOwner(o, () => {
      try {
        return flatten(props.children);
      } catch (err) {
        if (!ssrHandleError(err)) throw err;
      }
    });
    if (ctx.async && !suspenseComplete(value))
      Promise.all(value.promises).then(() => {
        const res = runSuspense();
        if (suspenseComplete(value)) {
          done!(ctx.resolve(res));
        }
      });
    return res;
  }
  const res = runSuspense();

  // never suspended
  if (suspenseComplete(value)) {
    delete ctx.resources[id];
    return res;
  }

  done = ctx.async ? ctx.registerFragment(id) : undefined;
  if (ctx.async) {
    const res = {
      t: `<template id="pl-${id}"></template>${ctx.resolve(props.fallback)}<!--pl-${id}-->`
    };
    return res;
  }
  ctx.serialize(id, "$$f");
  return props.fallback;
}
