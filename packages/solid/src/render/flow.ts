import { createMemo, untrack, createSignal, onError, children } from "../reactive/signal";
import { mapArray, indexArray } from "../reactive/array";
import type { JSX } from "../jsx";

export function For<T, U extends JSX.Element>(props: {
  each: readonly T[];
  fallback?: JSX.Element;
  children: (item: T, index: () => number) => U;
}) {
  const fallback = "fallback" in props && { fallback: () => props.fallback };
  return createMemo(
    mapArray<T, U>(() => props.each, props.children, fallback ? fallback : undefined)
  );
}

// non-keyed
export function Index<T, U extends JSX.Element>(props: {
  each: readonly T[];
  fallback?: JSX.Element;
  children: (item: () => T, index: number) => U;
}) {
  const fallback = "fallback" in props && { fallback: () => props.fallback };
  return createMemo(
    indexArray<T, U>(() => props.each, props.children, fallback ? fallback : undefined)
  );
}

export function Show<T>(props: {
  when: T | undefined | null | false;
  fallback?: JSX.Element;
  children: JSX.Element | ((item: T) => JSX.Element);
}) {
  const childDesc = Object.getOwnPropertyDescriptor(props, "children")!.value,
    callFn = typeof childDesc === "function" && childDesc.length,
    condition = createMemo<T | undefined | null | boolean>(
      callFn ? () => props.when : () => !!props.when,
      undefined,
      true
    );
  return createMemo(() => {
    const c = condition();
    return c
      ? callFn
        ? untrack(() => (props.children as (item: T) => JSX.Element)(c as T))
        : props.children
      : props.fallback;
  }) as () => JSX.Element;
}

export function Switch(props: { fallback?: JSX.Element; children: JSX.Element }) {
  let conditions = children(() => props.children) as () => (MatchProps<unknown> & {
    keyed: boolean;
  })[];
  const evalConditions = createMemo<
    [number, unknown?, (MatchProps<unknown> & { keyed: boolean })?]
  >(
    () => {
      let conds = conditions();
      if (!Array.isArray(conds)) conds = [conds];
      for (let i = 0; i < conds.length; i++) {
        const c = conds[i].when;
        if (c) return [i, conds[i].keyed ? c : !!c, conds[i]];
      }
      return [-1];
    },
    undefined,
    (a: [number, unknown?, unknown?], b: [number, unknown?, unknown?]) => a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
  );
  return createMemo(() => {
    const [index, when, cond] = evalConditions();
    if (index < 0) return props.fallback;
    const c = cond!.children;
    return typeof c === "function" && c.length ? untrack(() => c(when)) : (c as JSX.Element);
  });
}

type MatchProps<T> = {
  when: T | undefined | null | false;
  children: JSX.Element | ((item: T) => JSX.Element);
};
export function Match<T>(props: MatchProps<T>) {
  const childDesc = Object.getOwnPropertyDescriptor(props, "children")!.value;
  (props as MatchProps<T> & { keyed: boolean }).keyed =
    typeof childDesc === "function" && !!childDesc.length;
  return (props as unknown) as JSX.Element;
}

export function ErrorBoundary(props: {
  fallback: JSX.Element | ((err: any) => JSX.Element);
  children: JSX.Element;
}) {
  const [errored, setErrored] = createSignal(),
    fallbackDesc = Object.getOwnPropertyDescriptor(props, "fallback")!.value,
    callFn = typeof fallbackDesc === "function" && !!fallbackDesc.length;
  onError(setErrored);
  let e: any;
  return createMemo(() =>
    (e = errored()) != null
      ? callFn
        ? untrack(() => (props.fallback as (err: any) => JSX.Element)(e))
        : props.fallback
      : props.children
  ) as () => JSX.Element;
}
