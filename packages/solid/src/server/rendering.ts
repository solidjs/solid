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

const ErrorContext: Context<Function | null> = {
  id: Symbol("ErrorContext"),
  defaultValue: null
};

export function ssrHandleError(err: any) {
  if (err instanceof NotReadyError) {
    return err.cause as Promise<any>;
  }
  const handler = getContext(ErrorContext);
  if (handler) {
    handler(err);
    return;
  }
  throw err;
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
  return createMemo(mapArray(() => props.each, props.children, { fallback: () => props.fallback }));
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
      const p = ssrHandleError(err);
      if (p) {
      }
    }
    sync = false;
    return ctx.ssr([`<!--!$e${id}-->`, `<!--!$/e${id}-->`], ctx.escape(res));
  });
}

export function lazy<T extends Component<any>>(
  fn: () => Promise<{ default: T }>
): T & { preload: () => Promise<{ default: T }> } {
  let p: Promise<{ default: T; __url: string }> & { v?: T };
  let load = (id?: string) => {
    if (!p) {
      p = fn() as any;
      p.then(mod => {
        p.v = mod.default;
      });
    }
    return p;
  };
  const wrap: Component<ComponentProps<T>> & {
    preload?: () => Promise<{ default: T }>;
  } = props => {
    const id = sharedConfig.getNextContextId();
    load(id);
    if (p.v) return p.v(props);
    if (sharedConfig.context!.async) {
      sharedConfig.context!.block(
        p.then(() => {
          (p as any).s = "success";
        })
      );
    }
    const err = new NotReadyError();
    err.cause = p;
    throw err;
  };
  wrap.preload = load;
  return wrap as T & { preload: () => Promise<{ default: T }> };
}

export function enableHydration() {}

type SSRTemplateObject = { t: string[]; h: Function[]; p: Promise<any>[] };
type HydrationContext = {
  id: string;
  count: number;
  serialize: (id: string, v: Promise<any> | any, deferStream?: boolean) => void;
  resolve(value: any): SSRTemplateObject;
  ssr(template: string[], ...values: any[]): SSRTemplateObject;
  escape(value: any): string;
  replace: (id: string, replacement: () => any) => void;
  block: (p: Promise<any>) => void;
  registerFragment: (v: string) => (v?: string, err?: any) => boolean;
  async?: boolean;
  noHydrate: boolean;
};

export function Suspense(props: { fallback?: string; children: string }) {
  const ctx = sharedConfig.context!;
  const o = new Owner();
  const id = o.id!;
  o.id += "00"; // fake depth

  let runPromise;
  function runInitially(): SSRTemplateObject {
    o.dispose(false);
    return runWithOwner(o, () => {
      try {
        return ctx.resolve(flatten(props.children));
      } catch (err) {
        runPromise = ssrHandleError(err);
      }
    }) as any;
  }
  let ret = runInitially();
  // never suspended
  if (!(runPromise || ret!.p.length)) return ret;

  const fallbackOwner = new Owner(id);
  fallbackOwner.getNextChildId(); // move counter forward
  if (ctx.async) {
    const done = ctx.registerFragment(id);
    (async () => {
      while (runPromise) {
        await runPromise;
        runPromise = undefined;
        ret = runInitially();
      }
      while (ret.p.length) {
        await Promise.all(ret.p);
        ret = ctx.ssr(ret.t, ...ret.h);
      }
      done!(ret.t[0]);
    })();

    return runWithOwner(fallbackOwner, () =>
      ctx.ssr(
        [`<template id="pl-${id}"></template>`, `<!--pl-${id}-->`],
        ctx.escape(props.fallback)
      )
    );
  }
  ctx.serialize(id, "$$f");
  return runWithOwner(fallbackOwner, () => props.fallback);
}
